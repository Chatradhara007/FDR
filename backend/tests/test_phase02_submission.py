from __future__ import annotations

from dataclasses import dataclass

import pytest
from app.db.pool import exec_, get_pool, many, one
from app.domain.audit import verify_chain
from helpers import (
    VALID_FDR,
    SeededUser,
    api,
    bearer,
    count_events,
    create_draft_via_api,
    ready_fdr,
    reset_db,
    set_today,
    upload_doc,
    user_for,
)
from httpx import Response


@dataclass(frozen=True)
class Users:
    inst1: SeededUser
    inst2: SeededUser


@pytest.fixture
def u() -> Users:
    reset_db()
    set_today("2026-10-25")
    return Users(user_for("inst1@demo.in"), user_for("inst2@demo.in"))


def submit(user: SeededUser, instrument_id: str) -> Response:
    return api().post(f"/api/v1/instruments/{instrument_id}/submit", headers=bearer(user))


def ok_submit(user: SeededUser, instrument_id: str) -> None:
    res = submit(user, instrument_id)
    assert res.status_code == 200, res.text


def test_ac1_missing_document_and_invalid_fields_are_reported_together(u: Users) -> None:
    instrument_id = create_draft_via_api(
        u.inst1, {"type": "FDR", "referenceNo": "SBIN/FDR/2026/00731", "amount": "25,00,000"}
    )["id"]
    assert upload_doc(u.inst1, instrument_id, "FDR_COPY").status_code == 201
    res = submit(u.inst1, instrument_id)
    assert res.status_code == 422
    assert res.json()["code"] == "VALIDATION_FAILED"
    assert res.json()["details"]["missingDocuments"] == ["BANK_LETTER"]
    assert sorted(f["field"] for f in res.json()["details"]["fields"]) == [
        "beneficiaryName", "issueDate", "issuingBank", "maturityDate",
    ]  # fmt: skip
    assert one(get_pool(), "SELECT status FROM instruments WHERE id = $1", [instrument_id])["status"] == "DRAFT"


def test_ac2_a_full_submission_creates_seven_claimed_provenance_rows_and_both_events(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1)
    res = submit(u.inst1, instrument_id)
    assert res.status_code == 200
    body = res.json()
    assert (body["status"], body["verificationState"], body["missingDocs"]) == ("SUBMITTED", "UNVERIFIED", [])
    assert body["submittedAt"] == "2026-10-25T04:30:00.000Z"

    prov = many(
        get_pool(),
        "SELECT field_name, tier, source, value FROM field_provenance WHERE instrument_id = $1 ORDER BY field_name",
        [instrument_id],
    )
    assert len(prov) == 7
    assert all(p["tier"] == "CLAIMED" and p["source"] == "institution" for p in prov)
    assert {p["field_name"]: p["value"] for p in prov} == {
        "amount": "2500000.00",
        "beneficiary_name": "Member Secretary, AICTE",
        "issue_date": "2026-04-01",
        "issuing_bank": "State Bank of India",
        "lien_marked": "true",
        "maturity_date": "2027-04-01",
        "reference_no": "SBIN/FDR/2026/00731",
    }
    assert count_events("instrument_id = $1 AND action = 'STATUS_SUBMITTED'", [instrument_id]) == 1
    assert count_events("instrument_id = $1 AND action = 'INSTRUMENT_SUBMITTED'", [instrument_id]) == 1
    ev = one(
        get_pool(),
        "SELECT after_json FROM events WHERE instrument_id = $1 AND action = 'INSTRUMENT_SUBMITTED'",
        [instrument_id],
    )
    assert ev["after_json"]["amount"] == "2500000.00"
    assert ev["after_json"]["reference_no"] == "SBIN/FDR/2026/00731"


