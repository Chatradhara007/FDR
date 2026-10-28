"""Phase 04: the evaluation job — status sweeps, maturity reminders (D1, D2), cascade, lapse rule, auto-resolution,
idempotence and scale (D18)."""

from __future__ import annotations

import os
import time
from typing import Any

import pytest
from app.db.pool import exec_, get_pool, many, one
from app.domain import clock
from helpers import (
    alerts_of,
    api,
    bearer,
    count_events,
    evaluate_on,
    instrument_status,
    make_instrument,
    ready_fdr,
    reset_db,
    set_today,
    user_for,
)

D0 = "2026-10-25"


@pytest.fixture(autouse=True)
def _fresh() -> None:
    reset_db()
    set_today(D0)


def live(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in rows if r["status"] != "RESOLVED"]


def test_ac1_advance_45_days_sweeps_to_expiring_and_creates_reminders_matching_the_summary() -> None:
    admin = user_for("admin@demo.in")
    soon = make_instrument("ACTIVE", "2027-01-15")  # 37 days left after the jump -> 60-day reminder
    mid = make_instrument("ACTIVE", "2027-03-01")  # 82 days left -> 90-day reminder
    far = make_instrument("ACTIVE", "2027-06-01")  # 174 days left -> untouched
    res = api().post("/api/v1/clock/advance", headers=bearer(admin), json={"days": 45})
    assert res.status_code == 200
    body = res.json()
    assert body["clock"]["today"] == "2026-12-09"
    s = body["summary"]

    assert instrument_status(soon) == "EXPIRING" and instrument_status(mid) == "EXPIRING"
    assert instrument_status(far) == "ACTIVE"
    assert {(r["rule_key"], r["recipient_role"]) for r in live(alerts_of(soon))} == {
        ("maturity:60", "institution"),
        ("maturity:60", "officer"),
    }
    assert {(r["rule_key"], r["recipient_role"]) for r in live(alerts_of(mid))} == {
        ("maturity:90", "institution"),
        ("maturity:90", "officer"),
    }
    assert alerts_of(far) == []

    # Summary counters agree with the database.
    db = get_pool()
    n_live = one(db, "SELECT count(*)::int AS n FROM alerts WHERE status = 'OPEN'")["n"]
    n_sup = one(db, "SELECT count(*)::int AS n FROM alerts WHERE resolution = 'SUPERSEDED'")["n"]
    n_status = one(db, "SELECT count(*)::int AS n FROM events WHERE action LIKE 'STATUS\\_%'")["n"]
    assert s["statusChanges"] == n_status == 2
    assert s["alertsCreated"] == n_live == 4
    assert s["superseded"] == n_sup == 2  # soon's 90-day reminders, inserted already superseded
    assert s["escalations"] == 0 and s["resolved"] == 0
    # Every live alert got one simulated email; superseded ones none.
    assert one(db, "SELECT count(*)::int AS n FROM outbox")["n"] == 4
    subject = one(db, "SELECT subject FROM outbox ORDER BY id LIMIT 1")["subject"]
    assert subject.startswith("[AICTE FDR Portal] Reminder: FDR ")


def test_ac2_running_twice_on_the_same_date_changes_nothing() -> None:
    make_instrument("ACTIVE", "2026-11-20")
    make_instrument("SUBMITTED", "2027-06-01", verification_state="UNVERIFIED", submitted_at="2026-10-01T05:00:00Z")
    make_instrument("MATURED", "2026-10-01")
    first = evaluate_on(D0)
    assert first["alertsCreated"] > 0
    events, alerts, outbox = count_events(), alerts_of_all(), outbox_count()
    second = evaluate_on(D0)
    assert {k: v for k, v in second.items() if k != "asOf"} == {
        "statusChanges": 0, "alertsCreated": 0, "escalations": 0, "resolved": 0, "superseded": 0,
    }  # fmt: skip
    # Not even a JOB_EVALUATED event: a repeat run leaves no trace.
    assert (count_events(), alerts_of_all(), outbox_count()) == (events, alerts, outbox)


