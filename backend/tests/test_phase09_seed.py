"""Phase 09 acceptance checks 1, 2 and 4: the demo dataset (docs/seed-spec.md), its integrity, the demo routes."""

from __future__ import annotations

import os
import threading
from collections import Counter
from collections.abc import Iterator
from typing import Any

import pytest
from app.db.pool import get_pool, many, one, transaction
from app.domain import clock
from app.jobs.evaluate import JOB_LOCK
from app.seed.base import institution_uuid, user_uuid
from app.services import audit_service
from helpers import api, bearer, reset_db, user_for

SPEC_STATUS_COUNTS = {
    "ACTIVE": 16, "EXPIRING": 8, "MATURED": 3, "LAPSED": 3, "RENEWED": 6, "RELEASED": 4, "RELEASE_REQUESTED": 4,
    "SUBMITTED": 5, "UNDER_SCRUTINY": 7, "RETURNED": 2, "DRAFT": 2,
}  # fmt: skip


def fingerprint() -> dict[str, Any]:
    """Everything the seed produces, without ids and wall-clock values, so two runs can be compared."""
    db = get_pool()
    return {
        "instruments": many(db, """
            SELECT i.reference_no, i.issuing_bank, i.status, i.verification_state, i.amount, i.issue_date,
                   i.maturity_date, i.accepted_with_override, inst.aicte_id, i.version, i.submitted_at,
                   p.reference_no AS parent
              FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
              LEFT JOIN instruments p ON p.id = i.parent_instrument_id
             ORDER BY i.reference_no NULLS FIRST, i.created_at"""),
        "provenance": many(db, """
            SELECT i.reference_no, p.field_name, p.tier, p.value FROM field_provenance p
              JOIN instruments i ON i.id = p.instrument_id ORDER BY 1 NULLS FIRST, 2"""),
        "alerts": many(db, """
            SELECT i.reference_no, a.kind, a.level, a.status, a.recipient_role, a.due_date, a.created_at, a.resolution
              FROM alerts a JOIN instruments i ON i.id = a.instrument_id ORDER BY 1, 2, 3, 5, 6, 7"""),
        "events": many(db, "SELECT action, entity_type, created_at FROM events WHERE action <> 'DEMO_RESET' ORDER BY id"),
        "releases": many(db, """
            SELECT i.reference_no, r.status, r.current_level, r.refund_reference FROM release_requests r
              JOIN instruments i ON i.id = r.instrument_id ORDER BY 1"""),
    }  # fmt: skip


@pytest.fixture(scope="module")
def seeded(bank_url: str) -> Iterator[dict[str, Any]]:
    """Seeds twice through POST /demo/reset (as the admin) and keeps both results."""
    saved = {k: os.environ.get(k) for k in ("MOCK_BANK_URL", "DEMO_MODE")}
    os.environ["MOCK_BANK_URL"] = bank_url
    os.environ["DEMO_MODE"] = "true"
    reset_db()
    admin = bearer(user_for("admin@demo.in"))
    runs = []
    for _ in range(2):
        res = api().post("/api/v1/demo/reset", headers=admin)
        assert res.status_code == 200, res.text
        runs.append({"result": res.json(), "fingerprint": fingerprint()})
    yield {"runs": runs, "admin": admin}
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def by_ref(ref: str) -> dict[str, Any]:
    return one(get_pool(), "SELECT * FROM instruments WHERE reference_no = $1", [ref])


