"""Phase 06 acceptance checks 1–9: release requests, live conditions, the approval chain and its controls."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from app.db.pool import exec_, get_pool, many, one
from app.shared_constants import EVENT_LABELS, INSTITUTION_VISIBLE_ACTIONS
from helpers import (
    SeededUser,
    alerts_of,
    api,
    bearer,
    evaluate_on,
    instrument_status,
    make_instrument,
    pdf_bytes,
    reset_db,
    set_today,
    user_for,
)
from httpx import Response

D0 = "2026-10-25"
REF = "CNRB/FD/2025/00042"
MATURITY = "2027-12-01"  # far enough that the instrument stays ACTIVE


@dataclass(frozen=True)
class Ctx:
    inst1: SeededUser
    inst2: SeededUser
    officer: SeededUser
    officer2: SeededUser
    approver: SeededUser
    approver2: SeededUser
    admin: SeededUser
    bank_url: str

    def load(self, *records: dict[str, Any]) -> None:
        res = httpx.post(f"{self.bank_url}/records/load", json={"records": list(records)})
        assert res.status_code == 200, res.text


@pytest.fixture
def c(bank_url: str, monkeypatch: pytest.MonkeyPatch) -> Ctx:
    monkeypatch.setenv("MOCK_BANK_URL", bank_url)
    reset_db()
    set_today(D0)
    return Ctx(
        user_for("inst1@demo.in"), user_for("inst2@demo.in"), user_for("officer@demo.in"),
        user_for("officer2@demo.in"), user_for("approver@demo.in"), user_for("approver2@demo.in"),
        user_for("admin@demo.in"), bank_url,
    )  # fmt: skip


def post(user: SeededUser, path: str, body: dict[str, Any] | None = None) -> Response:
    return api().post(f"/api/v1{path}", headers=bearer(user), json=body or {})


def get(user: SeededUser, path: str) -> Response:
    return api().get(f"/api/v1{path}", headers=bearer(user))


def patch(user: SeededUser, path: str, body: dict[str, Any]) -> Response:
    return api().patch(f"/api/v1{path}", headers=bearer(user), json=body)


def ok(res: Response, status: int = 200) -> Any:
    assert res.status_code == status, res.text
    return res.json()


def bank_record(**over: Any) -> dict[str, Any]:
    """Matches what make_instrument() writes."""
    return {
        "bank": "Canara Bank",
        "reference_no": REF,
        "amount": "2500000.00",
        "issue_date": "2025-01-01",
        "maturity_date": MATURITY,
        "beneficiary_name": "MEMBER SECRETARY AICTE",
        "lien_marked": True,
        "lien_in_favour_of": "Member Secretary, AICTE",
        "status": "LIVE",
        **over,
    }


def live_instrument(status: str = "ACTIVE", maturity: str = MATURITY, **kw: Any) -> str:
    return make_instrument(status, maturity, ref=kw.pop("ref", REF), **kw)


def request_release(c: Ctx, instrument_id: str, reason: str = "Approval period over; obligation fulfilled") -> Any:
    return ok(post(c.inst1, f"/instruments/{instrument_id}/release-requests", {"reason": reason}), 201)


def upload_release_doc(user: SeededUser, request_id: str, doc_type: str = "RELEASE_LETTER") -> Response:
    return api().post(
        f"/api/v1/release-requests/{request_id}/documents",
        headers=bearer(user),
        data={"docType": doc_type},
        files={"file": ("letter.pdf", pdf_bytes(), "application/pdf")},
    )


def condition(view: dict[str, Any], code: str) -> dict[str, Any]:
    return next(x for x in view["conditions"] if x["code"] == code)


def tick_manual(c: Ctx, view: dict[str, Any]) -> dict[str, Any]:
    for x in view["conditions"]:
        if not x["auto"]:
            view = ok(
                patch(c.officer, f"/release-conditions/{x['id']}", {"met": True, "remarks": f"Checked {x['code']}"})
            )
    return view


def ready_request(c: Ctx, instrument_id: str) -> dict[str, Any]:
    """A request with a release document and every manual condition ticked."""
    view = request_release(c, instrument_id)
    assert upload_release_doc(c.inst1, view["request"]["id"]).status_code == 201
    return tick_manual(c, ok(get(c.officer, f"/release-requests/{view['request']['id']}")))


def recommended(c: Ctx, instrument_id: str) -> str:
    view = ready_request(c, instrument_id)
    rid = view["request"]["id"]
    ok(post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "All conditions met", "level": 1}))
    return str(rid)


def approve(user: SeededUser, rid: str, level: int | None = None, **body: Any) -> Response:
    return post(user, f"/release-requests/{rid}/decide",
                {"decision": "APPROVE", "remarks": "Approved for release", "level": level, **body})  # fmt: skip


# ---- request, documents, conditions ------------------------------------------------------------


def test_request_moves_the_instrument_and_copies_the_configured_conditions(c: Ctx) -> None:
    inst = live_instrument("EXPIRING", "2026-12-01")
    view = request_release(c, inst)
    req = view["request"]
    assert req["status"] == "PENDING_CONDITIONS" and req["currentLevel"] == 1
    assert [lv["role"] for lv in req["requiredLevels"]] == ["officer", "approver"]
    assert instrument_status(inst) == "RELEASE_REQUESTED"
    row = one(get_pool(), "SELECT status_before_release FROM instruments WHERE id = $1", [inst])
    assert row["status_before_release"] == "EXPIRING"
    assert [x["code"] for x in view["conditions"]] == [
        "NO_OPEN_DISCREPANCY", "NO_BLOCKING_OBSERVATION", "INSTRUMENT_VERIFIED", "REQUEST_DOCUMENTS_ATTACHED",
        "COMPLIANCE_CONFIRMED", "LIEN_REMOVAL_DOCUMENT",
    ]  # fmt: skip
    # Auto conditions are evaluated live and never stored as met.
    stored = many(get_pool(), "SELECT code, met FROM release_conditions WHERE auto")
    assert {r["met"] for r in stored} == {False}
    assert condition(view, "NO_OPEN_DISCREPANCY")["met"] is True
    assert condition(view, "REQUEST_DOCUMENTS_ATTACHED")["met"] is False
    assert view["blocked"] is True and view["canCancel"] is True and view["canUploadDocuments"] is True
    # A second request while one is open is refused.
    res = post(c.inst1, f"/instruments/{inst}/release-requests", {"reason": "again"})
    assert res.status_code == 409 and res.json()["code"] == "RELEASE_ALREADY_REQUESTED"


def test_request_validation_and_access(c: Ctx) -> None:
    inst = live_instrument()
    res = post(c.inst1, f"/instruments/{inst}/release-requests", {"reason": "  "})
    assert res.status_code == 422 and res.json()["details"] == [
        {"field": "reason", "message": "Enter the reason for the release"}
    ]
    assert post(c.inst2, f"/instruments/{inst}/release-requests", {"reason": "x"}).status_code == 404
    assert post(c.officer, f"/instruments/{inst}/release-requests", {"reason": "x"}).status_code == 403
    rid = request_release(c, inst)["request"]["id"]
    assert get(c.inst2, f"/release-requests/{rid}").status_code == 404  # rule 8: 404, not 403
    assert upload_release_doc(c.inst2, rid).status_code == 404
    # Only release document types.
    res = upload_release_doc(c.inst1, rid, "FDR_COPY")
    assert res.status_code == 422 and res.json()["details"][0]["field"] == "docType"
    assert upload_release_doc(c.inst1, rid, "LIEN_REMOVAL_REQUEST").status_code == 201
    # Release documents belong to the request, not to the instrument's own document list.
    assert get(c.inst1, f"/instruments/{inst}").json()["documents"] == []
    docs = ok(get(c.inst1, f"/release-requests/{rid}"))["documents"]
    assert [d["docType"] for d in docs] == ["LIEN_REMOVAL_REQUEST"] and docs[0]["releaseRequestId"] == rid
    assert get(c.officer, f"/instruments/{inst}/documents/{docs[0]['id']}/download").status_code == 200


def test_manual_conditions_need_remarks_and_auto_conditions_cannot_be_ticked(c: Ctx) -> None:
    view = request_release(c, live_instrument())
    manual = condition(view, "COMPLIANCE_CONFIRMED")
    res = patch(c.officer, f"/release-conditions/{manual['id']}", {"met": True})
    assert res.status_code == 422 and res.json()["details"] == [
        {"field": "remarks", "message": "Enter remarks: what did you check?"}
    ]
    assert patch(c.inst1, f"/release-conditions/{manual['id']}", {"met": True, "remarks": "x"}).status_code == 403
    res = patch(c.officer, f"/release-conditions/{condition(view, 'NO_OPEN_DISCREPANCY')['id']}",
                {"met": True, "remarks": "x"})  # fmt: skip
    assert res.status_code == 409 and res.json()["code"] == "INVALID_STATE"
    view = ok(patch(c.officer, f"/release-conditions/{manual['id']}", {"met": True, "remarks": "Approval letter seen"}))
    ticked = condition(view, "COMPLIANCE_CONFIRMED")
    assert (
        ticked["met"] is True
        and ticked["checkedByName"] == c.officer.name
        and ticked["remarks"] == "Approval letter seen"
    )
    view = ok(patch(c.officer, f"/release-conditions/{manual['id']}", {"met": False}))
    assert condition(view, "COMPLIANCE_CONFIRMED")["met"] is False


# ---- AC1 ---------------------------------------------------------------------------------------


def test_ac1_recommend_refused_while_a_condition_fails_then_succeeds(c: Ctx) -> None:
    inst = live_instrument()
    view = request_release(c, inst)
    rid = view["request"]["id"]
    res = post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "Looks fine"})
    assert res.status_code == 409 and res.json()["code"] == "RELEASE_BLOCKED"
    reasons = res.json()["details"]["reasons"]
    assert "At least one release document attached: No release document attached yet" in reasons
    assert any(r.startswith("The obligation the deposit secured is confirmed as fulfilled") for r in reasons)
    assert len(reasons) == 3  # documents + two manual conditions
    assert ok(get(c.officer, f"/release-requests/{rid}"))["canRecommend"] is False

    view = tick_manual(c, view)
    res = post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "Looks fine"})
    assert res.json()["details"]["reasons"] == [
        "At least one release document attached: No release document attached yet"
    ]
    assert upload_release_doc(c.inst1, rid).status_code == 201
    view = ok(get(c.officer, f"/release-requests/{rid}"))
    assert view["blocked"] is False and view["canRecommend"] is True
    view = ok(post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "All conditions met", "level": 1}))
    assert view["request"]["status"] == "PENDING_APPROVAL" and view["request"]["currentLevel"] == 2
    [rec] = view["approvals"]
    assert rec["decision"] == "RECOMMEND" and rec["level"] == 1 and rec["approverName"] == c.officer.name
    assert {x["code"]: x["met"] for x in rec["conditionsSnapshot"]} == {x["code"]: True for x in view["conditions"]}
    # The officer cannot recommend twice; the institution cannot upload once it left the institution's hands.
    res = post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "again", "level": 1})
    assert res.status_code == 409 and res.json()["code"] == "ALREADY_DECIDED"
    assert upload_release_doc(c.inst1, rid).status_code == 409


def test_a_blocking_observation_and_an_unverified_instrument_block_too(c: Ctx) -> None:
    inst = live_instrument(verification_state="UNAVAILABLE")
    rid = ready_request(c, inst)["request"]["id"]
    ok(
        post(
            c.officer,
            f"/instruments/{inst}/observations",
            {"text": "Bank letter looks altered", "severity": "BLOCKING"},
        ),
        201,
    )
    view = ok(get(c.officer, f"/release-requests/{rid}"))
    assert condition(view, "INSTRUMENT_VERIFIED")["met"] is False
    obs = condition(view, "NO_BLOCKING_OBSERVATION")
    assert obs["met"] is False and obs["link"]["type"] == "observation"
    # Accepted with a recorded override counts as verified (D13).
    exec_(get_pool(), "UPDATE instruments SET accepted_with_override = true WHERE id = $1", [inst])
    assert condition(ok(get(c.officer, f"/release-requests/{rid}")), "INSTRUMENT_VERIFIED")["met"] is True


# ---- AC2 ---------------------------------------------------------------------------------------


def test_ac2_discrepancy_after_recommendation_blocks_approval_until_resolved(c: Ctx) -> None:
    inst = live_instrument()
    c.load(bank_record())
    rid = recommended(c, inst)
    # The bank's record changes; re-verification opens a discrepancy on the amount.
    c.load(bank_record(amount="2000000.00"))
    assert ok(post(c.officer, f"/instruments/{inst}/verify"))["result"] == "MISMATCH"
    view = ok(get(c.approver, f"/release-requests/{rid}"))
    disc = condition(view, "NO_OPEN_DISCREPANCY")
    assert disc["met"] is False and disc["reason"] == "Open discrepancy on amount"
    assert disc["link"]["type"] == "discrepancy" and disc["link"]["field"] == "amount"
    assert disc["metAtRecommendation"] is True and disc["changedSinceRecommendation"] is True
    assert view["blocked"] is True and view["canDecide"] is True and view["canApprove"] is False
    res = approve(c.approver, rid, 2)
    assert res.status_code == 409 and res.json()["code"] == "RELEASE_BLOCKED"
    assert "No open discrepancy on the instrument: Open discrepancy on amount" in res.json()["details"]["reasons"]
    assert any("Not confirmed by the bank" in r for r in res.json()["details"]["reasons"])
    assert instrument_status(inst) == "RELEASE_REQUESTED"
    # The bank corrects its record; re-verification confirms and auto-resolves the discrepancy.
    c.load(bank_record())
    assert ok(post(c.officer, f"/instruments/{inst}/verify"))["result"] == "CONFIRMED"
    view = ok(get(c.approver, f"/release-requests/{rid}"))
    assert view["blocked"] is False and condition(view, "NO_OPEN_DISCREPANCY")["changedSinceRecommendation"] is False
    ok(approve(c.approver, rid, 2, refundReference="PFMS/2026/REF/0042"))
    assert instrument_status(inst) == "RELEASED"


# ---- AC3 ---------------------------------------------------------------------------------------


def test_ac3_approval_releases_resolves_alerts_and_records_the_snapshot(c: Ctx) -> None:
    inst = live_instrument("EXPIRING", "2026-12-01")
    evaluate_on(D0)  # maturity reminders for the expiring instrument
    assert any(a["status"] == "OPEN" for a in alerts_of(inst))
    rid = recommended(c, inst)
    view = ok(approve(c.approver, rid, 2, refundReference="PFMS/2026/REF/0042"))
    assert view["request"]["status"] == "APPROVED" and view["request"]["closedAt"] is not None
    assert view["request"]["refundReference"] == "PFMS/2026/REF/0042"
    assert view["orderNumber"] == f"AICTE/REL/2026/{rid[:8].upper()}"
    assert instrument_status(inst) == "RELEASED"
    assert all(a["status"] == "RESOLVED" for a in alerts_of(inst))
    event = one(get_pool(), "SELECT * FROM events WHERE action = 'RELEASE_APPROVED'")
    after = event["after_json"]
    assert event["entity_type"] == "release_request" and event["entity_id"] == rid and event["instrument_id"] == inst
    assert {x["code"] for x in after["conditions"]} == {x["code"] for x in view["conditions"]}
    assert all(x["met"] for x in after["conditions"])
    assert [(a["level"], a["decision"], a["by"]) for a in after["approvals"]] == [
        (1, "RECOMMEND", c.officer.name), (2, "APPROVE", c.approver.name),
    ]  # fmt: skip
    assert after["refundReference"] == "PFMS/2026/REF/0042" and after["orderNumber"] == view["orderNumber"]
    # Terminal: nothing more can happen to it.
    assert post(c.inst1, f"/instruments/{inst}/release-requests", {"reason": "x"}).status_code == 409


# ---- AC4 ---------------------------------------------------------------------------------------


def test_ac4_rejection_restores_the_earlier_status(c: Ctx) -> None:
    inst = live_instrument()
    rid = recommended(c, inst)
    res = post(c.approver, f"/release-requests/{rid}/decide", {"decision": "REJECT"})
    assert res.status_code == 422 and res.json()["details"] == [{"field": "remarks", "message": "Enter your remarks"}]
    view = ok(
        post(
            c.approver, f"/release-requests/{rid}/decide", {"decision": "REJECT", "remarks": "Dues pending", "level": 2}
        )
    )
    assert view["request"]["status"] == "REJECTED" and view["request"]["closedAt"] is not None
    assert instrument_status(inst) == "ACTIVE"
    # Rejection is possible even while a condition fails; a new request can be made afterwards.
    request_release(c, inst)


def test_ac4_targeted_sweep_corrects_the_restored_status_when_maturity_passed(c: Ctx) -> None:
    inst = live_instrument("ACTIVE", "2027-01-31")  # 98 days after D0: ACTIVE
    rid = recommended(c, inst)
    set_today("2027-02-05")  # matured meanwhile, still inside the 15-day grace
    view = ok(post(c.approver, f"/release-requests/{rid}/decide", {"decision": "REJECT", "remarks": "Not yet"}))
    assert view["request"]["status"] == "REJECTED"
    assert instrument_status(inst) == "MATURED"
    statuses = [e["after_json"]["status"] for e in many(
        get_pool(), "SELECT after_json FROM events WHERE instrument_id = $1 AND action LIKE 'STATUS_%' ORDER BY id", [inst]
    )]  # fmt: skip
    assert statuses == ["RELEASE_REQUESTED", "ACTIVE", "EXPIRING", "MATURED"]


# ---- AC5 ---------------------------------------------------------------------------------------


def test_ac5_the_recommending_officer_cannot_approve(c: Ctx) -> None:
    rid = recommended(c, live_instrument())
    res = approve(c.officer, rid, 2)
    assert res.status_code == 403
    # Not the officer's level; and an officer who recommended can never act at another level (D27).
    exec_(
        get_pool(),
        "UPDATE release_requests SET required_levels = jsonb_set(required_levels, '{1,role}', '\"officer\"')",
    )
    res = approve(c.officer, rid, 2)
    assert res.status_code == 403 and res.json()["code"] == "SEPARATION_OF_DUTIES"
    assert ok(approve(c.officer2, rid, 2))["request"]["status"] == "APPROVED"


def test_ac5_above_50_lakh_needs_two_different_approvers(c: Ctx) -> None:
    inst = live_instrument(amount="12000000.00")
    view = request_release(c, inst)
    assert [lv["level"] for lv in view["request"]["requiredLevels"]] == [1, 2, 3]
    assert view["request"]["requiredLevels"][2]["role"] == "approver"
    rid = recommended_existing(c, view)
    view = ok(approve(c.approver, rid, 2))
    assert view["request"]["status"] == "PENDING_APPROVAL" and view["request"]["currentLevel"] == 3
    assert instrument_status(inst) == "RELEASE_REQUESTED"
    me = ok(get(c.approver, f"/release-requests/{rid}"))
    assert me["canDecide"] is False and "different person" in me["actionBlockers"][0]
    res = approve(c.approver, rid, 3)
    assert res.status_code == 403 and res.json()["code"] == "SEPARATION_OF_DUTIES"
    res = post(c.approver, f"/release-requests/{rid}/decide", {"decision": "RETURN", "remarks": "x", "level": 3})
    assert res.status_code == 403  # every decision, not only approval
    assert ok(approve(c.approver2, rid, 3))["request"]["status"] == "APPROVED"
    assert instrument_status(inst) == "RELEASED"
    # Exactly ₹50 L stays at two levels.
    exact = request_release(c, live_instrument(amount="5000000.00", ref="CNRB/FD/2025/00099"))
    assert len(exact["request"]["requiredLevels"]) == 2


def recommended_existing(c: Ctx, view: dict[str, Any]) -> str:
    rid = view["request"]["id"]
    assert upload_release_doc(c.inst1, rid).status_code == 201
    tick_manual(c, view)
    ok(post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "All conditions met"}))
    return str(rid)


def test_approval_chain_comes_from_the_rule(c: Ctx) -> None:
    exec_(
        get_pool(),
        """UPDATE rules SET config = '{"levels":[{"level":1,"role":"officer","action":"RECOMMEND","label":"Officer"},
           {"level":2,"role":"officer","action":"RECOMMEND","label":"Section officer"},
           {"level":3,"role":"approver","action":"DECIDE","label":"Authority"}]}' WHERE key = 'approval_levels'""",
    )
    inst = live_instrument()
    rid = recommended(c, inst)
    ok(post(c.officer2, f"/release-requests/{rid}/recommend", {"remarks": "Second check", "level": 2}))
    ok(approve(c.approver, rid, 3))
    assert instrument_status(inst) == "RELEASED"