def alerts_of_all() -> list[dict[str, Any]]:
    return many(get_pool(), "SELECT id, status, level FROM alerts ORDER BY id")


def outbox_count() -> int:
    return int(one(get_pool(), "SELECT count(*)::int AS n FROM outbox")["n"])


def test_ac3_d2_jumps_leave_one_live_reminder_per_role_and_supersede_the_looser_ones() -> None:
    maturity = "2027-03-01"
    inst = make_instrument("ACTIVE", maturity)
    evaluate_on(clock.add_days(maturity, -100))
    assert alerts_of(inst) == []

    evaluate_on(clock.add_days(maturity, -10))
    rows = alerts_of(inst)
    assert sorted((r["rule_key"], r["recipient_role"]) for r in live(rows)) == [
        ("maturity:30", "institution"),
        ("maturity:30", "officer"),
    ]
    superseded = sorted((r["rule_key"], r["recipient_role"]) for r in rows if r["resolution"] == "SUPERSEDED")
    assert superseded == [
        ("maturity:60", "institution"), ("maturity:60", "officer"),
        ("maturity:90", "institution"), ("maturity:90", "officer"),
    ]  # fmt: skip

    s = evaluate_on(clock.add_days(maturity, -5))
    rows = alerts_of(inst)
    assert sorted((r["rule_key"], r["recipient_role"]) for r in live(rows)) == [
        ("maturity:7", "approver"),
        ("maturity:7", "institution"),
        ("maturity:7", "officer"),
    ]
    assert all(
        r["status"] == "RESOLVED" and r["resolution"] == "SUPERSEDED" for r in rows if r["rule_key"] == "maturity:30"
    )
    assert s["superseded"] == 2 and s["alertsCreated"] == 3
    # The previously live 30-day reminders were updated (with an event), not duplicated.
    assert len([r for r in rows if r["rule_key"] == "maturity:30"]) == 2
    assert count_events("action = 'ALERT_RESOLVED' AND after_json->>'resolution' = 'SUPERSEDED'") == 2


def test_ac4_d1_a_30_day_reminder_makes_an_institution_and_an_officer_alert() -> None:
    officer = user_for("officer@demo.in")
    inst = make_instrument("EXPIRING", "2026-11-20", assigned_officer_id=officer.id)  # 26 days left
    evaluate_on(D0)
    rows = live(alerts_of(inst))
    assert [(r["rule_key"], r["recipient_role"]) for r in rows] == [
        ("maturity:30", "institution"),
        ("maturity:30", "officer"),
    ]
    assert len({r["dedupe_key"] for r in rows}) == 2
    by_role = {r["recipient_role"]: r for r in rows}
    assert by_role["officer"]["recipient_user_id"] == officer.id  # D23: assigned officer
    assert by_role["institution"]["recipient_user_id"] is None
    assert by_role["officer"]["dedupe_key"] == f"{inst}|MATURITY_REMINDER|maturity:30|-|2026-11-20|1|officer"
    msg = one(get_pool(), "SELECT message FROM alerts WHERE id = $1", [by_role["officer"]["id"]])["message"]
    assert msg.startswith("FDR CNRB/FD/TEST/") and "(₹25 L, Canara Bank) matures on 20 Nov 2026 — 26 days left" in msg


def test_ac5_cascade_active_to_lapsed_in_one_run_with_three_status_events() -> None:
    maturity = "2026-11-01"
    inst = make_instrument("ACTIVE", maturity)
    s = evaluate_on(clock.add_days(maturity, 200))
    assert instrument_status(inst) == "LAPSED"
    actions = [
        r["action"] for r in many(get_pool(), "SELECT action FROM events WHERE instrument_id = $1 ORDER BY id", [inst])
    ]
    assert [a for a in actions if a.startswith("STATUS_")] == ["STATUS_EXPIRING", "STATUS_MATURED", "STATUS_LAPSED"]
    assert s["statusChanges"] == 3
    actor = one(get_pool(), "SELECT actor_label FROM events WHERE action = 'STATUS_LAPSED'")["actor_label"]
    assert actor == "system"
    # No reminders for an instrument already past maturity; it is overdue instead.
    assert {r["kind"] for r in live(alerts_of(inst))} == {"OVERDUE_RENEWAL"}


