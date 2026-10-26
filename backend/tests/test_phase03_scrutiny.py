"""Phase 03 acceptance checks 1–14: scrutiny, bank verification and trust tiers.

The real mock bank runs under uvicorn in a background thread (an external system on a real port).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from app.db.pool import exec_, get_pool, many, one
from app.domain.audit import verify_chain
from app.services import bank_client
from helpers import VALID_FDR, SeededUser, api, bearer, ready_fdr, reset_db, set_today, user_for
from httpx import Response


@dataclass(frozen=True)
class Ctx:
    inst1: SeededUser
    inst2: SeededUser
    officer: SeededUser
    bank_url: str

    def load(self, *records: dict[str, Any]) -> None:
        res = httpx.post(f"{self.bank_url}/records/load", json={"records": list(records)})
        assert res.status_code == 200, res.text


@pytest.fixture
def c(bank_url: str, monkeypatch: pytest.MonkeyPatch) -> Ctx:
    monkeypatch.setenv("MOCK_BANK_URL", bank_url)
    reset_db()
    set_today("2026-10-25")
    ctx = Ctx(user_for("inst1@demo.in"), user_for("inst2@demo.in"), user_for("officer@demo.in"), bank_url)
    ctx.load(record())
    return ctx


def record(**over: Any) -> dict[str, Any]:
    """The bank's true record for VALID_FDR (₹25,00,000) unless overridden."""
    return {
        "bank": "State Bank of India",
        "reference_no": "SBIN/FDR/2026/00731",
        "amount": "2500000.00",
        "issue_date": "2026-04-01",
        "maturity_date": "2027-04-01",
        "beneficiary_name": "MEMBER SECRETARY AICTE",
        "lien_marked": True,
        "lien_in_favour_of": "Member Secretary, AICTE",
        "status": "LIVE",
        **over,
    }


def post(user: SeededUser, path: str, body: dict[str, Any] | None = None) -> Response:
    return api().post(f"/api/v1{path}", headers=bearer(user), json=body or {})


def get(user: SeededUser, path: str) -> Response:
    return api().get(f"/api/v1{path}", headers=bearer(user))


def ok(res: Response, status: int = 200) -> Any:
    assert res.status_code == status, res.text
    return res.json()


def submitted(c: Ctx, **fields: Any) -> str:
    instrument_id = ready_fdr(c.inst1, {**VALID_FDR, **fields})
    ok(post(c.inst1, f"/instruments/{instrument_id}/submit"))
    return instrument_id


def claimed(c: Ctx, **fields: Any) -> str:
    instrument_id = submitted(c, **fields)
    ok(post(c.officer, f"/instruments/{instrument_id}/claim"))
    return instrument_id


def verify(c: Ctx, instrument_id: str) -> Any:
    return ok(post(c.officer, f"/instruments/{instrument_id}/verify"))


def tiers(review: Any) -> dict[str, str]:
    return {f["fieldName"]: f["tier"] for f in review["fields"]}


def open_discrepancies(instrument_id: str) -> list[dict[str, Any]]:
    return many(get_pool(), "SELECT * FROM discrepancies WHERE instrument_id = $1 AND status = 'OPEN'", [instrument_id])


def test_ac1_clean_instrument_is_bank_confirmed_on_every_field(c: Ctx) -> None:
    instrument_id = submitted(c)
    review = ok(post(c.officer, f"/instruments/{instrument_id}/claim"))
    assert review["instrument"]["status"] == "UNDER_SCRUTINY"
    assert review["instrument"]["assignedOfficerId"] == c.officer.id
    assert review["assignedOfficerName"] == c.officer.name

    body = verify(c, instrument_id)
    assert body["result"] == "CONFIRMED"
    review = body["review"]
    assert set(tiers(review).values()) == {"BANK_CONFIRMED"}
    assert all(f["source"].startswith("bank:rsp_") for f in review["fields"])
    assert review["instrument"]["verificationState"] == "CONFIRMED"
    assert review["instrument"]["weakestTier"] == "BANK_CONFIRMED"
    assert review["canAccept"] is True and review["acceptBlockers"] == []

    detail = ok(get(c.inst1, f"/instruments/{instrument_id}"))
    assert detail["weakestTier"] == "BANK_CONFIRMED"
    items = ok(get(c.officer, "/instruments"))["items"]
    assert [i["weakestTier"] for i in items] == ["BANK_CONFIRMED"]

    v = one(get_pool(), "SELECT * FROM verifications WHERE instrument_id = $1", [instrument_id])
    assert v["result"] == "CONFIRMED" and v["source"] == "mock-bank:State Bank of India"
    assert v["request_payload"]["amount"] == "2500000.00" and v["response_payload"]["result"] == "CONFIRMED"
    actions = [r["action"] for r in many(get_pool(), "SELECT action FROM events ORDER BY id")]
    assert actions[-3:] == ["INSTRUMENT_CLAIMED", "VERIFICATION_REQUESTED", "VERIFICATION_RESULT"]
    assert verify_chain(get_pool())["ok"] is True