def test_ac1_distribution_matches_the_seed_spec(seeded: dict[str, Any]) -> None:
    db = get_pool()
    counts = {r["status"]: r["n"] for r in many(db, "SELECT status, count(*)::int AS n FROM instruments GROUP BY 1")}
    assert counts == SPEC_STATUS_COUNTS
    assert sum(counts.values()) == 60
    states = Counter(
        (r["status"], r["verification_state"]) for r in many(db, "SELECT status, verification_state FROM instruments")
    )
    # Live instruments: CONFIRMED except the two overrides (UNAVAILABLE) and A5 (MISMATCH after re-verification).
    assert states[("ACTIVE", "CONFIRMED")] == 14 and states[("ACTIVE", "UNAVAILABLE")] == 2
    for status in ("EXPIRING", "MATURED", "LAPSED", "RENEWED", "RELEASED"):
        assert states[(status, "CONFIRMED")] == SPEC_STATUS_COUNTS[status]
    assert states[("RELEASE_REQUESTED", "CONFIRMED")] == 3 and states[("RELEASE_REQUESTED", "MISMATCH")] == 1
    # In scrutiny: A3 unverified, five failed checks (2 amount, beneficiary, date, not found), one bank unavailable.
    assert states[("UNDER_SCRUTINY", "UNVERIFIED")] == 1
    assert states[("UNDER_SCRUTINY", "MISMATCH")] == 5
    assert states[("UNDER_SCRUTINY", "UNAVAILABLE")] == 1
    overrides = many(db, "SELECT issuing_bank FROM instruments WHERE accepted_with_override")
    assert [r["issuing_bank"] for r in overrides] == ["Indian Overseas Bank"] * 2
    # Every bank appears; the slow bank (Bank of India) has an instrument waiting for scrutiny.
    banks = {
        r["issuing_bank"]
        for r in many(db, "SELECT DISTINCT issuing_bank FROM instruments WHERE issuing_bank IS NOT NULL")
    }
    assert len(banks) == 11
    assert by_ref_bank("Bank of India")["status"] == "SUBMITTED"
    # 12 institutions, each with a user; every institution holds instruments.
    assert one(db, "SELECT count(*)::int AS n FROM institutions")["n"] == 12
    assert one(db, "SELECT count(DISTINCT institution_id)::int AS n FROM instruments")["n"] == 12


def by_ref_bank(bank: str) -> dict[str, Any]:
    return one(get_pool(), "SELECT * FROM instruments WHERE issuing_bank = $1", [bank])


def test_ac1_anchors_are_in_their_demo_state(seeded: dict[str, Any]) -> None:
    db = get_pool()
    d0 = clock.real_today()
    assert clock.mode(db) == "SIMULATED" and clock.today(db) == d0
    assert many(db, "SELECT id FROM instruments WHERE reference_no = 'SBIN/FDR/2026/00731'") == []  # A1
    a2 = by_ref("CNRB/FD/2025/11842")
    assert (a2["status"], a2["verification_state"], a2["amount"]) == ("ACTIVE", "CONFIRMED", "4000000.00")
    assert clock.days_between(d0, a2["maturity_date"]) == 97
    a3 = by_ref("HDFC/FD/2026/55210")
    assert (a3["status"], a3["verification_state"]) == ("UNDER_SCRUTINY", "UNVERIFIED")
    assert a3["assigned_officer_id"] == user_uuid("officer@demo.in")
    assert clock.ist_date(a3["submitted_at"]) == clock.add_days(d0, -6)
    a3_alert = one(db, "SELECT level, created_at, status FROM alerts WHERE instrument_id = $1 AND kind = "
                       "'PENDING_VERIFICATION'", [a3["id"]])  # fmt: skip
    assert a3_alert["level"] == 1 and a3_alert["status"] == "OPEN"
    assert clock.ist_date(a3_alert["created_at"]) == clock.add_days(d0, -1)
    a4 = by_ref("UBIN/FDR/2025/30418")
    assert (a4["status"], a4["amount"], clock.days_between(d0, a4["maturity_date"])) == ("EXPIRING", "3500000.00", 37)
    a5 = by_ref("PUNB/FDR/2024/77015")
    assert (a5["status"], a5["verification_state"]) == ("RELEASE_REQUESTED", "MISMATCH")
    disc = one(db, "SELECT field_name, claimed_value, confirmed_value, status FROM discrepancies WHERE instrument_id = $1",
               [a5["id"]])  # fmt: skip
    assert disc == {"field_name": "amount", "claimed_value": "1500000.00", "confirmed_value": "1450000.00",
                    "status": "OPEN"}  # fmt: skip
    req = one(db, "SELECT id, status FROM release_requests WHERE instrument_id = $1", [a5["id"]])
    assert req["status"] == "PENDING_CONDITIONS"
    assert all(c["met"] for c in many(db, "SELECT met FROM release_conditions WHERE release_request_id = $1 AND "
                                          "NOT auto", [req["id"]]))  # fmt: skip
    a6 = by_ref("ICIC/FD/2023/09981")
    assert a6["status"] == "LAPSED" and clock.days_between(a6["maturity_date"], d0) == 35
    assert one(db, "SELECT max(level) AS m FROM alerts WHERE instrument_id = $1 AND kind = 'OVERDUE_RENEWAL'",
               [a6["id"]])["m"] == 3  # fmt: skip
    a7 = by_ref("BARB/FDR/2022/12077")
    a7_req = one(db, "SELECT refund_reference, closed_at FROM release_requests WHERE instrument_id = $1", [a7["id"]])
    assert a7["status"] == "RELEASED" and a7_req["refund_reference"] == "PFMS/RF/2026/0457"
    assert clock.ist_date(a7_req["closed_at"]) == clock.add_days(d0, -30)
    a8 = [by_ref(r) for r in ("KKBK/FD/2021/00412", "KKBK/FD/2023/00977", "KKBK/FD/2025/01563")]
    assert [a["status"] for a in a8] == ["RENEWED", "RENEWED", "ACTIVE"]
    assert a8[1]["parent_instrument_id"] == a8[0]["id"] and a8[2]["parent_instrument_id"] == a8[1]["id"]
    assert clock.days_between(a8[0]["maturity_date"], a8[1]["issue_date"]) == 12
    assert clock.days_between(a8[1]["maturity_date"], a8[2]["issue_date"]) == -5
    a9 = by_ref("SBIN/FDR/2025/66120")
    a9_req = one(db, "SELECT status, current_level FROM release_requests WHERE instrument_id = $1", [a9["id"]])
    assert a9["amount"] == "12000000.00" and a9_req == {"status": "PENDING_APPROVAL", "current_level": 3}
    statuses = {r["status"] for r in many(db, "SELECT status FROM release_requests")}
    assert {"PENDING_CONDITIONS", "PENDING_APPROVAL", "RETURNED", "APPROVED"} == statuses


