from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from app.db.pool import get_pool
from app.domain import clock
from app.domain.audit import NIL_UUID
from app.repositories.event_repo import events_for_entity
from helpers import api, bearer, reset_db, user_for


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()


def test_pure_helpers_days_between_add_days_ist_date() -> None:
    assert clock.days_between("2026-12-25", "2027-01-04") == 10
    assert clock.days_between("2027-03-01", "2027-02-27") == -2
    assert clock.days_between("2028-02-28", "2028-03-01") == 2
    assert clock.add_days("2026-12-28", 5) == "2027-01-02"
    # 20:00 UTC on 31 Mar is already 1 Apr in India.
    assert clock.ist_date(datetime(2027, 3, 31, 20, tzinfo=UTC)) == "2027-04-01"


def test_get_clock_is_visible_to_every_role_and_reports_real_by_default() -> None:
    for email in ("inst1@demo.in", "officer@demo.in", "auditor@demo.in"):
        res = api().get("/api/v1/clock", headers=bearer(user_for(email)))
        assert res.status_code == 200
        body = res.json()
        assert set(body) == {"mode", "now", "today"}
        assert body["mode"] == "REAL" and isinstance(body["now"], str)
        assert body["today"] == clock.today(get_pool())
    assert api().get("/api/v1/clock").status_code == 401


def test_ac6_advance_10_days_moves_today_and_writes_clock_advanced_reset_returns_to_real() -> None:
    admin = user_for("admin@demo.in")
    before = clock.today(get_pool())
    res = api().post("/api/v1/clock/advance", headers=bearer(admin), json={"days": 10})
    assert res.status_code == 200
    # Phase 04: clock changes return { clock, summary } (the evaluation job runs in the same request).
    assert res.json()["clock"]["mode"] == "SIMULATED" and res.json()["clock"]["today"] == clock.add_days(before, 10)
    assert "warning" not in res.json()["clock"]
    assert clock.today(get_pool()) == clock.add_days(before, 10)
    assert clock.days_between(before, clock.today(get_pool())) == 10

    events = events_for_entity(get_pool(), "clock", NIL_UUID)
    assert len(events) == 1
    e = events[0]
    assert e["action"] == "CLOCK_ADVANCED" and e["actor_id"] == admin.id and e["actor_label"] == admin.name
    assert isinstance(e["before_json"], dict) and isinstance(e["after_json"], dict)
    assert {k: e["before_json"][k] for k in ("mode", "today")} == {"mode": "REAL", "today": before}
    assert {k: e["after_json"][k] for k in ("mode", "today", "days")} == {
        "mode": "SIMULATED",
        "today": clock.add_days(before, 10),
        "days": 10,
    }
    # The event itself is stamped with the (new) app clock.
    assert clock.ist_date(e["created_at"]) == clock.add_days(before, 10)

    reset = api().post("/api/v1/clock/reset", headers=bearer(admin))
    assert reset.status_code == 200
    assert {k: reset.json()["clock"][k] for k in ("mode", "today", "warning")} == {
        "mode": "REAL",
        "today": before,
        "warning": "CLOCK_MOVED_BACKWARDS",
    }
    assert clock.mode(get_pool()) == "REAL"
    assert [x["action"] for x in events_for_entity(get_pool(), "clock", NIL_UUID)] == ["CLOCK_ADVANCED", "CLOCK_RESET"]


def test_ac6_non_admins_get_403_on_clock_changes_and_nothing_changes() -> None:
    for email in ("officer@demo.in", "approver@demo.in", "inst1@demo.in", "auditor@demo.in"):
        h = bearer(user_for(email))
        assert api().post("/api/v1/clock/advance", headers=h, json={"days": 10}).status_code == 403, email
        assert api().post("/api/v1/clock/set", headers=h, json={"date": "2027-01-01"}).status_code == 403
        assert api().post("/api/v1/clock/reset", headers=h).status_code == 403
    assert clock.mode(get_pool()) == "REAL"
    assert events_for_entity(get_pool(), "clock", NIL_UUID) == []


def test_set_simulates_10_ist_moving_backwards_warns_bad_input_is_422() -> None:
    h = bearer(user_for("admin@demo.in"))
    s = api().post("/api/v1/clock/set", headers=h, json={"date": "2030-12-12"})
    assert s.status_code == 200
    assert s.json()["clock"] == {"mode": "SIMULATED", "now": "2030-12-12T04:30:00.000Z", "today": "2030-12-12"}
    back = api().post("/api/v1/clock/set", headers=h, json={"date": "2030-01-01"})
    assert back.json()["clock"]["today"] == "2030-01-01" and back.json()["clock"]["warning"] == "CLOCK_MOVED_BACKWARDS"
    adv = api().post("/api/v1/clock/advance", headers=h, json={"days": 365})
    assert adv.json()["clock"]["today"] == "2031-01-01" and adv.json()["clock"]["now"] == "2031-01-01T04:30:00.000Z"
    for body in ({"days": 0}, {"days": 731}, {"days": 1.5}, {"days": "10"}, {}):
        assert api().post("/api/v1/clock/advance", headers=h, json=body).status_code == 422, json.dumps(body)
    for date in ("2030-02-30", "12/12/2030", ""):
        res = api().post("/api/v1/clock/set", headers=h, json={"date": date})
        assert res.status_code == 422, date
        assert res.json()["details"][0]["field"] == "date"