# ---- AC6 ---------------------------------------------------------------------------------------


def test_ac6_a_second_decision_on_the_same_level_is_already_decided(c: Ctx) -> None:
    rid = recommended(c, live_instrument(amount="12000000.00"))
    ok(approve(c.approver, rid, 2))
    res = approve(c.approver2, rid, 2)  # approver2 still looking at level 2
    assert res.status_code == 409 and res.json()["code"] == "ALREADY_DECIDED"
    assert f"already decided by {c.approver.name}" in res.json()["message"]


def test_ac6_concurrent_decisions_one_wins(c: Ctx) -> None:
    rid = recommended(c, live_instrument())
    results: list[Response] = []
    barrier = threading.Barrier(2)

    def decide(user: SeededUser) -> None:
        client = api()
        barrier.wait()
        results.append(client.post(f"/api/v1/release-requests/{rid}/decide", headers=bearer(user),
                                   json={"decision": "APPROVE", "remarks": "Approved", "level": 2}))  # fmt: skip

    threads = [threading.Thread(target=decide, args=(u,)) for u in (c.approver, c.approver2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r.status_code for r in results) == [200, 409]
    assert next(r for r in results if r.status_code == 409).json()["code"] == "ALREADY_DECIDED"
    assert one(get_pool(), "SELECT count(*) AS n FROM release_approvals WHERE decision = 'APPROVE'")["n"] == 1


# ---- AC7 ---------------------------------------------------------------------------------------


def test_ac7_return_resubmit_recommend_keeps_history(c: Ctx) -> None:
    inst = live_instrument()
    rid = recommended(c, inst)
    view = ok(post(c.approver, f"/release-requests/{rid}/decide",
                   {"decision": "RETURN", "remarks": "Attach the no-dues certificate", "level": 2}))  # fmt: skip
    assert (
        view["request"]["status"] == "RETURNED" and view["request"]["returnMessage"] == "Attach the no-dues certificate"
    )
    assert instrument_status(inst) == "RELEASE_REQUESTED"
    mine = ok(get(c.inst1, f"/release-requests/{rid}"))
    assert mine["canResubmit"] and mine["canUploadDocuments"] and mine["canCancel"]
    assert mine["approvals"][0]["remarks"] is None  # internal recommendation remarks are not shown (D24)
    assert mine["approvals"][1]["remarks"] == "Attach the no-dues certificate"
    assert upload_release_doc(c.inst1, rid, "COMPLIANCE_CERTIFICATE").status_code == 201
    assert post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "x"}).status_code == 409
    view = ok(post(c.inst1, f"/release-requests/{rid}/resubmit", {"note": "No-dues certificate attached"}))
    assert view["request"]["status"] == "PENDING_CONDITIONS" and view["request"]["currentLevel"] == 1
    view = ok(post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "Certificate checked", "level": 1}))
    assert [(a["level"], a["decision"]) for a in view["approvals"]] == [
        (1, "RECOMMEND"),
        (2, "RETURN"),
        (1, "RECOMMEND"),
    ]
    ok(approve(c.approver, rid, 2))
    assert instrument_status(inst) == "RELEASED"
    actions = [e["action"] for e in many(
        get_pool(), "SELECT action FROM events WHERE entity_type = 'release_request' AND entity_id = $1 ORDER BY id", [rid]
    )]  # fmt: skip
    assert actions == [
        "RELEASE_REQUESTED", "RELEASE_RECOMMENDED", "RELEASE_RETURNED", "RELEASE_RESUBMITTED", "RELEASE_RECOMMENDED",
        "RELEASE_APPROVED",
    ]  # fmt: skip


