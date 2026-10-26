"""Phase 07 acceptance checks 3–4: My day ranking, configurable weights, approver exclusions (D27)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from app.db.pool import exec_, get_pool
from app.domain import risk
from app.schemas import RiskWeightsRule
from helpers import evaluate_on, make_instrument, reset_db, set_today, user_for
from phase07_helpers import add_approval, add_discrepancy, add_release_request, get, ok

D0 = "2026-10-25"


@pytest.fixture(autouse=True)
def _db() -> None:
    reset_db()
    set_today(D0)


def items(email: str) -> list[dict[str, Any]]:
    data = ok(get(user_for(email), "/myday"))
    assert data["asOf"] == D0
    return list(data["items"])


def set_weights(**config: Any) -> None:
    base = {"amount": 0, "urgency": 0, "verification": 0, "discrepancy": 0, "escalation": 0,
            "amountCap": "10000000.00", "urgencyHorizonDays": 90, **config}  # fmt: skip
    exec_(get_pool(), "UPDATE rules SET config = $1::jsonb WHERE key = 'risk_weights'", [json.dumps(base)])


def test_ac3_risky_item_ranks_above_safe_one_with_reasons_and_actions() -> None:
    risky = make_instrument("ACTIVE", "2026-10-30", amount="12000000.00", verification_state="MISMATCH")  # 5 days
    add_discrepancy(risky)
    safe = make_instrument("ACTIVE", "2027-01-13", amount="100000.00")  # 80 days, confirmed
    evaluate_on(D0)  # maturity reminders addressed to the officer pool
    got = items("officer@demo.in")
    ids = [i["id"] for i in got]
    assert ids.index(risky) < ids.index(safe)
    top = got[ids.index(risky)]
    assert top["kind"] == "instrument" and top["link"] == f"/instruments/{risky}"
    assert top["reasons"][:3] == ["₹1.2 Cr at stake", "Matures in 5 days", "Bank mismatch: amount"]
    assert top["nextAction"] == "Resolve discrepancy on amount"
    assert top["title"].startswith("CNRB/FD/TEST/") and "Vasavi College" in top["title"]
    low = got[ids.index(safe)]
    assert low["nextAction"] == "Chase renewal — matures in 80 days"
    for item in got:
        assert item["reasons"], item
        assert item["nextAction"], item
        assert 0 <= item["score"] <= 100


def test_ac3_changing_risk_weights_changes_the_order() -> None:
    big_far = make_instrument("ACTIVE", "2027-01-18", amount="9000000.00")  # 85 days
    small_near = make_instrument("ACTIVE", "2026-11-04", amount="200000.00")  # 10 days
    evaluate_on(D0)
    set_weights(amount=1)
    assert [i["id"] for i in items("officer@demo.in")] == [big_far, small_near]
    set_weights(urgency=1)  # read at the start of each request (rule 11)
    assert [i["id"] for i in items("officer@demo.in")] == [small_near, big_far]


def test_score_formula() -> None:
    w = RiskWeightsRule.model_validate({"amount": 0.3, "urgency": 0.3, "verification": 0.2, "discrepancy": 0.15,
                                        "escalation": 0.05, "amountCap": "10000000.00", "urgencyHorizonDays": 90})  # fmt: skip
    c = risk.components(amount="5000000.00", urgency=risk.maturity_urgency(45, 90), state="MISMATCH", override=False,
                        open_discrepancies=1, worst_alert_level=3, weights=w)  # fmt: skip
    assert c == {"amount": 0.5, "urgency": 0.5, "verification": 1.0, "discrepancy": 1.0, "escalation": 1.0}
    assert risk.score(c, w) == 70
    assert risk.maturity_urgency(0, 90) == 1.0 and risk.maturity_urgency(200, 90) == 0.0
    assert risk.waiting_urgency(25) == 1.0
    assert risk.verification_component("UNAVAILABLE", True) == 0.0


def test_officer_candidates_scrutiny_items() -> None:
    officer, officer2 = user_for("officer@demo.in"), user_for("officer2@demo.in")
    submitted = make_instrument("SUBMITTED", "2027-06-01", verification_state="UNVERIFIED",
                                submitted_at="2026-10-17T05:00:00Z")  # fmt: skip
    mine = make_instrument("UNDER_SCRUTINY", "2027-06-01", verification_state="UNVERIFIED",
                           submitted_at="2026-10-20T05:00:00Z", assigned_officer_id=officer.id)  # fmt: skip
    theirs = make_instrument("UNDER_SCRUTINY", "2027-06-01", assigned_officer_id=officer2.id)
    got = {i["id"]: i for i in items("officer@demo.in")}
    assert submitted in got and mine in got and theirs not in got
    assert got[submitted]["nextAction"] == "Claim and verify with bank"
    assert "Waiting 8 days for verification" in got[submitted]["reasons"]
    assert got[mine]["nextAction"] == "Verify with bank"
    assert got[mine]["link"] == f"/officer/review/{mine}"


def test_ac4_approver_excludes_requests_already_acted_on_or_blocked_by_separation_of_duties() -> None:
    inst1 = user_for("inst1@demo.in")
    approver, officer = user_for("approver@demo.in"), user_for("officer@demo.in")
    fresh = add_release_request(make_instrument("RELEASE_REQUESTED", "2027-06-01"), inst1.id, "PENDING_APPROVAL", 2)
    add_approval(fresh, 1, "officer", officer.id, "RECOMMEND")
    # Approver decided level 2; level 3 is an approver level they may not take (D27).
    sod = add_release_request(make_instrument("RELEASE_REQUESTED", "2027-06-01"), inst1.id, "PENDING_APPROVAL", 3)
    add_approval(sod, 1, "officer", officer.id, "RECOMMEND")
    add_approval(sod, 2, "approver", approver.id, "APPROVE")
    # Approver already acted on this level (returned it); it came back to the same level.
    acted = add_release_request(make_instrument("RELEASE_REQUESTED", "2027-06-01"), inst1.id, "PENDING_APPROVAL", 2)
    add_approval(acted, 2, "approver", approver.id, "RETURN")
    officer_turn = add_release_request(
        make_instrument("RELEASE_REQUESTED", "2027-06-01"), inst1.id, "PENDING_CONDITIONS", 1
    )

    mine = [i for i in items("approver@demo.in") if i["kind"] == "release"]
    assert [i["id"] for i in mine] == [fresh]
    assert mine[0]["nextAction"] == "Decide release request"
    assert mine[0]["link"] == f"/approver/releases/{fresh}"
    assert {i["id"] for i in items("approver2@demo.in") if i["kind"] == "release"} == {fresh, sod, acted}
    officer_items = [i for i in items("officer@demo.in") if i["kind"] == "release"]
    assert [i["id"] for i in officer_items] == [officer_turn]
    assert officer_items[0]["nextAction"] == "Recommend or return release request"


def test_admin_sees_level3_and_roles() -> None:
    stuck = make_instrument("UNDER_SCRUTINY", "2027-06-01", verification_state="UNVERIFIED",
                             submitted_at="2026-09-01T05:00:00Z")  # fmt: skip
    evaluate_on("2026-10-01")
    evaluate_on("2026-10-15")
    evaluate_on(D0)  # pending verification since 6 Sep → L3 by now
    admin_items = items("admin@demo.in")
    assert [i["id"] for i in admin_items] == [stuck]
    assert "Escalated to administrator (L3)" in admin_items[0]["reasons"]
    assert get(user_for("auditor@demo.in"), "/myday").status_code == 403
    assert get(user_for("inst1@demo.in"), "/myday").status_code == 403
