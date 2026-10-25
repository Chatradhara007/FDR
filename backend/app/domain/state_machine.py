"""The only place instruments.status changes (CLAUDE.md rule 4; guarded by test_phase01_source_guard.py)."""

from __future__ import annotations

from typing import TypedDict

from ..db.pool import Conn, exec_
from ..shared_constants import InstrumentStatus, can_transition
from . import clock
from .audit import Actor, record_event
from .errors import Conflict, InvalidTransition


class TransitionTarget(TypedDict):
    id: str
    status: InstrumentStatus


def transition(
    tx: Conn,
    inst: TransitionTarget,
    to: InstrumentStatus,
    actor: Actor,
    extra: dict[str, object] | None = None,
) -> None:
    from_status = inst["status"]
    if not can_transition(from_status, to):
        raise InvalidTransition(from_status, to)
    updated = exec_(
        tx,
        """UPDATE instruments
        SET status = $1::instrument_status,
            status_before_release = CASE WHEN $1::instrument_status = 'RELEASE_REQUESTED' THEN $3::instrument_status ELSE status_before_release END,
            version = version + 1,
            updated_at = $4
      WHERE id = $2 AND status = $3::instrument_status""",
        [to, inst["id"], from_status, clock.now(tx)],
    )
    if updated == 0:
        raise Conflict(
            "The instrument was changed by someone else; reload and try again",
            {"from": from_status, "to": to},
            "STATUS_CHANGED",
        )
    record_event(
        tx,
        actor=actor,
        action=f"STATUS_{to}",
        entity_type="instrument",
        entity_id=inst["id"],
        instrument_id=inst["id"],
        before={"status": from_status},
        after={"status": to, **(extra or {})},
    )