def test_ac7_cancel_restores_the_status(c: Ctx) -> None:
    inst = live_instrument("LAPSED", "2026-08-01")
    rid = request_release(c, inst)["request"]["id"]
    assert post(c.inst2, f"/release-requests/{rid}/cancel").status_code == 404
    view = ok(post(c.inst1, f"/release-requests/{rid}/cancel"))
    assert view["request"]["status"] == "CANCELLED" and view["canCancel"] is False
    assert instrument_status(inst) == "LAPSED"
    assert post(c.inst1, f"/release-requests/{rid}/cancel").status_code == 409
    # Once recommended, the institution can no longer cancel.
    rid = recommended(c, inst)
    res = post(c.inst1, f"/release-requests/{rid}/cancel")
    assert res.status_code == 409 and res.json()["code"] == "INVALID_STATE"


# ---- AC8 (D6, both directions) -----------------------------------------------------------------


def test_ac8_renewed_instruments_cannot_be_released(c: Ctx) -> None:
    inst = live_instrument("RENEWED", "2026-12-01")
    res = post(c.inst1, f"/instruments/{inst}/release-requests", {"reason": "x"})
    assert res.status_code == 409 and res.json()["code"] == "NOT_RELEASABLE"
    assert "only its live replacement can be released" in res.json()["message"]
    for status in ("DRAFT", "SUBMITTED", "UNDER_SCRUTINY", "RETURNED"):
        other = make_instrument(status, "2027-06-01")
        assert (
            post(c.inst1, f"/instruments/{other}/release-requests", {"reason": "x"}).json()["code"] == "NOT_RELEASABLE"
        )