def test_ac1_reference_years_follow_issue_dates(seeded: dict[str, Any]) -> None:
    fixed = {"CNRB/FD/2025/11842", "HDFC/FD/2026/55210", "UBIN/FDR/2025/30418", "PUNB/FDR/2024/77015",
             "ICIC/FD/2023/09981", "BARB/FDR/2022/12077", "SBIN/FDR/2025/66120"}  # fmt: skip
    for r in many(get_pool(), "SELECT reference_no, issue_date FROM instruments WHERE reference_no IS NOT NULL"):
        if r["reference_no"] in fixed or r["issue_date"] is None:
            continue
        ref = r["reference_no"]
        # U5's claim transposes two digits (the not-found case); the year part is untouched.
        assert ref.split("/")[2] == r["issue_date"][:4], ref


def test_ac1_two_runs_identical_and_each_under_15_seconds(seeded: dict[str, Any]) -> None:
    first, second = seeded["runs"]
    for run in seeded["runs"]:
        assert run["result"]["durationMs"] < 15000, run["result"]
        assert run["result"]["instruments"] == 60
    assert first["fingerprint"] == second["fingerprint"]
    assert {k: first["result"][k] for k in ("instruments", "events", "alerts")} == {
        k: second["result"][k] for k in ("instruments", "events", "alerts")
    }


def test_ac2_integrity_ok_and_every_passport_timeline_chronological(seeded: dict[str, Any]) -> None:
    audit_service.clear_integrity_cache()
    res = api().get("/api/v1/audit/integrity?fresh=1", headers=bearer(user_for("auditor@demo.in")))
    assert res.status_code == 200 and res.json()["ok"] is True and res.json()["checked"] > 500
    auditor = bearer(user_for("auditor@demo.in"))
    for row in many(get_pool(), "SELECT id FROM instruments"):
        p = api().get(f"/api/v1/instruments/{row['id']}/passport", headers=auditor)
        assert p.status_code == 200
        events = sorted(p.json()["timeline"], key=lambda e: e["id"])
        times = [e["at"] for e in events]
        assert times == sorted(times), row["id"]
    # The whole log too: event ids (the hash-chain order) agree with the app-clock times.
    times = [r["created_at"] for r in many(get_pool(), "SELECT created_at FROM events ORDER BY id")]
    assert times == sorted(times)


