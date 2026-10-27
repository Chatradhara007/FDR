"""Suspicious-pattern flags: advisory only, computed on submission and on verify, never shown to institutions."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from app.db.pool import exec_, get_pool, many
from helpers import (
    VALID_FDR,
    SeededUser,
    api,
    bearer,
    count_events,
    make_instrument,
    ready_fdr,
    reset_db,
    set_today,
    user_for,
)
from httpx import Response


@dataclass(frozen=True)
class Ctx:
    inst1: SeededUser
    inst2: SeededUser
    officer: SeededUser
    admin: SeededUser
    bank_url: str


@pytest.fixture
def c(bank_url: str, monkeypatch: pytest.MonkeyPatch) -> Ctx:
    monkeypatch.setenv("MOCK_BANK_URL", bank_url)
    reset_db()
    set_today("2026-10-25")
    return Ctx(user_for("inst1@demo.in"), user_for("inst2@demo.in"), user_for("officer@demo.in"),
               user_for("admin@demo.in"), bank_url)  # fmt: skip


def get(user: SeededUser, path: str) -> Response:
    return api().get(f"/api/v1{path}", headers=bearer(user))


def post(user: SeededUser, path: str, body: dict[str, Any] | None = None) -> Response:
    return api().post(f"/api/v1{path}", headers=bearer(user), json=body or {})


def submit(c: Ctx, **fields: Any) -> str:
    instrument_id = ready_fdr(c.inst1, {**VALID_FDR, **fields})
    res = post(c.inst1, f"/instruments/{instrument_id}/submit")
    assert res.status_code == 200, res.text  # advisory flags never block a submission
    return instrument_id


def flags(c: Ctx, instrument_id: str) -> list[dict[str, Any]]:
    res = get(c.officer, f"/instruments/{instrument_id}/review")
    assert res.status_code == 200, res.text
    out: list[dict[str, Any]] = res.json()["advisoryFlags"]
    return out


def kinds(c: Ctx, instrument_id: str) -> list[str]:
    return [f["kind"] for f in flags(c, instrument_id)]


def usual_deposits(n: int = 3, amount: str = "1000000.00", email: str = "inst1@demo.in") -> None:
    """n submitted instruments of the institution, so its 'usual' amount is known."""
    for i in range(n):
        make_instrument("ACTIVE", "2027-12-01", ref=f"CNRB/FD/2025/1{i:04d}", amount=amount, institution_email=email)


def test_a_clean_submission_has_no_flags(c: Ctx) -> None:
    instrument_id = submit(c)
    assert flags(c, instrument_id) == []
    assert count_events("action = 'ADVISORY_FLAGS_UPDATED'") == 0


def test_same_reference_and_bank_at_another_institution_is_flagged(c: Ctx) -> None:
    # D7 stops two LIVE instruments sharing a reference; one that was released or renewed at another institution is
    # exactly the case worth a second look.
    make_instrument("RELEASED", "2026-06-01", ref="CNRB/FD/2025/00731", institution_email="inst2@demo.in")
    instrument_id = submit(c, referenceNo="cnrb/fd/2025/00731", issuingBank="Canara Bank")
    [flag] = flags(c, instrument_id)
    assert flag["kind"] == "DUPLICATE_REFERENCE"
    assert "also on record with another institution" in flag["reason"] and "Released" in flag["reason"]
    detail = json.dumps(flag["detail"])
    assert "Canara Bank" in detail
    # Same institution is not this pattern (D7 handles that), and another bank is a different reference.
    other_bank = submit(c, referenceNo="SBIN/FDR/2026/00999")
    assert kinds(c, other_bank) == []


def test_amount_more_than_three_times_the_institutions_median_is_flagged(c: Ctx) -> None:
    usual_deposits(3, "1000000.00")  # median ₹10,00,000
    exactly_three = submit(c, referenceNo="SBIN/FDR/2026/10001", amount="30,00,000")
    assert kinds(c, exactly_three) == []  # strictly more than 3x
    four_times = submit(c, referenceNo="SBIN/FDR/2026/10002", amount="40,00,000")
    [flag] = flags(c, four_times)
    assert flag["kind"] == "HIGH_AMOUNT" and flag["detail"]["multiple"] == 3
    assert "₹40,00,000" in flag["reason"] and "₹10,00,000" in flag["reason"] and "had lodged before" in flag["reason"]


def test_only_earlier_history_counts_so_a_later_big_deposit_does_not_re_flag_an_earlier_one(c: Ctx) -> None:
    usual_deposits(3, "1000000.00")
    first = submit(c, referenceNo="SBIN/FDR/2026/40001", amount="12,00,000")
    # A much larger deposit arrives later; the median of the institution's other instruments is now higher, but the
    # earlier instrument is judged against what existed when it was lodged, however often it is recomputed.
    exec_(get_pool(), "UPDATE instruments SET amount = 99000000.00 WHERE id <> $1 AND institution_id = $2",
          [first, c.inst1.institutionId])  # fmt: skip
    assert kinds(c, first) == []
    from app.db.pool import transaction
    from app.domain.audit import Actor
    from app.services.advisory_service import refresh_flags

    with transaction() as tx:
        refresh_flags(tx, first, Actor(label="test"))
    assert kinds(c, first) == []  # earlier instruments are now huge, the median is high: still not flagged


def test_too_little_history_means_no_amount_flag(c: Ctx) -> None:
    usual_deposits(2)
    assert kinds(c, submit(c, amount="90,00,000")) == []


def test_other_institutions_amounts_do_not_count(c: Ctx) -> None:
    usual_deposits(3, "100000.00", email="inst2@demo.in")
    assert kinds(c, submit(c, amount="90,00,000")) == []


def test_a_name_close_but_not_equal_is_flagged_and_an_equal_or_unrelated_one_is_not(c: Ctx) -> None:
    assert kinds(c, submit(c, referenceNo="SBIN/FDR/2026/20001", beneficiaryName="Member Secretary, AICTE")) == []
    assert kinds(c, submit(c, referenceNo="SBIN/FDR/2026/20002", beneficiaryName="MEMBER SECRETARY A.I.C.T.E")) == []
    near = submit(c, referenceNo="SBIN/FDR/2026/20003", beneficiaryName="Member Secretery, AICTI")
    [flag] = flags(c, near)
    assert flag["kind"] == "BENEFICIARY_NEAR_MISS" and "MEMBER SECRETARY AICTE" in flag["reason"]
    assert kinds(c, submit(c, referenceNo="SBIN/FDR/2026/20004", beneficiaryName="Sunrise Charitable Trust")) == []


def test_flags_never_block_or_move_a_status_a_verification_state_or_a_tier(c: Ctx) -> None:
    make_instrument("RELEASED", "2026-06-01", ref="SBIN/FDR/2026/00731", institution_email="inst2@demo.in")
    usual_deposits(3, "100000.00")
    # SBI reference reused at another institution + a huge amount + a look-alike name: three flags, all advisory.
    instrument_id = submit(c, beneficiaryName="Member Secretary, AICTI")
    exec_(get_pool(), "UPDATE instruments SET issuing_bank = 'State Bank of India' WHERE institution_id = $1 AND id <> $2",
          [c.inst2.institutionId, instrument_id])  # fmt: skip
    row = many(get_pool(), "SELECT status, verification_state FROM instruments WHERE id = $1", [instrument_id])[0]
    assert row == {"status": "SUBMITTED", "verification_state": "UNVERIFIED"}
    tiers = many(get_pool(), "SELECT DISTINCT tier FROM field_provenance WHERE instrument_id = $1", [instrument_id])
    assert tiers == [{"tier": "CLAIMED"}]
    assert {"HIGH_AMOUNT", "BENEFICIARY_NEAR_MISS"} <= set(kinds(c, instrument_id))


def test_verify_recomputes_and_unchanged_results_write_no_new_event(c: Ctx) -> None:
    res = httpx.post(f"{c.bank_url}/records/load", json={"records": [{
        "bank": "State Bank of India", "reference_no": "SBIN/FDR/2026/00731", "amount": "2500000.00",
        "issue_date": "2026-04-01", "maturity_date": "2027-04-01", "beneficiary_name": "MEMBER SECRETARY AICTE",
        "lien_marked": True, "lien_in_favour_of": "Member Secretary, AICTE", "status": "LIVE"}]})  # fmt: skip
    assert res.status_code == 200
    instrument_id = submit(c, beneficiaryName="Member Secretary, AICTI")
    assert (
        kinds(c, instrument_id) == ["BENEFICIARY_NEAR_MISS"] and count_events("action = 'ADVISORY_FLAGS_UPDATED'") == 1
    )
    assert post(c.officer, f"/instruments/{instrument_id}/claim").status_code == 200
    assert post(c.officer, f"/instruments/{instrument_id}/verify").status_code == 200
    assert kinds(c, instrument_id) == ["BENEFICIARY_NEAR_MISS"]
    assert count_events("action = 'ADVISORY_FLAGS_UPDATED'") == 1  # nothing changed, nothing recorded

    # An admin teaches the rule that this spelling is expected: the next verify clears the flag, and says so.
    rule = next(r for r in get(c.admin, "/rules").json() if r["key"] == "expected_beneficiary")
    config = {**rule["config"], "names": [*rule["config"]["names"], "Member Secretary, AICTI"]}
    put = api().put("/api/v1/rules/expected_beneficiary", headers=bearer(c.admin),
                    json={"config": config, "active": True, "version": rule["version"]})  # fmt: skip
    assert put.status_code == 200, put.text
    assert post(c.officer, f"/instruments/{instrument_id}/verify").status_code == 200
    assert kinds(c, instrument_id) == [] and count_events("action = 'ADVISORY_FLAGS_UPDATED'") == 2
    assert many(get_pool(), "SELECT count(*)::int AS n FROM advisory_flags WHERE cleared_at IS NOT NULL")[0]["n"] == 1


def test_expected_beneficiary_rule_validation(c: Ctx) -> None:
    rule = next(r for r in get(c.admin, "/rules").json() if r["key"] == "expected_beneficiary")
    bad = api().put("/api/v1/rules/expected_beneficiary", headers=bearer(c.admin), json={
        "config": {"names": [], "minSimilarity": 1.5, "amountMultiple": 1, "minComparisons": 0},
        "active": True, "version": rule["version"]})  # fmt: skip
    assert bad.status_code == 422
    assert {d["field"] for d in bad.json()["details"]} == {
        "config.names", "config.minSimilarity", "config.amountMultiple", "config.minComparisons",
    }  # fmt: skip


def test_institutions_never_see_flags_or_findings(c: Ctx) -> None:
    make_instrument("RELEASED", "2026-06-01", ref="CNRB/FD/2025/00731", institution_email="inst2@demo.in")
    instrument_id = submit(c, referenceNo="CNRB/FD/2025/00731", issuingBank="Canara Bank",
                           beneficiaryName="Member Secretary, AICTI")  # fmt: skip
    assert flags(c, instrument_id)
    for path in (f"/instruments/{instrument_id}", f"/instruments/{instrument_id}/passport", "/instruments",
                 "/release-requests", "/alerts", "/meta"):  # fmt: skip
        res = get(c.inst1, path)
        assert res.status_code == 200, path
        text = res.text.lower()
        for word in ("advisory", "documentfindings", "document_text_checked", "closer look"):
            assert word not in text, (path, word)
    assert get(c.inst1, f"/instruments/{instrument_id}/review").status_code == 403
    assert get(c.inst1, "/dashboard").status_code == 403
    # Officers see the events on the passport; institutions do not.
    officer_timeline = [
        e["action"] for e in get(c.officer, f"/instruments/{instrument_id}/passport").json()["timeline"]
    ]
    assert "ADVISORY_FLAGS_UPDATED" in officer_timeline


def test_dashboard_counts_open_flags(c: Ctx) -> None:
    assert get(c.officer, "/dashboard").json()["kpis"]["advisoryFlags"] == 0
    submit(c, beneficiaryName="Member Secretary, AICTI")
    submit(c, referenceNo="SBIN/FDR/2026/30001", beneficiaryName="Member Secretery AICTE")
    kpis = get(c.officer, "/dashboard").json()["kpis"]
    assert kpis["advisoryFlags"] == 2
    assert get(c.officer, "/dashboard?region=Nowhere").json()["kpis"]["advisoryFlags"] == 0
