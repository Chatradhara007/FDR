from __future__ import annotations

from collections.abc import Callable
from typing import Literal, NotRequired, TypedDict

from ..db.pool import Conn, Db, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of
from ..domain.audit import NIL_UUID, record_event
from ..domain.canonical_json import iso_ms
from ..jobs.evaluate import Summary, evaluate
from ..repositories.clock_repo import read_clock


class ClockState(TypedDict):
    mode: Literal["REAL", "SIMULATED"]
    now: str
    today: str
    warning: NotRequired[Literal["CLOCK_MOVED_BACKWARDS"]]


def _state(db: Db) -> ClockState:
    now = clock.now(db)
    return {"mode": clock.mode(db), "now": iso_ms(now), "today": clock.ist_date(now)}


class ClockChange(TypedDict):
    clock: ClockState
    summary: Summary


def get_clock() -> ClockState:
    return _state(get_pool())


def _change(
    user: AuthUser, action: str, apply: Callable[[Conn], None], extra: dict[str, object] | None = None
) -> ClockChange:
    """Locks the clock row, applies the change, writes the audit event, then runs the evaluation job for the new
    date in the same transaction (§4.4). Warns when the date moved back; alerts are never deleted."""
    with transaction() as tx:
        read_clock(tx, for_update=True)
        before = _state(tx)
        apply(tx)
        after = _state(tx)
        record_event(
            tx,
            actor=actor_of(user),
            action=action,
            entity_type="clock",
            entity_id=NIL_UUID,
            before=before,
            after={**after, **(extra or {})},
        )
        summary = evaluate(tx, after["today"])
    if after["today"] < before["today"]:
        return {"clock": {**after, "warning": "CLOCK_MOVED_BACKWARDS"}, "summary": summary}
    return {"clock": after, "summary": summary}


def advance(user: AuthUser, days: int) -> ClockChange:
    return _change(user, "CLOCK_ADVANCED", lambda tx: clock.advance_days(tx, days), {"days": days})


def set_date(user: AuthUser, day: str) -> ClockChange:
    return _change(user, "CLOCK_SET", lambda tx: clock.set_simulated(tx, day))


def reset(user: AuthUser) -> ClockChange:
    return _change(user, "CLOCK_RESET", clock.reset_to_real)
