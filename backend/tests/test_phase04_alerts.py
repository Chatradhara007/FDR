"""Phase 04: escalation (D11), acknowledge / manual resolve, and who sees which alerts (D23)."""

from __future__ import annotations

from typing import Any

import pytest
from app.db.pool import get_pool, one
from helpers import alerts_of, api, bearer, evaluate_on, make_instrument, reset_db, set_today, user_for

D0 = "2026-10-01"


@pytest.fixture(autouse=True)
def _fresh() -> None:
    reset_db()
    set_today(D0)


def chain(instrument_id: str, kind: str) -> list[tuple[int, str, str]]:
    return [(r["level"], r["recipient_role"], r["status"]) for r in alerts_of(instrument_id) if r["kind"] == kind]


def alert_id(instrument_id: str, kind: str, role: str, level: int = 1) -> str:
    for r in alerts_of(instrument_id):
        if (r["kind"], r["recipient_role"], r["level"]) == (kind, role, level):
            return str(r["id"])
    raise AssertionError(f"no {kind} alert for {role} L{level}")


def test_ac7_pending_verification_escalates_to_approver_after_7_days_and_admin_after_14_despite_ack() -> None:
    officer, approver = user_for("officer@demo.in"), user_for("approver@demo.in")
    inst = make_instrument(
        "SUBMITTED", "2027-06-01", verification_state="UNVERIFIED", submitted_at="2026-09-26T05:00:00Z"
    )
    evaluate_on("2026-09-30")  # 4 days after submission: not yet
    assert chain(inst, "PENDING_VERIFICATION") == []
    evaluate_on("2026-10-01")  # 5 days
    assert chain(inst, "PENDING_VERIFICATION") == [(1, "officer", "OPEN")]
    root = alert_id(inst, "PENDING_VERIFICATION", "officer")
    due = one(get_pool(), "SELECT due_date FROM alerts WHERE id = $1", [root])["due_date"]
    assert due == "2026-10-01"

    # Acknowledging marks it seen but does not stop escalation.
    res = api().post(f"/api/v1/alerts/{root}/acknowledge", headers=bearer(officer))
    assert res.status_code == 200 and res.json()["status"] == "ACKNOWLEDGED"
    evaluate_on("2026-10-07")  # 6 days from the root
    assert chain(inst, "PENDING_VERIFICATION") == [(1, "officer", "ACKNOWLEDGED")]
    s = evaluate_on("2026-10-08")  # 7 days
    assert s["escalations"] == 1
    assert chain(inst, "PENDING_VERIFICATION") == [(1, "officer", "ESCALATED"), (2, "approver", "OPEN")]
    l2 = alert_id(inst, "PENDING_VERIFICATION", "approver", 2)
    row = one(get_pool(), "SELECT root_alert_id, message FROM alerts WHERE id = $1", [l2])
    assert row["root_alert_id"] == root and row["message"].startswith("Escalated to approver (L2)")
    assert api().post(f"/api/v1/alerts/{l2}/acknowledge", headers=bearer(approver)).status_code == 200

    evaluate_on("2026-10-15")  # 14 days from the root
    assert chain(inst, "PENDING_VERIFICATION") == [
        (1, "officer", "ESCALATED"),
        (2, "approver", "ESCALATED"),
        (3, "admin", "OPEN"),
    ]
    events = one(get_pool(), "SELECT count(*)::int AS n FROM events WHERE action = 'ALERT_ESCALATED'")["n"]
    assert events == 2
    emails = one(get_pool(), "SELECT count(*)::int AS n FROM outbox WHERE subject LIKE '%Escalation L%'")["n"]
    assert emails == 2


def test_ac7_a_big_jump_climbs_several_levels_in_one_run() -> None:
    inst = make_instrument(
        "SUBMITTED", "2027-06-01", verification_state="UNVERIFIED", submitted_at="2026-09-26T05:00:00Z"
    )
    evaluate_on("2026-10-01")
    s = evaluate_on("2026-11-01")
    assert s["escalations"] == 2
    assert [lvl for lvl, _, st in chain(inst, "PENDING_VERIFICATION") if st == "OPEN"] == [3]