def test_ac8_release_refused_while_a_non_terminal_successor_exists(c: Ctx) -> None:
    parent = live_instrument("EXPIRING", "2026-12-01")
    child = ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)
    res = post(c.inst1, f"/instruments/{parent}/release-requests", {"reason": "x"})
    assert res.status_code == 409 and res.json()["code"] == "NOT_RELEASABLE"
    assert "replacement in progress (a draft, Draft)" in res.json()["message"]
    assert instrument_status(parent) == "EXPIRING"
    # Deleting the abandoned draft frees the instrument for release.
    assert api().delete(f"/api/v1/instruments/{child['id']}", headers=bearer(c.inst1)).status_code == 204
    request_release(c, parent)


def test_ac8_renew_refused_while_a_returned_request_is_open(c: Ctx) -> None:
    parent = live_instrument("EXPIRING", "2026-12-01")
    rid = recommended(c, parent)
    ok(post(c.approver, f"/release-requests/{rid}/decide", {"decision": "RETURN", "remarks": "More papers"}))
    res = post(c.inst1, f"/instruments/{parent}/renew")
    assert res.status_code == 409 and res.json()["code"] == "NOT_RENEWABLE"
    assert "open release request (returned to institution" in res.json()["message"]
    ok(post(c.inst1, f"/release-requests/{rid}/cancel"))
    ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)


