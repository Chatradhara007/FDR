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


def next_event_slot(db: Db) -> tuple[int, str | None]:
    """The next event id and the chain's last hash in one round trip (call with the chain lock held)."""
    row = one(db, "SELECT nextval('events_id_seq') AS id, (SELECT hash FROM events ORDER BY id DESC LIMIT 1) AS hash")
    return cast(int, row["id"]), cast(str | None, row["hash"])


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


class AuditFilter(TypedDict):
    actorId: str | None
    action: str | None
    entityType: str | None
    instrumentId: str | None
    fromAt: datetime | None  # inclusive
    toAt: datetime | None  # exclusive
    q: str | None
    excludeActions: list[str] | None
    eventId: int | None


class AuditEventRow(EventRow):
    referenceNo: str | None


_AUDIT_WHERE = """
   WHERE ($1::uuid IS NULL OR e.actor_id = $1::uuid)
     AND ($2::text IS NULL OR e.action = $2)
     AND ($3::text IS NULL OR e.entity_type = $3)
     AND ($4::uuid IS NULL OR e.instrument_id = $4::uuid)
     AND ($5::timestamptz IS NULL OR e.created_at >= $5)
     AND ($6::timestamptz IS NULL OR e.created_at < $6)
     AND ($7::text IS NULL OR e.actor_label ILIKE $7 OR e.action ILIKE $7 OR e.entity_id::text ILIKE $7
          OR coalesce(e.before_json::text, '') ILIKE $7 OR coalesce(e.after_json::text, '') ILIKE $7
          OR coalesce(i.reference_no, '') ILIKE $7)
     AND ($8::text[] IS NULL OR NOT (e.action = ANY($8::text[])))
     AND ($9::bigint IS NULL OR e.id = $9::bigint)"""


def _like(q: str | None) -> str | None:
    if q is None:
        return None
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _audit_params(f: AuditFilter) -> list[object]:
    return [
        f["actorId"], f["action"], f["entityType"], f["instrumentId"], f["fromAt"], f["toAt"], _like(f["q"]),
        f["excludeActions"], f["eventId"],
    ]  # fmt: skip


def list_audit_events(db: Db, f: AuditFilter, limit: int, offset: int) -> list[AuditEventRow]:
    """Newest first, with the instrument's reference number when the event is about one."""
    return cast(
        list[AuditEventRow],
        many(
            db,
            f"""SELECT e.*, i.reference_no AS "referenceNo"
                 FROM events e LEFT JOIN instruments i ON i.id = e.instrument_id
                {_AUDIT_WHERE}
                ORDER BY e.id DESC LIMIT $10 OFFSET $11""",
            [*_audit_params(f), limit, offset],
        ),
    )


def count_audit_events(db: Db, f: AuditFilter) -> int:
    row = one(
        db,
        f"SELECT count(*)::int AS n FROM events e LEFT JOIN instruments i ON i.id = e.instrument_id {_AUDIT_WHERE}",
        _audit_params(f),
    )
    return cast(int, row["n"])


class DocumentAccessRow(TypedDict):
    id: int
    actorId: str | None
    actorLabel: str
    documentId: str
    instrumentId: str | None
    referenceNo: str | None
    filename: str | None
    docType: str | None
    mode: str | None
    role: str | None
    createdAt: datetime


def list_document_access(db: Db, instrument_id: str | None, limit: int) -> list[DocumentAccessRow]:
    return cast(
        list[DocumentAccessRow],
        many(
            db,
            """SELECT e.id, e.actor_id AS "actorId", e.actor_label AS "actorLabel", e.entity_id AS "documentId",
                    e.instrument_id AS "instrumentId", i.reference_no AS "referenceNo", d.filename,
                    d.doc_type AS "docType", e.after_json->>'mode' AS mode, e.after_json->>'role' AS role,
                    e.created_at AS "createdAt"
               FROM events e
               LEFT JOIN documents d ON d.id = e.entity_id
               LEFT JOIN instruments i ON i.id = e.instrument_id
              WHERE e.action = 'DOCUMENT_ACCESSED' AND ($1::uuid IS NULL OR e.instrument_id = $1::uuid)
              ORDER BY e.id DESC LIMIT $2""",
            [instrument_id, limit],
        ),
    )


# ---- Demo tamper tool (D17, DEMO_MODE only). The one sanctioned write to existing events: the append-only trigger
# lets it through only inside a transaction that sets fdr.allow_tamper. --------------------------------------------


def find_event(db: Db, event_id: int) -> EventRow | None:
    return cast(EventRow | None, maybe_one(db, "SELECT * FROM events WHERE id = $1", [event_id]))


def latest_event(db: Db, action: str | None) -> EventRow | None:
    return cast(
        EventRow | None,
        maybe_one(
            db, "SELECT * FROM events WHERE ($1::text IS NULL OR action = $1) ORDER BY id DESC LIMIT 1", [action]
        ),
    )


def _allow_tamper(tx: Db) -> None:
    exec_(tx, "SET LOCAL fdr.allow_tamper = 'on'")


def tamper_event(tx: Db, event_id: int, original_after: object, new_after: object, at: datetime) -> None:
    """Keeps the first original (tampering twice still undoes to the untouched value), then rewrites after_json."""
    exec_(
        tx,
        """INSERT INTO demo_tampers (event_id, original_after_json, tampered_at) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (event_id) DO NOTHING""",
        [event_id, None if original_after is None else js_json(original_after), at],
    )
    _allow_tamper(tx)
    exec_(tx, "UPDATE events SET after_json = $2::jsonb WHERE id = $1", [event_id, js_json(new_after)])


def undo_tampers(tx: Db) -> list[int]:
    """Restores every tampered event's original after_json; returns the restored ids."""
    rows = many(tx, "SELECT event_id, original_after_json FROM demo_tampers ORDER BY event_id FOR UPDATE")
    if not rows:
        return []
    _allow_tamper(tx)
    for r in rows:
        original = r["original_after_json"]
        exec_(
            tx,
            "UPDATE events SET after_json = $2::jsonb WHERE id = $1",
            [r["event_id"], None if original is None else js_json(original)],
        )
    exec_(tx, "DELETE FROM demo_tampers")
    return [cast(int, r["event_id"]) for r in rows]
