"""Phase 09 acceptance check 3: the whole demo script (docs/demo-script.md) through the API, as the right users, on
freshly seeded demo data. The tests run in file order and share state: each one is one step of the script."""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest
from app.db.pool import get_pool, one
from app.domain import clock
from app.services import audit_service
from helpers import api, bearer, reset_db, user_for
from httpx import Response

A1 = "SBIN/FDR/2026/00731"
A2 = "CNRB/FD/2025/11842"
A3 = "HDFC/FD/2026/55210"
A4 = "UBIN/FDR/2025/30418"
A4_NEW = "UBIN/FDR/2026/40977"
A5 = "PUNB/FDR/2024/77015"
A6 = "ICIC/FD/2023/09981"
A8 = ("KKBK/FD/2021/00412", "KKBK/FD/2023/00977", "KKBK/FD/2025/01563")
A9 = "SBIN/FDR/2025/66120"


@pytest.fixture(scope="module")
def demo(bank_url: str) -> Iterator[dict[str, Any]]:
    saved = {k: os.environ.get(k) for k in ("MOCK_BANK_URL", "DEMO_MODE")}
    os.environ["MOCK_BANK_URL"] = bank_url
    os.environ["DEMO_MODE"] = "true"
    reset_db()
    res = api().post("/api/v1/demo/reset", headers=bearer(user_for("admin@demo.in")))
    assert res.status_code == 200, res.text
    yield {"d0": res.json()["d0"]}
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def h(email: str) -> dict[str, str]:
    return bearer(user_for(email))


def ok(res: Response, status: int = 200) -> Any:
    assert res.status_code == status, res.text
    return res.json()


def get(email: str, path: str) -> Any:
    return ok(api().get(f"/api/v1{path}", headers=h(email)))


def post(email: str, path: str, body: object | None = None, status: int = 200) -> Any:
    return ok(api().post(f"/api/v1{path}", headers=h(email), json=body if body is not None else {}), status)


def instrument_id(ref: str) -> str:
    row = one(get_pool(), "SELECT id FROM instruments WHERE reference_no = $1 ORDER BY created_at DESC LIMIT 1", [ref])
    return str(row["id"])


def upload(email: str, inst_id: str, doc_type: str, name: str) -> None:
    pdf = api().get(f"/api/v1/demo/files/{name}", headers=h("admin@demo.in")).content
    res = api().post(f"/api/v1/instruments/{inst_id}/documents", headers=h(email), data={"docType": doc_type},
                     files={"file": (f"{name}.pdf", pdf, "application/pdf")})  # fmt: skip
    assert res.status_code == 201, res.text


def test_step1_new_submission_with_a_wrong_amount(demo: dict[str, Any]) -> None:
    a1 = get("admin@demo.in", "/demo/anchors")[0]["bankRecord"]
    body = {"type": "FDR", "referenceNo": A1, "issuingBank": "State Bank of India", "branch": "Main Branch",
            "amount": "25,00,000", "issueDate": a1["issueDate"], "maturityDate": a1["maturityDate"],
            "beneficiaryName": a1["beneficiaryName"], "lienMarked": True}  # fmt: skip
    created = post("inst1@demo.in", "/instruments", body, 201)
    demo["a1"] = created["id"]
    upload("inst1@demo.in", created["id"], "FDR_COPY", "fdr-copy")
    upload("inst1@demo.in", created["id"], "BANK_LETTER", "bank-letter")
    detail = get("inst1@demo.in", f"/instruments/{created['id']}")
    assert detail["missingDocs"] == []
    submitted = post("inst1@demo.in", f"/instruments/{created['id']}/submit", {"version": detail["version"]})
    assert submitted["status"] == "SUBMITTED"
    assert {p["tier"] for p in submitted["provenance"]} == {"CLAIMED"} and len(submitted["provenance"]) == 7