def test_ac3_submitting_twice_is_409_invalid_transition(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1)
    ok_submit(u.inst1, instrument_id)
    again = submit(u.inst1, instrument_id)
    assert again.status_code == 409
    assert again.json()["code"] == "INVALID_TRANSITION"
    assert count_events("instrument_id = $1 AND action = 'STATUS_SUBMITTED'", [instrument_id]) == 1


def test_ac7_patch_with_an_old_version_is_409_stale_version(u: Users) -> None:
    draft = create_draft_via_api(u.inst1)
    instrument_id, version = draft["id"], draft["version"]
    path = f"/api/v1/instruments/{instrument_id}"
    first = api().patch(path, headers=bearer(u.inst1), json={"amount": "30,00,000", "version": version})
    assert first.status_code == 200
    assert (first.json()["amount"], first.json()["version"]) == ("3000000.00", version + 1)
    second = api().patch(path, headers=bearer(u.inst1), json={"amount": "35,00,000", "version": version})
    assert second.status_code == 409
    assert second.json()["code"] == "STALE_VERSION"

    edited = one(
        get_pool(),
        "SELECT before_json, after_json FROM events WHERE instrument_id = $1 AND action = 'INSTRUMENT_EDITED'",
        [instrument_id],
    )
    assert edited == {"before_json": {"amount": "2500000.00"}, "after_json": {"amount": "3000000.00"}}


def test_ac8_duplicate_bank_and_reference_live_409_released_allowed(u: Users) -> None:
    first = ready_fdr(u.inst1)
    ok_submit(u.inst1, first)

    dup = api().post(
        "/api/v1/instruments", headers=bearer(u.inst2), json={**VALID_FDR, "referenceNo": "sbin/fdr/2026/00731"}
    )
    assert dup.status_code == 409
    assert dup.json()["code"] == "DUPLICATE_REFERENCE"
    assert "Submitted" in dup.json()["message"]

    # A draft without the reference can't take it by editing either.
    other = create_draft_via_api(u.inst2, {**VALID_FDR, "referenceNo": "SBIN/FDR/2026/99999"})
    patch = api().patch(
        f"/api/v1/instruments/{other['id']}",
        headers=bearer(u.inst2),
        json={"referenceNo": "SBIN/FDR/2026/00731", "version": other["version"]},
    )
    assert patch.status_code == 409
    assert patch.json()["code"] == "DUPLICATE_REFERENCE"

    # Once the first is released (set up directly: release workflow is Phase 6), the reference is free again.
    exec_(get_pool(), "UPDATE instruments SET status = 'RELEASED' WHERE id = $1", [first])
    assert api().post("/api/v1/instruments", headers=bearer(u.inst2), json=VALID_FDR).status_code == 201


def test_ac9_d5_resubmission_resets_only_the_changed_field_to_claimed(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1)
    ok_submit(u.inst1, instrument_id)
    # Simulate Phase 3 outcome via SQL: two fields bank-confirmed, then returned.
    exec_(
        get_pool(),
        "UPDATE field_provenance SET tier = 'BANK_CONFIRMED', source = 'bank'"
        " WHERE instrument_id = $1 AND field_name IN ('amount', 'issue_date')",
        [instrument_id],
    )
    exec_(
        get_pool(),
        "UPDATE instruments SET status = 'RETURNED', verification_state = 'MISMATCH' WHERE id = $1",
        [instrument_id],
    )

    path = f"/api/v1/instruments/{instrument_id}"
    cur = api().get(path, headers=bearer(u.inst1)).json()
    edit = api().patch(path, headers=bearer(u.inst1), json={"amount": "20,00,000", "version": cur["version"]})
    assert edit.status_code == 200
    res = submit(u.inst1, instrument_id)
    assert res.status_code == 200
    assert (res.json()["status"], res.json()["verificationState"]) == ("SUBMITTED", "UNVERIFIED")
    tiers = {p["fieldName"]: f"{p['tier']}:{p['value']}" for p in res.json()["provenance"]}
    assert tiers["amount"] == "CLAIMED:2000000.00"
    assert tiers["issue_date"] == "BANK_CONFIRMED:2026-04-01"