def test_seeded_ids_are_stable_so_sessions_survive_a_reset(seeded: dict[str, Any]) -> None:
    db = get_pool()
    assert one(db, "SELECT id FROM users WHERE email = 'admin@demo.in'")["id"] == user_uuid("admin@demo.in")
    inst1 = one(db, "SELECT id FROM institutions WHERE aicte_id = '1-1234567890'")["id"]
    assert inst1 == institution_uuid("inst1")
    # The admin token from before both resets (the fixture's) still works.
    me = api().get("/api/v1/auth/me", headers=seeded["admin"])
    assert me.status_code == 200 and me.json()["email"] == "admin@demo.in"


def test_admin_token_survives_reset_and_removed_users_get_a_reset_message(seeded: dict[str, Any]) -> None:
    admin = seeded["admin"]
    created = api().post("/api/v1/users", headers=admin, json={
        "name": "Temp Officer", "email": "temp.officer@demo.in", "role": "officer", "password": "Temp1234"})  # fmt: skip
    assert created.status_code == 201, created.text
    temp = user_for("temp.officer@demo.in")
    assert api().get("/api/v1/auth/me", headers=bearer(temp)).status_code == 200

    assert api().post("/api/v1/demo/reset", headers=admin).status_code == 200
    assert api().get("/api/v1/auth/me", headers=admin).status_code == 200
    gone = api().get("/api/v1/auth/me", headers=bearer(temp))
    assert gone.status_code == 401
    assert gone.json()["code"] == "SESSION_ENDED"
    assert gone.json()["message"] == "Demo data was reset, sign in again"


def test_reset_is_refused_while_the_evaluation_job_runs(seeded: dict[str, Any]) -> None:
    holding, release = threading.Event(), threading.Event()

    def hold() -> None:
        with transaction() as tx:
            one(tx, "SELECT pg_advisory_xact_lock($1) AS ok", [JOB_LOCK])
            holding.set()
            release.wait(10)

    t = threading.Thread(target=hold)
    t.start()
    try:
        assert holding.wait(5)
        before = one(get_pool(), "SELECT count(*)::int AS n FROM events")["n"]
        res = api().post("/api/v1/demo/reset", headers=seeded["admin"])
        assert res.status_code == 409 and res.json()["code"] == "EVALUATION_RUNNING"
        assert one(get_pool(), "SELECT count(*)::int AS n FROM events")["n"] == before  # nothing was wiped
    finally:
        release.set()
        t.join()