def test_ac2_tampered_amount_opens_exactly_one_discrepancy(c: Ctx) -> None:
    c.load(record(amount="2000000.00"))
    instrument_id = claimed(c)
    body = verify(c, instrument_id)
    assert body["result"] == "MISMATCH"
    assert body["mismatchedFields"] == ["amount"]
    review = body["review"]
    assert review["instrument"]["verificationState"] == "MISMATCH"
    t = tiers(review)
    assert t.pop("amount") == "CLAIMED"
    assert set(t.values()) == {"BANK_CONFIRMED"}
    assert review["instrument"]["weakestTier"] == "CLAIMED"
    [d] = [d for d in review["discrepancies"] if d["status"] == "OPEN"]
    assert (d["fieldName"], d["claimedValue"], d["confirmedValue"], d["reason"]) == (
        "amount", "2500000.00", "2000000.00", "Amount mismatch",
    )  # fmt: skip
    assert len(open_discrepancies(instrument_id)) == 1


def test_ac3_verifying_again_does_not_duplicate_the_open_discrepancy(c: Ctx) -> None:
    c.load(record(amount="2000000.00"))
    instrument_id = claimed(c)
    verify(c, instrument_id)
    verify(c, instrument_id)
    assert len(open_discrepancies(instrument_id)) == 1
    assert int(one(get_pool(), "SELECT count(*) AS n FROM discrepancies")["n"]) == 1
    assert int(one(get_pool(), "SELECT count(*) AS n FROM verifications")["n"]) == 2


def test_ac4_offline_bank_is_unavailable_and_the_page_still_works(c: Ctx) -> None:
    c.load(record(bank="Indian Overseas Bank", reference_no="IOBA/FD/2026/03381"))
    instrument_id = claimed(c, issuingBank="Indian Overseas Bank", referenceNo="IOBA/FD/2026/03381")
    body = verify(c, instrument_id)
    assert body["result"] == "UNAVAILABLE"
    assert body["review"]["instrument"]["verificationState"] == "UNAVAILABLE"
    review = ok(get(c.officer, f"/instruments/{instrument_id}/review"))
    assert review["canAccept"] is False and review["canAcceptWithOverride"] is True
    assert set(tiers(review).values()) == {"CLAIMED"}