def test_ac6_lapse_waits_for_a_submitted_successor_but_not_for_a_draft() -> None:
    maturity = "2026-09-01"  # grace (15 days) ended on 16 Sep
    with_draft = make_instrument("MATURED", maturity)
    make_instrument("DRAFT", "2027-09-01", parent_id=with_draft, issue="2026-09-01")
    with_submitted = make_instrument("MATURED", maturity)
    make_instrument("SUBMITTED", "2027-09-01", parent_id=with_submitted, issue="2026-09-01",
                    verification_state="UNVERIFIED", submitted_at="2026-09-10T05:00:00Z")  # fmt: skip
    evaluate_on(D0)
    assert instrument_status(with_draft) == "LAPSED"
    assert instrument_status(with_submitted) == "MATURED"


def test_lapse_happens_only_after_the_grace_period() -> None:
    inst = make_instrument("MATURED", "2026-10-10")
    evaluate_on("2026-10-25")  # maturity + 15: still within grace
    assert instrument_status(inst) == "MATURED"
    evaluate_on("2026-10-26")
    assert instrument_status(inst) == "LAPSED"


def test_overdue_renewal_messages_distinguish_matured_from_lapsed() -> None:
    matured = make_instrument("MATURED", "2026-10-20")
    lapsed = make_instrument("LAPSED", "2026-09-01")
    evaluate_on(D0)
    msg = {
        i: one(get_pool(), "SELECT message FROM alerts WHERE instrument_id = $1 AND recipient_role = 'officer'", [i])[
            "message"
        ]
        for i in (matured, lapsed)
    }
    assert "matured on 20 Oct 2026 and is not renewed; grace ends 4 Nov 2026" in msg[matured]
    assert "lapsed" in msg[lapsed] and "16 Sep 2026" in msg[lapsed]
    due = one(get_pool(), "SELECT due_date FROM alerts WHERE instrument_id = $1 LIMIT 1", [matured])["due_date"]
    assert due == "2026-11-04"


def test_ac8_confirming_verification_closes_the_pending_alert_and_its_escalated_copies() -> None:
    inst = make_instrument("UNDER_SCRUTINY", "2027-06-01", verification_state="PENDING",
                           submitted_at="2026-10-01T05:00:00Z")  # fmt: skip
    evaluate_on("2026-10-06")  # 5 days after submission
    evaluate_on("2026-10-20")  # +14 from the root: approver and admin levels
    assert [(r["level"], r["status"]) for r in alerts_of(inst)] == [(1, "ESCALATED"), (2, "ESCALATED"), (3, "OPEN")]
    exec_(get_pool(), "UPDATE instruments SET verification_state = 'CONFIRMED' WHERE id = $1", [inst])
    s = evaluate_on("2026-10-21")
    rows = alerts_of(inst)
    assert all(r["status"] == "RESOLVED" and r["resolution"] == "SYSTEM_CONDITION_CLEARED" for r in rows)
    assert s["resolved"] == 3
    assert count_events("action = 'ALERT_RESOLVED' AND instrument_id = $1", [inst]) == 3


