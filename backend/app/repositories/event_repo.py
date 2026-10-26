from __future__ import annotations

from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, exec_, many, maybe_one, one
from ..domain.canonical_json import js_json


class EventRow(TypedDict):
    id: int
    actor_id: str | None
    actor_label: str
    action: str
    entity_type: str
    entity_id: str
    instrument_id: str | None
    before_json: object
    after_json: object
    created_at: datetime
    prev_hash: str | None
    hash: str


def lock_chain(db: Db, key: int) -> None:
    many(db, "SELECT pg_advisory_xact_lock($1)", [key])


def last_hash(db: Db) -> str | None:
    row = maybe_one(db, "SELECT hash FROM events ORDER BY id DESC LIMIT 1")
    return cast(str, row["hash"]) if row else None


def next_event_id(db: Db) -> int:
    return cast(int, one(db, "SELECT nextval('events_id_seq') AS id")["id"])


def insert_event(db: Db, e: EventRow) -> None:
    """before_json / after_json are passed as JSON text (formatted exactly as JSON.stringify would)."""
    exec_(
        db,
        """INSERT INTO events (id, actor_id, actor_label, action, entity_type, entity_id, instrument_id,
                             before_json, after_json, created_at, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)""",
        [
            e["id"], e["actor_id"], e["actor_label"], e["action"], e["entity_type"], e["entity_id"], e["instrument_id"],
            None if e["before_json"] is None else js_json(e["before_json"]),
            None if e["after_json"] is None else js_json(e["after_json"]),
            e["created_at"], e["prev_hash"], e["hash"],
        ],
    )  # fmt: skip


def events_after(db: Db, after_id: int, limit: int) -> list[EventRow]:
    return cast(list[EventRow], many(db, "SELECT * FROM events WHERE id > $1 ORDER BY id LIMIT $2", [after_id, limit]))


def events_for_entity(db: Db, entity_type: str, entity_id: str) -> list[EventRow]:
    return cast(
        list[EventRow],
        many(
            db, "SELECT * FROM events WHERE entity_type = $1 AND entity_id = $2 ORDER BY id", [entity_type, entity_id]
        ),
    )


def events_for_instrument(db: Db, instrument_id: str, actions: list[str] | None = None) -> list[EventRow]:
    """Events about one instrument, newest first; `actions` limits them to a whitelist (D24)."""
    return cast(
        list[EventRow],
        many(
            db,
            """SELECT * FROM events WHERE instrument_id = $1 AND ($2::text[] IS NULL OR action = ANY($2::text[]))
          ORDER BY id DESC""",
            [instrument_id, actions],
        ),
    )
