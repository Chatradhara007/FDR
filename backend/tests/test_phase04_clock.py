"""Phase 04: clock changes run the job and return { clock, summary }; on-demand evaluation; outbox; rules."""

from __future__ import annotations

import pytest
from app.db.pool import exec_, get_pool, one
from app.domain.rules import load_rules
from app.schemas import RULE_CONFIG_MODELS, ReminderRule
from app.shared_constants import RULE_DEFAULTS
from helpers import alerts_of, api, bearer, count_events, evaluate_on, make_instrument, reset_db, set_today, user_for

D0 = "2026-10-25"
SUMMARY_KEYS = {"asOf", "statusChanges", "alertsCreated", "escalations", "resolved", "superseded"}


@pytest.fixture(autouse=True)
def _fresh() -> None:
    reset_db()
    set_today(D0)


def test_ac11_clock_advance_returns_the_summary_and_non_admins_get_403() -> None:
    admin = user_for("admin@demo.in")
    make_instrument("ACTIVE", "2026-12-01")
    res = api().post("/api/v1/clock/advance", headers=bearer(admin), json={"days": 1})
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"clock", "summary"}
    assert body["clock"]["mode"] == "SIMULATED" and body["clock"]["today"] == "2026-10-26"
    assert set(body["summary"]) == SUMMARY_KEYS
    assert body["summary"]["asOf"] == "2026-10-26"
    assert body["summary"]["statusChanges"] == 1 and body["summary"]["alertsCreated"] == 2
    # The clock event and the job's events are in the same transaction; JOB_EVALUATED carries the summary.
    job = one(get_pool(), "SELECT after_json FROM events WHERE action = 'JOB_EVALUATED'")["after_json"]
    assert job == body["summary"]
    for path, payload in (("set", {"date": "2027-01-01"}), ("reset", None)):
        r = api().post(f"/api/v1/clock/{path}", headers=bearer(admin), json=payload)
        assert r.status_code == 200 and set(r.json()["summary"]) == SUMMARY_KEYS
    for email in ("officer@demo.in", "approver@demo.in", "inst1@demo.in", "auditor@demo.in"):
        h = bearer(user_for(email))
        assert api().post("/api/v1/clock/advance", headers=h, json={"days": 1}).status_code == 403
        assert api().post("/api/v1/jobs/evaluate", headers=h).status_code == 403
        assert api().get("/api/v1/outbox", headers=h).status_code == 403


def test_moving_the_clock_back_warns_and_never_deletes_alerts() -> None:
    admin = user_for("admin@demo.in")
    inst = make_instrument("ACTIVE", "2026-12-01")
    api().post("/api/v1/clock/set", headers=bearer(admin), json={"date": "2026-11-20"})
    before = alerts_of(inst)
    assert before
    back = api().post("/api/v1/clock/set", headers=bearer(admin), json={"date": "2026-10-01"})
    assert back.status_code == 200 and back.json()["clock"]["warning"] == "CLOCK_MOVED_BACKWARDS"
    assert alerts_of(inst) == before


def test_jobs_evaluate_runs_on_demand() -> None:
    make_instrument("MATURED", "2026-10-01")
    res = api().post("/api/v1/jobs/evaluate", headers=bearer(user_for("admin@demo.in")))
    assert res.status_code == 200
    assert res.json()["asOf"] == D0 and res.json()["statusChanges"] == 1 and res.json()["alertsCreated"] == 3


def test_outbox_lists_simulated_emails_newest_first() -> None:
    admin = user_for("admin@demo.in")
    inst = make_instrument("MATURED", "2026-10-15")
    evaluate_on(D0)
    res = api().get("/api/v1/outbox?pageSize=2", headers=bearer(admin))
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3 and len(body["items"]) == 2
    item = body["items"][0]
    assert item["subject"].startswith("[AICTE FDR Portal] Overdue:")
    assert "This is an automated message" in item["body"]
    to_inst = one(get_pool(), "SELECT to_institution_id FROM outbox WHERE to_role = 'institution'")
    inst_row = one(get_pool(), "SELECT institution_id FROM instruments WHERE id = $1", [inst])
    assert to_inst["to_institution_id"] == inst_row["institution_id"]


def test_rules_are_read_at_the_start_of_each_run() -> None:
    inst = make_instrument("ACTIVE", "2027-01-15")  # 82 days left
    exec_(
        get_pool(),
        """UPDATE rules SET config = '{"offsets":[{"days":45,"recipients":["officer"]}]}'::jsonb WHERE key = 'reminder'""",
    )
    evaluate_on(D0)
    assert instrument_still_active(inst)
    evaluate_on("2026-12-01")  # 45 days left
    assert [(r["rule_key"], r["recipient_role"]) for r in alerts_of(inst)] == [("maturity:45", "officer")]


def instrument_still_active(instrument_id: str) -> bool:
    return one(get_pool(), "SELECT status FROM instruments WHERE id = $1", [instrument_id])["status"] == "ACTIVE"


def test_rule_defaults_validate_and_bad_configs_are_rejected() -> None:
    for rule in RULE_DEFAULTS:
        if rule["key"] in RULE_CONFIG_MODELS:
            RULE_CONFIG_MODELS[rule["key"]].model_validate(rule["config"])
    rules = load_rules(get_pool())
    assert rules.expiring_window == 90 and rules.grace_days == 15
    assert [lv.role for lv in rules.escalation.levels] == ["officer", "approver", "admin"]
    with pytest.raises(ValueError):
        ReminderRule.model_validate({"offsets": [{"days": 0, "recipients": ["officer"]}]})
    with pytest.raises(ValueError):
        ReminderRule.model_validate({"offsets": [{"days": 30, "recipients": []}]})
    exec_(get_pool(), """UPDATE rules SET config = '{"offsets":[]}'::jsonb WHERE key = 'reminder'""")
    res = api().post("/api/v1/jobs/evaluate", headers=bearer(user_for("admin@demo.in")))
    assert res.status_code == 500 and res.json()["code"] == "RULE_INVALID"
    assert count_events("action = 'JOB_EVALUATED'") == 0


def test_scheduled_run_only_happens_with_the_real_clock() -> None:
    from app.domain import clock
    from app.jobs.scheduler import run_if_real

    inst = make_instrument("MATURED", "2020-01-01", issue="2019-01-01")
    run_if_real()  # clock is SIMULATED (set_today): the job is driven by the clock endpoints instead
    assert one(get_pool(), "SELECT status FROM instruments WHERE id = $1", [inst])["status"] == "MATURED"
    clock.reset_to_real(get_pool())
    run_if_real()
    assert one(get_pool(), "SELECT status FROM instruments WHERE id = $1", [inst])["status"] == "LAPSED"