# ---- AC9 ---------------------------------------------------------------------------------------


def test_ac9_release_pending_alert_appears_after_after_days_and_escalates(c: Ctx) -> None:
    inst = live_instrument(assigned_officer_id=c.officer.id)
    rid = request_release(c, inst)["request"]["id"]
    evaluate_on("2026-10-29")  # 4 days: nothing yet
    assert [a for a in alerts_of(inst) if a["kind"] == "RELEASE_PENDING"] == []
    evaluate_on("2026-10-30")  # 5 days (afterDays)
    [alert] = [a for a in alerts_of(inst) if a["kind"] == "RELEASE_PENDING"]
    assert alert["recipient_role"] == "officer" and alert["recipient_user_id"] == c.officer.id
    assert alert["subject_id"] == rid and alert["rule_key"] == "release_pending:1" and alert["level"] == 1
    inbox = ok(get(c.officer, "/alerts?kind=RELEASE_PENDING"))["items"]
    assert len(inbox) == 1 and "waited 5 days at level 1" in inbox[0]["message"]
    evaluate_on("2026-11-06")  # 7 days after the root: escalates to the approver (D11)
    pending = [a for a in alerts_of(inst) if a["kind"] == "RELEASE_PENDING"]
    assert [(a["level"], a["recipient_role"], a["status"]) for a in pending] == [
        (1, "officer", "ESCALATED"), (2, "approver", "OPEN"),
    ]  # fmt: skip
    # Recommending moves the request to the approver's level: the officer's chain clears, a new one starts later.
    view = tick_manual(c, ok(get(c.officer, f"/release-requests/{rid}")))
    assert upload_release_doc(c.inst1, rid).status_code == 201
    ok(post(c.officer, f"/release-requests/{rid}/recommend", {"remarks": "ok"}))
    assert all(a["status"] == "RESOLVED" for a in alerts_of(inst) if a["kind"] == "RELEASE_PENDING")
    assert view["request"]["id"] == rid
    evaluate_on("2026-11-11")  # 5 days at level 2 -> approver alert, at the approver's rung of the ladder
    live = [a for a in alerts_of(inst) if a["kind"] == "RELEASE_PENDING" and a["status"] == "OPEN"]
    assert [(a["level"], a["recipient_role"], a["rule_key"]) for a in live] == [(2, "approver", "release_pending:2")]
    ok(approve(c.approver, rid))
    assert all(a["status"] == "RESOLVED" for a in alerts_of(inst))