def test_step2_verification_catches_the_amount_and_blocks_accept(demo: dict[str, Any]) -> None:
    a1 = demo["a1"]
    queue = get("officer@demo.in", "/scrutiny/queue?assigned=all&pageSize=100")
    assert a1 in [i["id"] for i in queue["items"]]
    post("officer@demo.in", f"/instruments/{a1}/claim")
    v = post("officer@demo.in", f"/instruments/{a1}/verify")
    assert v["result"] == "MISMATCH" and v["mismatchedFields"] == ["amount"]
    review = v["review"]
    disc = review["discrepancies"][0]
    assert (disc["fieldName"], disc["claimedValue"], disc["confirmedValue"]) == ("amount", "2500000.00", "2000000.00")
    tiers = {f["fieldName"]: f["tier"] for f in review["fields"]}
    assert tiers.pop("amount") == "CLAIMED" and set(tiers.values()) == {"BANK_CONFIRMED"} and len(tiers) == 6
    assert review["canAccept"] is False and any("Amount" in b for b in review["acceptBlockers"])
    assert api().post(f"/api/v1/instruments/{a1}/accept", headers=h("officer@demo.in"), json={}).status_code == 409
    post("officer@demo.in", f"/instruments/{a1}/return", {"reason": "Amount does not match bank record"})
    # The corrected resubmission re-verifies; only the amount was ever in doubt.
    detail = get("inst1@demo.in", f"/instruments/{a1}")
    assert detail["status"] == "RETURNED" and detail["returns"][0]["reason"] == "Amount does not match bank record"
    ok(api().patch(f"/api/v1/instruments/{a1}", headers=h("inst1@demo.in"),
                   json={"amount": "20,00,000", "version": detail["version"]}))  # fmt: skip
    detail = get("inst1@demo.in", f"/instruments/{a1}")
    post("inst1@demo.in", f"/instruments/{a1}/submit", {"version": detail["version"]})
    post("officer@demo.in", f"/instruments/{a1}/claim")
    assert post("officer@demo.in", f"/instruments/{a1}/verify")["result"] == "CONFIRMED"
    accepted = post("officer@demo.in", f"/instruments/{a1}/accept")
    assert accepted["instrument"]["status"] == "ACTIVE"


def test_step3_dashboard(demo: dict[str, Any]) -> None:
    d = get("approver@demo.in", "/dashboard")
    assert d["asOf"] == demo["d0"]
    groups = {g["key"]: g["count"] for g in d["byStatus"]}
    assert groups == {"ACTIVE": 17, "EXPIRING": 8, "MATURED": 3, "LAPSED": 3, "RENEWED": 6, "RELEASE_REQUESTED": 4,
                      "RELEASED": 4, "PENDING": 12, "RETURNED": 2}  # fmt: skip
    assert d["kpis"]["pendingScrutiny"] == 12 and d["kpis"]["openDiscrepancies"] >= 6
    assert 0 < d["kpis"]["confirmedPct"] < 100
    assert {r["region"] for r in d["byRegion"]} >= {"Southern", "Northern", "Eastern", "Western"}


def test_step4_the_clock_jump_makes_a2_expiring_and_fires_reminders(demo: dict[str, Any]) -> None:
    before = get("officer@demo.in", "/myday")["items"]
    change = post("admin@demo.in", "/clock/advance", {"days": 7})
    assert change["clock"]["today"] == clock.add_days(demo["d0"], 7)
    s = change["summary"]
    assert s["statusChanges"] >= 1 and s["alertsCreated"] >= 2 and s["escalations"] >= 1
    a2 = instrument_id(A2)
    assert get("officer@demo.in", f"/instruments/{a2}")["status"] == "EXPIRING"
    reminders = get("officer@demo.in", f"/alerts?instrumentId={a2}")["items"]
    assert [(a["kind"], a["recipientRole"]) for a in reminders] == [("MATURITY_REMINDER", "officer")]
    inst_alerts = get("inst2@demo.in", f"/alerts?instrumentId={a2}")["items"]
    assert [a["kind"] for a in inst_alerts] == ["MATURITY_REMINDER"]
    outbox = get("admin@demo.in", "/outbox?pageSize=100")["items"]
    assert sum(A2 in (m["subject"] + m["body"]) for m in outbox) >= 2
    # A4 crossed the 30-day mark; My day re-orders with it near the top.
    a4 = instrument_id(A4)
    a4_alerts = get("officer@demo.in", f"/alerts?instrumentId={a4}")["items"]
    assert any("30" in a["ruleKey"] for a in a4_alerts)
    after = get("officer@demo.in", "/myday")["items"]
    score_before = {i["instrumentId"]: i["score"] for i in before if i["kind"] != "release"}
    score_after = {i["instrumentId"]: i["score"] for i in after if i["kind"] != "release"}
    for moved in (a4, a2):  # both rise: fewer days left means more urgency
        assert score_after[moved] > score_before.get(moved, 0), moved