def test_d5_resubmission_with_no_change_keeps_tiers_and_verification_state(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1)
    ok_submit(u.inst1, instrument_id)
    exec_(get_pool(), "UPDATE field_provenance SET tier = 'BANK_CONFIRMED' WHERE instrument_id = $1", [instrument_id])
    exec_(
        get_pool(),
        "UPDATE instruments SET status = 'RETURNED', verification_state = 'CONFIRMED' WHERE id = $1",
        [instrument_id],
    )
    res = submit(u.inst1, instrument_id)
    assert res.json()["verificationState"] == "CONFIRMED"
    assert all(p["tier"] == "BANK_CONFIRMED" for p in res.json()["provenance"])


def test_maturity_date_in_the_past_at_submit_is_422_on_maturity_date_d25(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1, {**VALID_FDR, "issueDate": "2025-01-01", "maturityDate": "2026-01-01"})
    res = submit(u.inst1, instrument_id)
    assert res.status_code == 422
    details = res.json()["details"]
    assert details["missingDocuments"] == []
    assert [f["field"] for f in details["fields"]] == ["maturityDate"]
    assert isinstance(details["fields"][0]["message"], str)


def test_maturity_before_issue_is_rejected_on_save(u: Users) -> None:
    res = api().post("/api/v1/instruments", headers=bearer(u.inst1), json={**VALID_FDR, "maturityDate": "2026-03-01"})
    assert res.status_code == 422
    assert [d["field"] for d in res.json()["details"]] == ["maturityDate"]


def test_upload_or_edit_after_submission_is_409_invalid_state(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1)
    ok_submit(u.inst1, instrument_id)
    up = upload_doc(u.inst1, instrument_id, "OTHER")
    assert up.status_code == 409
    assert up.json()["code"] == "INVALID_STATE"
    path = f"/api/v1/instruments/{instrument_id}"
    cur = api().get(path, headers=bearer(u.inst1)).json()
    patch = api().patch(path, headers=bearer(u.inst1), json={"branch": "X", "version": cur["version"]})
    assert patch.status_code == 409
    assert patch.json()["code"] == "INVALID_STATE"


def test_roles_and_ownership_only_the_owning_institution_creates_edits_submits(u: Users) -> None:
    officer = user_for("officer@demo.in")
    assert api().post("/api/v1/instruments", headers=bearer(officer), json=VALID_FDR).status_code == 403
    instrument_id = ready_fdr(u.inst1)
    path = f"/api/v1/instruments/{instrument_id}"
    assert submit(u.inst2, instrument_id).status_code == 404
    assert api().patch(path, headers=bearer(u.inst2), json={"version": 1, "branch": "x"}).status_code == 404
    assert api().delete(path, headers=bearer(u.inst2)).status_code == 404


def test_delete_draft_hard_delete_with_event_refused_once_submitted(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1)
    assert api().delete(f"/api/v1/instruments/{instrument_id}", headers=bearer(u.inst1)).status_code == 204
    assert api().get(f"/api/v1/instruments/{instrument_id}", headers=bearer(u.inst1)).status_code == 404
    assert count_events("instrument_id = $1 AND action = 'INSTRUMENT_DRAFT_DELETED'", [instrument_id]) == 1

    id2 = ready_fdr(u.inst1)
    ok_submit(u.inst1, id2)
    refused = api().delete(f"/api/v1/instruments/{id2}", headers=bearer(u.inst1))
    assert refused.status_code == 409
    assert refused.json()["code"] == "INVALID_STATE"


def test_every_write_keeps_the_audit_chain_intact(u: Users) -> None:
    instrument_id = ready_fdr(u.inst1)
    ok_submit(u.inst1, instrument_id)
    result = verify_chain(get_pool())
    assert result["ok"] is True and result["firstBrokenId"] is None