# ---- lists, passport, labels -------------------------------------------------------------------


def test_list_is_scoped_and_awaiting_me_follows_the_current_level(c: Ctx) -> None:
    rid1 = request_release(c, live_instrument())["request"]["id"]
    other = make_instrument("ACTIVE", MATURITY, institution_email="inst2@demo.in", ref="CNRB/FD/2025/00777")
    rid2 = ok(post(c.inst2, f"/instruments/{other}/release-requests", {"reason": "done"}), 201)["request"]["id"]
    assert [i["id"] for i in ok(get(c.inst1, "/release-requests"))["items"]] == [rid1]
    assert {i["id"] for i in ok(get(c.officer, "/release-requests"))["items"]} == {rid1, rid2}
    assert {i["id"] for i in ok(get(c.officer, "/release-requests?awaitingMe=true"))["items"]} == {rid1, rid2}
    assert ok(get(c.approver, "/release-requests?awaitingMe=true"))["items"] == []
    view = tick_manual(c, ok(get(c.officer, f"/release-requests/{rid1}")))
    assert upload_release_doc(c.inst1, rid1).status_code == 201
    ok(post(c.officer, f"/release-requests/{rid1}/recommend", {"remarks": "ok"}))
    assert [i["id"] for i in ok(get(c.approver, "/release-requests?awaitingMe=true"))["items"]] == [rid1]
    assert [i["id"] for i in ok(get(c.officer, "/release-requests?status=PENDING_APPROVAL"))["items"]] == [rid1]
    assert view["request"]["id"] == rid1
    res = get(c.officer, "/release-requests?status=NOPE")
    assert res.status_code == 422 and res.json()["details"][0]["field"] == "query.status"