def test_ac7_institution_copies_of_overdue_renewal_never_escalate() -> None:
    inst = make_instrument("MATURED", "2026-09-30")
    evaluate_on(D0)
    assert sorted(chain(inst, "OVERDUE_RENEWAL")) == [
        (1, "approver", "OPEN"),
        (1, "institution", "OPEN"),
        (1, "officer", "OPEN"),
    ]
    evaluate_on("2026-10-31")  # 30 days later; the instrument has lapsed meanwhile
    assert sorted(chain(inst, "OVERDUE_RENEWAL")) == [
        (1, "approver", "OPEN"),  # level 1 belongs to the officer in the ladder: the approver copy stays
        (1, "institution", "OPEN"),
        (1, "officer", "ESCALATED"),
        (2, "approver", "ESCALATED"),
        (3, "admin", "OPEN"),
    ]


def test_maturity_reminders_do_not_climb() -> None:
    inst = make_instrument("EXPIRING", "2026-12-01")
    evaluate_on(D0)
    evaluate_on("2026-10-25")
    assert all(r["level"] == 1 for r in alerts_of(inst))


def test_ac9_manual_resolve_needs_a_note_and_records_manual() -> None:
    officer = user_for("officer@demo.in")
    inst = make_instrument("MATURED", "2026-09-30")
    evaluate_on(D0)
    target = alert_id(inst, "OVERDUE_RENEWAL", "officer")
    for body in ({}, {"note": "   "}):
        res = api().post(f"/api/v1/alerts/{target}/resolve", headers=bearer(officer), json=body)
        assert res.status_code == 422
        assert res.json()["details"][0]["field"] == "note"
    for email in ("inst1@demo.in", "auditor@demo.in"):
        res = api().post(f"/api/v1/alerts/{target}/resolve", headers=bearer(user_for(email)), json={"note": "x"})
        assert res.status_code == 403, email
    res = api().post(
        f"/api/v1/alerts/{target}/resolve", headers=bearer(officer), json={"note": "Renewal letter received"}
    )
    assert res.status_code == 200
    assert res.json()["status"] == "RESOLVED" and res.json()["resolution"] == "MANUAL"
    row = one(get_pool(), "SELECT resolution, resolution_note, resolved_by FROM alerts WHERE id = $1", [target])
    assert row == {"resolution": "MANUAL", "resolution_note": "Renewal letter received", "resolved_by": officer.id}
    event = one(get_pool(), "SELECT actor_id, after_json FROM events WHERE action = 'ALERT_RESOLVED'")
    assert event["actor_id"] == officer.id and event["after_json"]["resolution"] == "MANUAL"
    # Resolved by hand stays resolved: the next run does not recreate or escalate it.
    evaluate_on("2026-10-20")
    assert [r["status"] for r in alerts_of(inst) if r["recipient_role"] == "officer"] == ["RESOLVED"]
    again = api().post(f"/api/v1/alerts/{target}/resolve", headers=bearer(officer), json={"note": "again"})
    assert again.status_code == 409


def ids(res: Any) -> set[str]:
    assert res.status_code == 200, res.text
    return {a["id"] for a in res.json()["items"]}


def test_ac10_institutions_only_see_their_own_institution_role_alerts() -> None:
    inst1, inst2, officer = user_for("inst1@demo.in"), user_for("inst2@demo.in"), user_for("officer@demo.in")
    mine = make_instrument("MATURED", "2026-09-30")
    theirs = make_instrument("MATURED", "2026-09-30", institution_email="inst2@demo.in")
    evaluate_on(D0)
    seen = ids(api().get("/api/v1/alerts", headers=bearer(inst1)))
    assert seen == {alert_id(mine, "OVERDUE_RENEWAL", "institution")}
    items = api().get("/api/v1/alerts", headers=bearer(inst1)).json()["items"]
    assert items[0]["instrumentReferenceNo"].startswith("CNRB/FD/TEST/") and items[0]["institutionName"]
    assert ids(api().get("/api/v1/alerts", headers=bearer(inst2))) == {
        alert_id(theirs, "OVERDUE_RENEWAL", "institution")
    }
    # Someone else's alert, or an internal copy, is "not found" for an institution (rule 8).
    for other in (alert_id(theirs, "OVERDUE_RENEWAL", "institution"), alert_id(mine, "OVERDUE_RENEWAL", "officer")):
        assert api().post(f"/api/v1/alerts/{other}/acknowledge", headers=bearer(inst1)).status_code == 404
    assert api().post(f"/api/v1/alerts/{alert_id(mine, 'OVERDUE_RENEWAL', 'institution')}/acknowledge",
                      headers=bearer(inst1)).status_code == 200  # fmt: skip
    assert api().get("/api/v1/alerts/summary", headers=bearer(inst1)).json()["total"] == 1
    # Internal roles see their own role's copies; the auditor sees everything.
    assert ids(api().get("/api/v1/alerts", headers=bearer(officer))) == {
        alert_id(mine, "OVERDUE_RENEWAL", "officer"),
        alert_id(theirs, "OVERDUE_RENEWAL", "officer"),
    }
    assert len(ids(api().get("/api/v1/alerts?status=all", headers=bearer(user_for("auditor@demo.in"))))) == 6