def test_reset_needs_the_mock_bank(seeded: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    before = one(get_pool(), "SELECT count(*)::int AS n FROM instruments")["n"]
    monkeypatch.setenv("MOCK_BANK_URL", "http://127.0.0.1:9")
    res = api().post("/api/v1/demo/reset", headers=seeded["admin"])
    assert res.status_code == 503 and res.json()["code"] == "BANK_UNREACHABLE"
    assert one(get_pool(), "SELECT count(*)::int AS n FROM instruments")["n"] == before


def test_anchors_sample_files_and_bank_correction_validation(seeded: dict[str, Any]) -> None:
    admin = seeded["admin"]
    anchors = api().get("/api/v1/demo/anchors", headers=admin).json()
    assert [a["code"] for a in anchors] == [f"A{n}" for n in range(1, 10)]
    a1 = anchors[0]
    assert a1["instrumentId"] is None and a1["bankRecord"]["amount"] == "2000000.00"
    assert a1["bankRecord"]["maturityDate"] == clock.add_days(clock.real_today(), 355)
    assert anchors[3]["bankRecord"]["referenceNo"] == "UBIN/FDR/2026/40977"
    assert anchors[1]["status"] == "ACTIVE" and anchors[1]["instrumentId"]

    pdf = api().get("/api/v1/demo/files/fdr-copy", headers=admin)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-") and b"SBIN/FDR/2026/00731" in pdf.content
    assert api().get("/api/v1/demo/files/other", headers=admin).status_code == 404

    bad = api().post("/api/v1/demo/bank-correction", headers=admin,
                     json={"bank": "Nope", "referenceNo": "", "fields": {"amount": "abc", "issueDate": "x"}})  # fmt: skip
    assert bad.status_code == 422
    assert {d["field"] for d in bad.json()["details"]} == {"bank", "referenceNo", "fields.amount", "fields.issueDate"}
    empty = api().post("/api/v1/demo/bank-correction", headers=admin,
                       json={"bank": "Canara Bank", "referenceNo": "CNRB/FD/2025/11842", "fields": {}})  # fmt: skip
    assert empty.status_code == 422 and empty.json()["details"][0]["field"] == "fields"
    missing = api().post("/api/v1/demo/bank-correction", headers=admin,
                         json={"bank": "Canara Bank", "referenceNo": "CNRB/FD/2099/00001", "fields": {"amount": "1"}})  # fmt: skip
    assert missing.status_code == 404
    officer = bearer(user_for("officer@demo.in"))
    for method, path in (("POST", "/demo/reset"), ("POST", "/demo/bank-correction"), ("GET", "/demo/anchors"),
                         ("GET", "/demo/files/fdr-copy")):  # fmt: skip
        assert api().request(method, f"/api/v1{path}", headers=officer, json={}).status_code == 403


def test_ac4_demo_routes_404_when_demo_mode_is_off(seeded: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEMO_MODE", "false")
    admin = seeded["admin"]
    for method, path in (("POST", "/demo/reset"), ("POST", "/demo/bank-correction"), ("GET", "/demo/anchors"),
                         ("GET", "/demo/files/fdr-copy"), ("POST", "/demo/tamper"), ("GET", "/demo/users")):  # fmt: skip
        assert api().request(method, f"/api/v1{path}", headers=admin, json={}).status_code == 404, path
    assert api().get("/api/v1/meta", headers=admin).json()["demoMode"] is False


# ---- post-Phase-09 additions: advisory flags and the PDF text cross-check in the demo ----


def test_seed_has_exactly_the_two_deliberate_advisory_flags_and_nothing_else(seeded: dict[str, Any]) -> None:
    db = get_pool()
    rows = many(db, """SELECT i.reference_no, a.kind FROM advisory_flags a JOIN instruments i ON i.id = a.instrument_id
                        WHERE a.cleared_at IS NULL ORDER BY 1""")  # fmt: skip
    assert rows == [{"reference_no": "CNRB/FD/2026/36859", "kind": "BENEFICIARY_NEAR_MISS"},   # S4, a look-alike name
                    {"reference_no": "HDFC/FD/2026/32652", "kind": "HIGH_AMOUNT"}]  # fmt: skip  # F2, ₹80 L
    # Recomputing for every submitted instrument (what a later verify does) finds the same, nothing latent.
    from app.repositories.instrument_repo import find_instrument_by_id
    from app.services.advisory_service import _candidates

    found = []
    for r in many(db, "SELECT id FROM instruments WHERE status <> 'DRAFT'"):
        inst = find_instrument_by_id(db, r["id"])
        assert inst is not None
        found += [(inst["referenceNo"], c["kind"]) for c in _candidates(db, inst)]
    assert sorted(found, key=lambda t: str(t[0])) == [("CNRB/FD/2026/36859", "BENEFICIARY_NEAR_MISS"),
                                                      ("HDFC/FD/2026/32652", "HIGH_AMOUNT")]  # fmt: skip
    officer = bearer(user_for("officer@demo.in"))
    assert api().get("/api/v1/dashboard", headers=officer).json()["kpis"]["advisoryFlags"] == 2


def sample(name: str, admin: dict[str, str]) -> bytes:
    res = api().get(f"/api/v1/demo/files/{name}", headers=admin)
    assert res.status_code == 200, res.text
    return res.content


def test_a1_samples_the_fdr_copy_shows_the_claim_and_the_other_copy_a_different_amount(seeded: dict[str, Any]) -> None:
    from app.domain import doc_text

    admin = seeded["admin"]
    printed = {n: doc_text.analyse(sample(n, admin))["extracted"]["labelled"]["amount"]
               for n in ("fdr-copy", "fdr-copy-different-amount", "bank-letter")}  # fmt: skip
    assert printed == {"fdr-copy": "2500000.00", "fdr-copy-different-amount": "2000000.00", "bank-letter": "2000000.00"}
    assert api().get("/api/v1/demo/files/other", headers=admin).status_code == 404
    officer = bearer(user_for("officer@demo.in"))
    assert api().get("/api/v1/demo/files/fdr-copy-different-amount", headers=officer).status_code == 403


def test_a1_story_text_matches_the_claim_and_only_the_bank_reveals_the_mismatch(seeded: dict[str, Any]) -> None:
    admin = seeded["admin"]
    rec = api().get("/api/v1/demo/anchors", headers=admin).json()[0]["bankRecord"]
    inst1, officer = bearer(user_for("inst1@demo.in")), bearer(user_for("officer@demo.in"))
    created = api().post("/api/v1/instruments", headers=inst1, json={
        "type": "FDR", "referenceNo": rec["referenceNo"], "issuingBank": rec["bank"], "branch": "Main Branch",
        "amount": "25,00,000", "issueDate": rec["issueDate"], "maturityDate": rec["maturityDate"],
        "beneficiaryName": rec["beneficiaryName"], "lienMarked": True, "purpose": "Security deposit"})  # fmt: skip
    assert created.status_code == 201, created.text
    iid = created.json()["id"]
    # The demo files: the FDR copy (claimed amount), the FDR copy with a different amount, the bank letter.
    for doc_type, name in (("FDR_COPY", "fdr-copy"), ("FDR_COPY", "fdr-copy-different-amount"),
                           ("BANK_LETTER", "bank-letter")):  # fmt: skip
        res = api().post(f"/api/v1/instruments/{iid}/documents", headers=inst1, data={"docType": doc_type},
                         files={"file": (f"{name}.pdf", sample(name, admin), "application/pdf")})  # fmt: skip
        assert res.status_code == 201, res.text
    assert api().post(f"/api/v1/instruments/{iid}/submit", headers=inst1).status_code == 200
    review = api().get(f"/api/v1/instruments/{iid}/review", headers=officer).json()
    assert review["advisoryFlags"] == []  # A1 is an ordinary-sized deposit with the right name: nothing to flag
    copies = [f for f in review["documentFindings"]["items"] if f["docType"] == "FDR_COPY"]
    assert len(copies) == 2
    amount_result = sorted(next(c for c in f["checks"] if c["field"] == "amount")["result"] for f in copies)
    assert amount_result == ["DIFFERENT", "MATCH"]  # the first copy shows the claim, the second the bank's amount
    matching = next(f for f in copies if {c["field"]: c["result"] for c in f["checks"]}["amount"] == "MATCH")
    assert {c["result"] for c in matching["checks"]} == {"MATCH"}  # reference, amount and both dates
    different = next(f for f in copies if f is not matching)
    amount = next(c for c in different["checks"] if c["field"] == "amount")
    assert (amount["found"], amount["claimed"]) == ("2000000.00", "2500000.00")
    # Only the bank, not the text, tells the officer the claim is wrong; the tiers are untouched by the text.
    assert {f["tier"] for f in review["fields"]} == {"CLAIMED"}
    assert api().post(f"/api/v1/instruments/{iid}/claim", headers=officer).status_code == 200
    verify = api().post(f"/api/v1/instruments/{iid}/verify", headers=officer)
    assert verify.status_code == 200 and verify.json()["result"] == "MISMATCH"
    assert verify.json()["mismatchedFields"] == ["amount"]


def test_first_start_in_demo_mode_seeds_an_empty_database_only(
    seeded: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.server import seed_empty_demo

    before = one(get_pool(), "SELECT count(*)::int AS n FROM instruments")["n"]
    seed_empty_demo(wait_seconds=0)  # users exist: nothing happens
    assert one(get_pool(), "SELECT count(*)::int AS n FROM instruments")["n"] == before

    reset_db()
    with transaction() as tx:
        tx.execute("TRUNCATE users CASCADE")
    monkeypatch.setenv("MOCK_BANK_URL", "http://127.0.0.1:9")
    seed_empty_demo(wait_seconds=0)  # no mock bank: base users and rules, so someone can still sign in
    assert one(get_pool(), "SELECT count(*)::int AS n FROM users")["n"] == 18
    assert one(get_pool(), "SELECT count(*)::int AS n FROM instruments")["n"] == 0