def test_step5_escalation_to_the_competent_authority_and_the_lapse(demo: dict[str, Any]) -> None:
    a3 = instrument_id(A3)
    mine = get("approver@demo.in", f"/alerts?instrumentId={a3}")["items"]
    assert [(a["kind"], a["level"]) for a in mine] == [("PENDING_VERIFICATION", 2)]
    # Acknowledging does not stop escalation; the root stays open until the cause is fixed.
    post("approver@demo.in", f"/alerts/{mine[0]['id']}/acknowledge")
    assert get("approver@demo.in", f"/alerts?instrumentId={a3}")["items"][0]["status"] == "ACKNOWLEDGED"
    a6 = instrument_id(A6)
    assert get("admin@demo.in", f"/instruments/{a6}")["status"] == "LAPSED"
    admin_alerts = get("admin@demo.in", f"/alerts?instrumentId={a6}")["items"]
    assert [(a["kind"], a["level"]) for a in admin_alerts] == [("OVERDUE_RENEWAL", 3)]


def test_step6_renewal_of_a4_and_the_a8_chain(demo: dict[str, Any]) -> None:
    a4 = instrument_id(A4)
    rec = next(a for a in get("admin@demo.in", "/demo/anchors") if a["code"] == "A4")["bankRecord"]
    assert rec["issueDate"] == clock.add_days(demo["d0"], 5)
    draft = post("inst1@demo.in", f"/instruments/{a4}/renew", None, 201)
    child = draft["id"]
    ok(api().patch(f"/api/v1/instruments/{child}", headers=h("inst1@demo.in"), json={
        "referenceNo": A4_NEW, "amount": "35,00,000", "issueDate": rec["issueDate"], "maturityDate": rec["maturityDate"],
        "beneficiaryName": rec["beneficiaryName"], "lienMarked": True, "version": draft["version"]}))  # fmt: skip
    upload("inst1@demo.in", child, "FDR_COPY", "fdr-copy")
    upload("inst1@demo.in", child, "BANK_LETTER", "bank-letter")
    detail = get("inst1@demo.in", f"/instruments/{child}")
    post("inst1@demo.in", f"/instruments/{child}/submit", {"version": detail["version"]})
    post("officer@demo.in", f"/instruments/{child}/claim")
    assert post("officer@demo.in", f"/instruments/{child}/verify")["result"] == "CONFIRMED"
    post("officer@demo.in", f"/instruments/{child}/accept")
    assert get("officer@demo.in", f"/instruments/{a4}")["status"] == "RENEWED"
    assert get("officer@demo.in", f"/instruments/{child}")["status"] == "ACTIVE"
    assert get("officer@demo.in", f"/alerts?instrumentId={a4}")["items"] == []  # its alerts closed
    chain = get("inst1@demo.in", f"/instruments/{child}/passport")["chain"]
    assert [c["referenceNo"] for c in chain] == [A4, A4_NEW] and chain[1]["gapKind"] == "overlap"

    a8c = get("officer@demo.in", f"/instruments/{instrument_id(A8[2])}/passport")
    assert [c["referenceNo"] for c in a8c["chain"]] == list(A8)
    assert [c["gapDaysFromPrevious"] for c in a8c["chain"]] == [None, 12, -5]
    a8b = get("officer@demo.in", f"/instruments/{instrument_id(A8[1])}/passport")
    assert any("12-day" in o["text"] or "12 day" in o["text"] for o in a8b["observations"]), a8b["observations"]