def test_passport_release_tab_and_labelled_release_events(c: Ctx) -> None:
    inst = live_instrument()
    rid = recommended(c, inst)
    ok(post(c.approver, f"/release-requests/{rid}/decide", {"decision": "RETURN", "remarks": "Add the bank letter"}))
    p = ok(get(c.inst1, f"/instruments/{inst}/passport"))
    [req] = p["releaseRequests"]
    assert req["request"]["status"] == "RETURNED" and req["request"]["returnMessage"] == "Add the bank letter"
    assert req["canResubmit"] is True and len(req["conditions"]) == 6 and len(req["documents"]) == 1
    labels = {e["action"]: e["label"] for e in p["timeline"]}
    # Institutions see their own release events (D24) but not the officer's internal steps.
    assert labels["RELEASE_REQUESTED"] == "Release requested"
    assert labels["RELEASE_RETURNED"] == "Release request returned to institution at level 2"
    assert "RELEASE_RECOMMENDED" not in labels and "RELEASE_CONDITION_CHECKED" not in labels
    # RELEASE_APPROVED carries the whole chain with internal remarks: institutions see STATUS_RELEASED instead.
    assert "RELEASE_APPROVED" not in INSTITUTION_VISIBLE_ACTIONS
    assert all(e["icon"] == "release" for e in p["timeline"] if e["action"].startswith("RELEASE_"))
    internal = {e["action"]: e["label"] for e in ok(get(c.officer, f"/instruments/{inst}/passport"))["timeline"]}
    assert internal["RELEASE_RECOMMENDED"] == "Release recommended by officer"
    assert internal["RELEASE_CONDITION_CHECKED"].startswith("Release condition met: ")
    assert internal["DOCUMENT_UPLOADED"] == "Release document uploaded: release letter"
    # Every release action the service writes has a label, and the institution whitelist only names labelled actions.
    actions = {r["action"] for r in many(get_pool(), "SELECT DISTINCT action FROM events")}
    assert {a for a in actions if a.startswith("RELEASE_")} <= set(EVENT_LABELS)
    assert set(INSTITUTION_VISIBLE_ACTIONS) <= set(EVENT_LABELS)
    for action in ("RELEASE_LEVEL_APPROVED", "RELEASE_APPROVED", "RELEASE_REJECTED", "RELEASE_CANCELLED"):
        assert EVENT_LABELS[action]