def test_officer_alerts_go_to_the_assigned_officer_or_the_pool() -> None:
    officer, officer2 = user_for("officer@demo.in"), user_for("officer2@demo.in")
    assigned = make_instrument("MATURED", "2026-09-30", assigned_officer_id=officer.id)
    pool = make_instrument("MATURED", "2026-09-30")
    evaluate_on(D0)
    a, p = alert_id(assigned, "OVERDUE_RENEWAL", "officer"), alert_id(pool, "OVERDUE_RENEWAL", "officer")
    assert ids(api().get("/api/v1/alerts", headers=bearer(officer))) == {a, p}
    assert ids(api().get("/api/v1/alerts?mine=true", headers=bearer(officer))) == {a}
    assert ids(api().get("/api/v1/alerts", headers=bearer(officer2))) == {p}


def test_alert_list_filters_tabs_and_summary() -> None:
    officer, approver = user_for("officer@demo.in"), user_for("approver@demo.in")
    inst = make_instrument(
        "SUBMITTED", "2027-06-01", verification_state="UNVERIFIED", submitted_at="2026-09-20T05:00:00Z"
    )
    make_instrument("MATURED", "2026-09-30")
    evaluate_on(D0)
    evaluate_on("2026-10-09")  # both roots (created 1 Oct) are 8 days old -> the officer copies climb to L2
    res = api().get("/api/v1/alerts?level=2&kind=PENDING_VERIFICATION", headers=bearer(approver))
    assert [(a["kind"], a["level"], a["ageDays"]) for a in res.json()["items"]] == [("PENDING_VERIFICATION", 2, 8)]
    summary = api().get("/api/v1/alerts/summary", headers=bearer(approver)).json()
    # approver: its own L1 overdue-renewal copy, plus the two escalated L2 alerts
    assert summary["total"] == 3 and summary["byLevel"] == {"1": 1, "2": 2}
    assert summary["byKind"]["OVERDUE_RENEWAL"] == 2 and summary["byKind"]["PENDING_VERIFICATION"] == 1
    # Escalated originals leave the officer's open tab; they are listed under ESCALATED.
    assert all(
        a["kind"] != "PENDING_VERIFICATION"
        for a in api().get("/api/v1/alerts", headers=bearer(officer)).json()["items"]
    )
    escalated = api().get(f"/api/v1/alerts?status=ESCALATED&instrumentId={inst}", headers=bearer(officer)).json()
    assert [a["level"] for a in escalated["items"]] == [1]
    assert api().get("/api/v1/alerts?status=nope", headers=bearer(officer)).status_code == 422
    assert api().get("/api/v1/alerts?kind=NOPE", headers=bearer(officer)).status_code == 422
    assert api().post("/api/v1/alerts/not-a-uuid/acknowledge", headers=bearer(officer)).status_code == 404


def test_instrument_lists_show_the_worst_open_alert_level() -> None:
    officer, inst1 = user_for("officer@demo.in"), user_for("inst1@demo.in")
    inst = make_instrument(
        "SUBMITTED", "2027-06-01", verification_state="UNVERIFIED", submitted_at="2026-09-20T05:00:00Z"
    )
    evaluate_on(D0)
    evaluate_on("2026-10-16")  # 15 days from the root -> L3 (admin)
    queue = api().get("/api/v1/scrutiny/queue", headers=bearer(officer)).json()["items"]
    # AICTE roles see the worst open level across every copy: the officer's own copy is ESCALATED, the admin's L3 open.
    assert [(q["id"], q["worstOpenAlertLevel"], q["openAlertCount"]) for q in queue] == [(inst, 3, 1)]
    admin_list = api().get("/api/v1/instruments", headers=bearer(user_for("admin@demo.in"))).json()["items"]
    assert [(i["worstOpenAlertLevel"], i["openAlertCount"]) for i in admin_list] == [(3, 1)]
    # Institutions count only their own copies (pending verification has none).
    own = api().get("/api/v1/instruments", headers=bearer(inst1)).json()["items"]
    assert [(i["worstOpenAlertLevel"], i["openAlertCount"]) for i in own] == [(None, 0)]