def test_reminders_close_when_the_instrument_matures_and_discrepancy_alerts_follow_their_discrepancy() -> None:
    inst = make_instrument("EXPIRING", "2026-10-30")
    evaluate_on(D0)
    assert {r["rule_key"] for r in live(alerts_of(inst))} == {"maturity:7"}
    evaluate_on("2026-10-30")
    assert instrument_status(inst) == "MATURED"
    assert all(r["status"] == "RESOLVED" for r in alerts_of(inst) if r["kind"] == "MATURITY_REMINDER")

    other = make_instrument(
        "UNDER_SCRUTINY", "2027-06-01", verification_state="MISMATCH", submitted_at="2026-10-01T05:00:00Z"
    )
    d = one(
        get_pool(),
        """INSERT INTO discrepancies (instrument_id, field_name, claimed_value, confirmed_value, reason, created_at)
           VALUES ($1, 'amount', '2500000.00', '2000000.00', 'Amount mismatch', '2026-10-02T05:00:00Z') RETURNING id""",
        [other],
    )["id"]
    evaluate_on("2026-10-08")  # 6 days: not yet
    assert [r for r in alerts_of(other) if r["kind"] == "DISCREPANCY_OPEN"] == []
    evaluate_on("2026-10-09")
    rows = [r for r in alerts_of(other) if r["kind"] == "DISCREPANCY_OPEN"]
    assert [(r["subject_id"], r["recipient_role"], r["status"]) for r in rows] == [(d, "officer", "OPEN")]
    exec_(get_pool(), "UPDATE discrepancies SET status = 'RESOLVED' WHERE id = $1", [d])
    evaluate_on("2026-10-10")
    assert [r["status"] for r in alerts_of(other) if r["kind"] == "DISCREPANCY_OPEN"] == ["RESOLVED"]


def test_accepting_close_to_maturity_moves_the_instrument_on_at_once() -> None:
    """D20 targeted sweep in the Phase 3 after-accept hook: accepted 40 days before maturity -> EXPIRING."""
    inst1, officer = user_for("inst1@demo.in"), user_for("officer@demo.in")
    instrument_id = ready_fdr(inst1, {**_fdr(), "maturityDate": clock.add_days(D0, 40)})
    assert api().post(f"/api/v1/instruments/{instrument_id}/submit", headers=bearer(inst1)).status_code == 200
    assert api().post(f"/api/v1/instruments/{instrument_id}/claim", headers=bearer(officer)).status_code == 200
    res = api().post(
        f"/api/v1/instruments/{instrument_id}/accept",
        headers=bearer(officer),
        json={"overrideNote": "Bank letter seen"},
    )
    assert res.status_code == 200, res.text
    assert instrument_status(instrument_id) == "EXPIRING"


def _fdr() -> dict[str, Any]:
    from helpers import VALID_FDR

    return dict(VALID_FDR)


def test_ac12_a_365_day_jump_over_500_instruments_is_fast() -> None:
    db = get_pool()
    inst = one(db, "SELECT id FROM institutions ORDER BY aicte_id LIMIT 1")["id"]
    exec_(
        db,
        """INSERT INTO instruments (institution_id, type, reference_no, issuing_bank, amount, issue_date, maturity_date,
                                    beneficiary_name, lien_marked, status, verification_state, submitted_at, created_at,
                                    updated_at)
           SELECT $1, 'FDR', 'PERF/' || g, 'Canara Bank', 1000000 + g * 1000, '2025-06-01',
                  '2026-10-26'::date + (g % 400), 'Member Secretary, AICTE', true,
                  CASE WHEN g % 5 = 0 THEN 'SUBMITTED' ELSE 'ACTIVE' END::instrument_status,
                  CASE WHEN g % 5 = 0 THEN 'UNVERIFIED' ELSE 'CONFIRMED' END::verification_state,
                  CASE WHEN g % 5 = 0 THEN '2026-10-20T05:00:00Z'::timestamptz END,
                  '2026-10-20T05:00:00Z', '2026-10-20T05:00:00Z'
             FROM generate_series(1, 500) g""",
        [inst],
    )
    evaluate_on(D0)
    admin = user_for("admin@demo.in")
    started = time.perf_counter()
    res = api().post("/api/v1/clock/advance", headers=bearer(admin), json={"days": 365})
    elapsed = time.perf_counter() - started
    assert res.status_code == 200, res.text
    assert res.json()["summary"]["statusChanges"] > 500
    budget = float(os.environ.get("JUMP_BUDGET_SECONDS", "5"))  # loosened on slow machines, like SEED_BUDGET_SECONDS
    assert elapsed < budget, f"365-day jump took {elapsed:.2f}s (budget {budget:g}s)"
