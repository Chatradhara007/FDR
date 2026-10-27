"""Hash-chained, append-only audit log (D16)."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TypedDict

from ..db.pool import Conn, Db
from ..repositories.event_repo import EventRow, events_after, insert_event, lock_chain, next_event_slot
from . import clock
from .canonical_json import canonical_json, iso_ms, to_json_value

NIL_UUID = "00000000-0000-0000-0000-000000000000"
CHAIN_LOCK = 7001


@dataclass(frozen=True)
class Actor:
    label: str
    id: str | None = None


SYSTEM_ACTOR = Actor(label="system")


def event_hash(prev_hash: str | None, e: Mapping[str, object]) -> str:
    created_at = e["created_at"]
    payload = canonical_json(
        {
            "id": e["id"],
            "actor_id": e["actor_id"],
            "actor_label": e["actor_label"],
            "action": e["action"],
            "entity_type": e["entity_type"],
            "entity_id": e["entity_id"],
            "instrument_id": e["instrument_id"],
            "before_json": e["before_json"],
            "after_json": e["after_json"],
            "created_at": created_at if isinstance(created_at, str) else iso_ms(created_at),  # type: ignore[arg-type]
        }
    )
    return hashlib.sha256(f"{prev_hash or 'GENESIS'}|{payload}".encode()).hexdigest()


def record_event(
    tx: Conn,
    *,
    actor: Actor,
    action: str,
    entity_type: str,
    entity_id: str,
    instrument_id: str | None = None,
    before: object = None,
    after: object = None,
) -> None:
    """Must run inside the caller's transaction: the advisory lock serialises the chain until commit."""
    lock_chain(tx, CHAIN_LOCK)
    event_id, prev = next_event_slot(tx)
    row: dict[str, object] = {
        "id": event_id,
        "actor_id": actor.id,
        "actor_label": actor.label,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "instrument_id": instrument_id,
        "before_json": to_json_value(before),
        "after_json": to_json_value(after),
        "created_at": clock.now(tx),
    }
    insert_event(tx, EventRow(**row, prev_hash=prev, hash=event_hash(prev, row)))  # type: ignore[typeddict-item]


class ChainCheck(TypedDict):
    ok: bool
    checked: int
    firstBrokenId: int | None


def verify_chain(db: Db) -> ChainCheck:
    """Recomputes every hash in id order; the first row whose link or hash does not match is reported."""
    prev: str | None = None
    after_id = 0
    checked = 0
    while True:
        rows = events_after(db, after_id, 1000)
        if not rows:
            return {"ok": True, "checked": checked, "firstBrokenId": None}
        for row in rows:
            checked += 1
            if row["prev_hash"] != prev or event_hash(prev, row) != row["hash"]:
                return {"ok": False, "checked": checked, "firstBrokenId": row["id"]}
            prev = row["hash"]
            after_id = row["id"]
