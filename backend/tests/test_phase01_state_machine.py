from __future__ import annotations

from datetime import datetime

import pytest
from app.db.pool import get_pool, transaction
from app.domain.audit import SYSTEM_ACTOR, Actor
from app.domain.errors import AppError
from app.domain.state_machine import transition
from app.repositories.event_repo import events_for_entity
from app.repositories.instrument_repo import find_instrument_by_id, lock_instrument
from app.shared_constants import InstrumentStatus
from helpers import count_events, create_instrument, institution_id, reset_db


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()


def move(instrument_id: str, to: InstrumentStatus, extra: dict[str, object] | None = None) -> None:
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        transition(tx, {"id": inst["id"], "status": inst["status"]}, to, Actor(label="Test officer"), extra)


def _status(instrument_id: str) -> dict[str, object]:
    row = find_instrument_by_id(get_pool(), instrument_id)
    assert row is not None
    return dict(row)


def test_ac4_draft_to_active_is_rejected_with_invalid_transition_and_writes_no_event() -> None:
    inst = create_instrument(institutionId=institution_id("inst1@demo.in"))
    with pytest.raises(AppError) as err:
        move(inst["id"], "ACTIVE")
    assert err.value.code == "INVALID_TRANSITION" and err.value.http_status == 409
    assert err.value.details == {"from": "DRAFT", "to": "ACTIVE"}
    assert count_events() == 0
    after = _status(inst["id"])
    assert after["status"] == "DRAFT" and after["version"] == 1


def test_ac4_draft_to_submitted_updates_status_bumps_version_writes_one_status_submitted() -> None:
    inst = create_instrument(institutionId=institution_id("inst1@demo.in"))
    move(inst["id"], "SUBMITTED", {"note": "first submission"})
    after = _status(inst["id"])
    assert after["status"] == "SUBMITTED" and after["version"] == 2
    assert isinstance(after["updatedAt"], datetime)
    events = events_for_entity(get_pool(), "instrument", inst["id"])
    assert len(events) == 1
    e = events[0]
    assert e["action"] == "STATUS_SUBMITTED" and e["actor_label"] == "Test officer"
    assert e["instrument_id"] == inst["id"]
    assert e["before_json"] == {"status": "DRAFT"}
    assert e["after_json"] == {"status": "SUBMITTED", "note": "first submission"}
    assert count_events() == 1


def test_a_stale_status_changed_concurrently_is_a_409_conflict_and_writes_nothing() -> None:
    inst = create_instrument(institutionId=institution_id("inst1@demo.in"))
    move(inst["id"], "SUBMITTED")
    # Caller still believes the instrument is DRAFT.
    with pytest.raises(AppError) as err, transaction() as tx:
        transition(tx, {"id": inst["id"], "status": "DRAFT"}, "SUBMITTED", SYSTEM_ACTOR)
    assert err.value.http_status == 409 and err.value.code == "STATUS_CHANGED"
    assert count_events() == 1


def test_ac5_entering_release_requested_stores_status_before_release() -> None:
    inst = create_instrument(institutionId=institution_id("inst1@demo.in"))
    for s in ("SUBMITTED", "UNDER_SCRUTINY", "ACTIVE", "EXPIRING"):
        move(inst["id"], s)  # type: ignore[arg-type]
    assert _status(inst["id"])["statusBeforeRelease"] is None
    move(inst["id"], "RELEASE_REQUESTED")
    after = _status(inst["id"])
    assert after["status"] == "RELEASE_REQUESTED" and after["statusBeforeRelease"] == "EXPIRING"
    assert after["version"] == 6
    # Restoring keeps the column (later phases read it); the next request overwrites it.
    move(inst["id"], "EXPIRING")
    assert _status(inst["id"])["statusBeforeRelease"] == "EXPIRING"
    assert count_events("action LIKE 'STATUS_%'") == 6