def test_ac4_unreachable_bank_or_timeout_is_unavailable(c: Ctx, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOCK_BANK_URL", "http://127.0.0.1:9")
    instrument_id = claimed(c)
    body = verify(c, instrument_id)
    assert body["result"] == "UNAVAILABLE"
    assert "reached" in body["reason"]
    payload = bank_client.verify_with_bank(
        {"reference_no": "X", "bank": "State Bank of India", "amount": "1.00", "issue_date": "", "maturity_date": "",
         "beneficiary_name": "", "lien_marked": "false"},
        timeout_ms=1,
    )  # fmt: skip
    assert payload["result"] == "UNAVAILABLE"


def test_ac5_slow_bank_is_pending_then_answers(c: Ctx) -> None:
    c.load(record(bank="Bank of India", reference_no="BKID/FD/2026/20415"))
    instrument_id = claimed(c, issuingBank="Bank of India", referenceNo="BKID/FD/2026/20415")
    first = verify(c, instrument_id)
    assert first["result"] == "PENDING"
    assert first["retryAfterSeconds"] == 1
    assert first["review"]["instrument"]["verificationState"] == "PENDING"
    time.sleep(1.1)
    second = verify(c, instrument_id)
    assert second["result"] == "CONFIRMED"
    assert second["review"]["instrument"]["verificationState"] == "CONFIRMED"


def test_ac6_not_found_opens_a_reference_discrepancy(c: Ctx) -> None:
    c.load()
    instrument_id = claimed(c)
    body = verify(c, instrument_id)
    assert body["result"] == "NOT_FOUND"
    assert body["review"]["instrument"]["verificationState"] == "MISMATCH"
    [d] = open_discrepancies(instrument_id)
    assert (d["field_name"], d["reason"], d["confirmed_value"]) == ("reference_no", "No record at bank", None)


def test_closed_deposit_opens_a_reference_discrepancy(c: Ctx) -> None:
    c.load(record(status="CLOSED"))
    instrument_id = claimed(c)
    assert verify(c, instrument_id)["result"] == "MISMATCH"
    [d] = open_discrepancies(instrument_id)
    assert (d["field_name"], d["reason"]) == ("reference_no", "Deposit closed at bank")


def test_ac7_accept_needs_bank_confirmation_or_an_override_note(c: Ctx) -> None:
    c.load(record(amount="2000000.00"))
    instrument_id = claimed(c)
    review = verify(c, instrument_id)["review"]
    assert review["canAccept"] is False

    res = post(c.officer, f"/instruments/{instrument_id}/accept")
    assert res.status_code == 409 and res.json()["code"] == "ACCEPT_BLOCKED"
    reasons = res.json()["details"]["reasons"]
    assert "Open discrepancy: Amount (Amount mismatch)" in reasons
    assert any(r.startswith("Not confirmed by the bank") for r in reasons)
    # The override note does not lift an open discrepancy.
    assert post(c.officer, f"/instruments/{instrument_id}/accept", {"overrideNote": "x"}).status_code == 409

    [d] = review["discrepancies"]
    assert post(c.officer, f"/discrepancies/{d['id']}/resolve", {"note": " "}).status_code == 422
    after = ok(post(c.officer, f"/discrepancies/{d['id']}/resolve", {"note": "Institution letter explains it"}))
    assert after["instrument"]["verificationState"] == "MISMATCH"
    assert after["canAccept"] is False and after["canAcceptWithOverride"] is True

    res = post(c.officer, f"/instruments/{instrument_id}/accept")
    assert res.status_code == 409
    assert [r for r in res.json()["details"]["reasons"] if not r.startswith("Not confirmed")] == []

    accepted = ok(post(c.officer, f"/instruments/{instrument_id}/accept", {"overrideNote": "Confirmed by phone"}))
    inst = accepted["instrument"]
    assert inst["status"] == "ACTIVE"
    assert (inst["acceptedWithOverride"], inst["overrideNote"], inst["acceptedBy"]) == (
        True, "Confirmed by phone", c.officer.id,
    )  # fmt: skip
    actions = [r["action"] for r in many(get_pool(), "SELECT action FROM events ORDER BY id")]
    assert actions[-3:] == ["STATUS_ACTIVE", "INSTRUMENT_ACCEPTED", "ACCEPTED_WITH_OVERRIDE"]


def test_ac8_normal_path_return_correct_resubmit_reverify_accept(c: Ctx) -> None:
    c.load(record(amount="2000000.00"))
    instrument_id = claimed(c)
    verify(c, instrument_id)

    assert post(c.officer, f"/instruments/{instrument_id}/return", {}).status_code == 422
    returned = ok(
        post(c.officer, f"/instruments/{instrument_id}/return", {"reason": "Amount does not match bank record"})
    )
    assert returned["instrument"]["status"] == "RETURNED"

    detail = ok(get(c.inst1, f"/instruments/{instrument_id}"))
    assert detail["returns"][0]["reason"] == "Amount does not match bank record"
    ok(api().patch(f"/api/v1/instruments/{instrument_id}", headers=bearer(c.inst1),
                   json={"amount": "20,00,000", "version": detail["version"]}))  # fmt: skip
    resubmitted = ok(post(c.inst1, f"/instruments/{instrument_id}/submit"))
    t = {p["fieldName"]: p["tier"] for p in resubmitted["provenance"]}
    assert t.pop("amount") == "CLAIMED"
    assert set(t.values()) == {"BANK_CONFIRMED"}  # D5
    assert resubmitted["verificationState"] == "UNVERIFIED"

    ok(post(c.officer, f"/instruments/{instrument_id}/claim"))
    body = verify(c, instrument_id)
    assert body["result"] == "CONFIRMED"
    assert open_discrepancies(instrument_id) == []
    [d] = body["review"]["discrepancies"]
    assert d["resolutionNote"].startswith("Confirmed by bank response rsp_")
    accepted = ok(post(c.officer, f"/instruments/{instrument_id}/accept"))
    assert accepted["instrument"]["status"] == "ACTIVE"
    assert accepted["instrument"]["acceptedWithOverride"] is False


def test_ac9_open_blocking_observation_blocks_accept_until_resolved(c: Ctx) -> None:
    instrument_id = claimed(c)
    verify(c, instrument_id)
    review = ok(
        post(
            c.officer,
            f"/instruments/{instrument_id}/observations",
            {"text": "Bank letter unsigned", "severity": "BLOCKING"},
        ),
        201,
    )
    assert review["canAccept"] is False
    res = post(c.officer, f"/instruments/{instrument_id}/accept")
    assert res.status_code == 409
    assert res.json()["details"]["reasons"] == ["Blocking observation: Bank letter unsigned"]
    [o] = review["observations"]
    ok(post(c.officer, f"/observations/{o['id']}/resolve", {"note": "Signed copy received"}))
    assert ok(post(c.officer, f"/instruments/{instrument_id}/accept"))["instrument"]["status"] == "ACTIVE"


def test_ac10_fdr_without_lien_cannot_be_accepted(c: Ctx) -> None:
    c.load(record(lien_marked=False, lien_in_favour_of=None))
    instrument_id = claimed(c, lienMarked=False)
    assert verify(c, instrument_id)["result"] == "CONFIRMED"
    res = post(c.officer, f"/instruments/{instrument_id}/accept", {"overrideNote": "please"})
    assert res.status_code == 409
    assert res.json()["details"]["reasons"] == ["Lien not marked in favour of AICTE"]


def test_ac11_document_check_raises_claimed_and_never_lowers_bank_confirmed(c: Ctx) -> None:
    instrument_id = claimed(c)
    review = ok(get(c.officer, f"/instruments/{instrument_id}/review"))
    doc = next(d for d in review["instrument"]["documents"] if d["docType"] == "FDR_COPY")
    checked = ok(
        post(c.officer, f"/instruments/{instrument_id}/fields/amount/check-document", {"documentId": doc["id"]})
    )
    assert checked["unchanged"] is False
    amount = next(f for f in checked["review"]["fields"] if f["fieldName"] == "amount")
    assert (amount["tier"], amount["source"]) == ("DOCUMENT", f"document:{doc['id']}")
    assert checked["review"]["instrument"]["weakestTier"] == "CLAIMED"

    verify(c, instrument_id)
    again = ok(post(c.officer, f"/instruments/{instrument_id}/fields/amount/check-document", {"documentId": doc["id"]}))
    assert again["unchanged"] is True
    assert tiers(again["review"])["amount"] == "BANK_CONFIRMED"

    bad = post(c.officer, f"/instruments/{instrument_id}/fields/amount/check-document", {"documentId": "nope"})
    assert bad.status_code == 422 and bad.json()["details"][0]["field"] == "documentId"
    assert (
        post(
            c.officer, f"/instruments/{instrument_id}/fields/colour/check-document", {"documentId": doc["id"]}
        ).status_code
        == 404
    )


def test_ac12_version_change_during_verification_is_stored_stale(c: Ctx, monkeypatch: pytest.MonkeyPatch) -> None:
    instrument_id = claimed(c)
    real = bank_client.verify_with_bank

    def racing(payload: bank_client.BankPayload, timeout_ms: int = 5000) -> bank_client.BankResult:
        exec_(get_pool(), "UPDATE instruments SET version = version + 1 WHERE id = $1", [instrument_id])
        return real(payload, timeout_ms)

    monkeypatch.setattr(bank_client, "verify_with_bank", racing)
    res = post(c.officer, f"/instruments/{instrument_id}/verify")
    assert res.status_code == 409
    assert res.json()["code"] == "INSTRUMENT_CHANGED"
    v = one(get_pool(), "SELECT result, response_payload FROM verifications WHERE instrument_id = $1", [instrument_id])
    assert v["result"] == "STALE" and v["response_payload"]["result"] == "CONFIRMED"
    review = ok(get(c.officer, f"/instruments/{instrument_id}/review"))
    assert review["instrument"]["verificationState"] == "UNVERIFIED"
    assert set(tiers(review).values()) == {"CLAIMED"}


def test_ac13_institutions_cannot_act_and_do_not_see_internal_observations(c: Ctx) -> None:
    instrument_id = claimed(c)
    ok(post(c.officer, f"/instruments/{instrument_id}/observations", {"text": "Internal note"}), 201)
    ok(post(c.officer, f"/instruments/{instrument_id}/observations",
            {"text": "Please upload the lien letter", "severity": "CONCERN", "visibleToInstitution": True}), 201)  # fmt: skip
    for path in ("claim", "verify", "accept", "return", "observations", "fields/amount/check-document"):
        assert post(c.inst1, f"/instruments/{instrument_id}/{path}", {"reason": "x", "text": "x"}).status_code == 403
    assert get(c.inst1, f"/instruments/{instrument_id}/review").status_code == 403
    assert get(c.inst1, "/scrutiny/queue").status_code == 403
    obs_id = one(get_pool(), "SELECT id FROM observations LIMIT 1")["id"]
    assert post(c.inst1, f"/observations/{obs_id}/resolve", {"note": "x"}).status_code == 403

    detail = ok(get(c.inst1, f"/instruments/{instrument_id}"))
    assert [o["text"] for o in detail["observations"]] == ["Please upload the lien letter"]
    assert len(ok(get(c.officer, f"/instruments/{instrument_id}"))["observations"]) == 2
    assert get(c.inst2, f"/instruments/{instrument_id}").status_code == 404


def test_ac14_reverifying_an_active_instrument_opens_a_discrepancy_without_status_change(c: Ctx) -> None:
    instrument_id = claimed(c)
    verify(c, instrument_id)
    ok(post(c.officer, f"/instruments/{instrument_id}/accept"))
    c.load(record(maturity_date="2027-03-13"))
    body = verify(c, instrument_id)
    assert body["result"] == "MISMATCH"
    inst = body["review"]["instrument"]
    assert (inst["status"], inst["verificationState"]) == ("ACTIVE", "MISMATCH")
    [d] = open_discrepancies(instrument_id)
    assert (d["field_name"], d["reason"], d["confirmed_value"]) == ("maturity_date", "Date inconsistency", "2027-03-13")
    # The contradicted bank confirmation no longer proves the value.
    assert tiers(body["review"])["maturity_date"] == "CLAIMED"


def test_queue_filters_ageing_and_claim_rules(c: Ctx) -> None:
    first = submitted(c)
    set_today("2026-11-01")
    second = submitted(c, referenceNo="SBIN/FDR/2026/00999")
    queue = ok(get(c.officer, "/scrutiny/queue"))
    assert queue["total"] == 2
    assert [(i["id"], i["ageingDays"]) for i in queue["items"]] == [(first, 7), (second, 0)]
    assert queue["items"][0]["institution"] == "Vasavi Institute of Engineering & Technology, Hyderabad"
    ok(post(c.officer, f"/instruments/{first}/claim"))
    assert post(c.officer, f"/instruments/{first}/claim").status_code == 409
    assert [i["id"] for i in ok(get(c.officer, "/scrutiny/queue?assigned=me"))["items"]] == [first]
    assert [i["id"] for i in ok(get(c.officer, "/scrutiny/queue?assigned=unassigned"))["items"]] == [second]
    assert ok(get(c.officer, "/scrutiny/queue?region=Southern"))["total"] == 0
    assert ok(get(c.officer, "/scrutiny/queue?verificationState=UNVERIFIED"))["total"] == 2
    assert get(c.officer, "/scrutiny/queue?assigned=everyone").status_code == 422
    assert ok(get(user_for("auditor@demo.in"), "/scrutiny/queue"))["total"] == 2
    assert post(user_for("approver@demo.in"), f"/instruments/{second}/claim").status_code == 403


def test_verification_is_refused_before_scrutiny(c: Ctx) -> None:
    instrument_id = submitted(c)
    res = post(c.officer, f"/instruments/{instrument_id}/verify")
    assert res.status_code == 409 and res.json()["code"] == "INVALID_STATE"
