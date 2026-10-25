from __future__ import annotations

from collections.abc import Callable
from typing import Literal, NotRequired, TypedDict

from ..db.pool import Conn, Db, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of
from ..domain.audit import NIL_UUID, record_event
from ..domain.canonical_json import iso_ms
from ..repositories.clock_repo import read_clock


class ClockState(TypedDict):
    mode: Literal["REAL", "SIMULATED"]
    now: str
    today: str
    warning: NotRequired[Literal["CLOCK_MOVED_BACKWARDS"]]


def _state(db: Db) -> ClockState:
    now = clock.now(db)
    return {"mode": clock.mode(db), "now": iso_ms(now), "today": clock.ist_date(now)}


def get_clock() -> ClockState:
    return _state(get_pool())


def _change(
    user: AuthUser, action: str, apply: Callable[[Conn], None], extra: dict[str, object] | None = None
) -> ClockState:
    """Locks the clock row, applies the change, writes the audit event; warns when the date moved back."""
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
    if after["today"] < before["today"]:
        return {**after, "warning": "CLOCK_MOVED_BACKWARDS"}
    return after


def advance(user: AuthUser, days: int) -> ClockState:
    return _change(user, "CLOCK_ADVANCED", lambda tx: clock.advance_days(tx, days), {"days": days})


def set_date(user: AuthUser, day: str) -> ClockState:
    return _change(user, "CLOCK_SET", lambda tx: clock.set_simulated(tx, day))


def reset(user: AuthUser) -> ClockState:
    return _change(user, "CLOCK_RESET", clock.reset_to_real)