def test_step7_release_blocked_then_bank_correction_then_approved(demo: dict[str, Any]) -> None:
    a5 = instrument_id(A5)
    req = get("officer@demo.in", f"/release-requests?instrumentId={a5}")["items"][0]
    view = get("officer@demo.in", f"/release-requests/{req['id']}")
    assert view["blocked"] is True and view["canRecommend"] is False
    assert any("discrepanc" in b.lower() for b in view["blockers"]), view["blockers"]
    level = view["request"]["currentLevel"]
    blocked = api().post(f"/api/v1/release-requests/{req['id']}/recommend", headers=h("officer@demo.in"),
                         json={"remarks": "ok", "level": level})  # fmt: skip
    assert blocked.status_code == 409 and blocked.json()["code"] == "RELEASE_BLOCKED"

    fixed = post("admin@demo.in", "/demo/bank-correction",
                 {"bank": "Punjab National Bank", "referenceNo": A5, "fields": {"amount": "15,00,000"}})  # fmt: skip
    assert fixed["before"]["amount"] == "1450000.00" and fixed["after"]["amount"] == "1500000.00"
    assert fixed["instrumentId"] == a5
    v = post("officer@demo.in", f"/instruments/{a5}/verify")
    assert v["result"] == "CONFIRMED"
    assert [d["status"] for d in v["review"]["discrepancies"]] == ["RESOLVED"]
    view = get("officer@demo.in", f"/release-requests/{req['id']}")
    assert view["blocked"] is False and all(c["met"] for c in view["conditions"]) and view["canRecommend"] is True
    post("officer@demo.in", f"/release-requests/{req['id']}/recommend",
         {"remarks": "Bank corrected its record; all conditions met.", "level": level})  # fmt: skip
    view = get("approver@demo.in", f"/release-requests/{req['id']}")
    assert view["canApprove"] is True
    done = post("approver@demo.in", f"/release-requests/{req['id']}/decide",
                {"decision": "APPROVE", "remarks": "Approved", "refundReference": "PFMS/RF/2026/0999",
                 "level": view["request"]["currentLevel"]})  # fmt: skip
    assert done["request"]["status"] == "APPROVED" and done["orderNumber"].startswith("AICTE/REL/")
    assert get("officer@demo.in", f"/instruments/{a5}")["status"] == "RELEASED"

    # A9: above ₹50 L the second approval must come from a different approver.
    a9_req = get("approver@demo.in", f"/release-requests?instrumentId={instrument_id(A9)}")["items"][0]
    a9 = get("approver@demo.in", f"/release-requests/{a9_req['id']}")
    assert a9["request"]["currentLevel"] == 3 and a9["canDecide"] is False
    same = api().post(f"/api/v1/release-requests/{a9_req['id']}/decide", headers=h("approver@demo.in"),
                      json={"decision": "APPROVE", "remarks": "x", "level": 3})  # fmt: skip
    assert same.status_code == 403 and same.json()["code"] == "SEPARATION_OF_DUTIES"
    assert get("approver2@demo.in", f"/release-requests/{a9_req['id']}")["canDecide"] is True


def test_step8_audit_integrity_then_tamper(demo: dict[str, Any]) -> None:
    audit_service.clear_integrity_cache()
    good = get("auditor@demo.in", "/audit/integrity?fresh=1")
    assert good["ok"] is True and good["checked"] > 1000
    timeline = get("auditor@demo.in", f"/instruments/{demo['a1']}/passport")["timeline"]
    actions = {e["action"] for e in timeline}
    assert {"INSTRUMENT_SUBMITTED", "VERIFICATION_RESULT", "INSTRUMENT_RETURNED", "INSTRUMENT_ACCEPTED",
            "DOCUMENT_UPLOADED"} <= actions  # fmt: skip
    tampered = post("admin@demo.in", "/demo/tamper")
    bad = get("auditor@demo.in", "/audit/integrity")
    assert bad["ok"] is False and bad["firstBrokenId"] == tampered["eventId"]
    post("admin@demo.in", "/demo/tamper/undo")
    assert get("auditor@demo.in", "/audit/integrity?fresh=1")["ok"] is True
