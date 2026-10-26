"""Audit trail, integrity check, document access log and the demo tamper tool (Phase 8 §8.3)."""

from __future__ import annotations

import time
from decimal import Decimal, InvalidOperation
from typing import TypedDict

from ..db.pool import Db, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser
from ..domain.audit import ChainCheck, verify_chain
from ..domain.canonical_json import iso_ms, js_json
from ..domain.errors import InvalidState, NotFound
from ..domain.event_labels import label_for
from ..repositories import event_repo
from ..repositories.event_repo import AuditEventRow, AuditFilter, EventRow
from ..schemas import AuditEventsQuery, TamperInput
from ..shared_constants import SIGN_IN_ACTIONS
from .report_service import Column, record_export, to_csv


class AuditEventView(TypedDict):
    id: int
    createdAt: str
    actorId: str | None
    actorLabel: str
    action: str
    label: str
    entityType: str
    entityId: str
    instrumentId: str | None
    referenceNo: str | None
    before: object
    after: object


class AuditPage(TypedDict):
    items: list[AuditEventView]
    total: int
    page: int
    pageSize: int


class Integrity(ChainCheck):
    verifiedAt: str


CSV_LIMIT = 10_000
INTEGRITY_TTL_SECONDS = 30
_integrity_cache: tuple[float, Integrity] | None = None


def _view(e: AuditEventRow) -> AuditEventView:
    return {
        "id": e["id"],
        "createdAt": iso_ms(e["created_at"]),
        "actorId": e["actor_id"],
        "actorLabel": e["actor_label"],
        "action": e["action"],
        "label": label_for(e["action"], e["before_json"], e["after_json"], e["actor_label"]),
        "entityType": e["entity_type"],
        "entityId": e["entity_id"],
        "instrumentId": e["instrument_id"],
        "referenceNo": e["referenceNo"],
        "before": e["before_json"],
        "after": e["after_json"],
    }


def _filter(q: AuditEventsQuery) -> AuditFilter:
    """`from` / `to` are business dates in IST, both inclusive."""
    return {
        "actorId": q.actor_id,
        "action": q.action,
        "entityType": q.entity_type,
        "instrumentId": q.instrument_id,
        "fromAt": clock.ist_start(q.from_) if q.from_ else None,
        "toAt": clock.ist_start(clock.add_days(q.to, 1)) if q.to else None,
        "q": q.q,
        # An explicit action filter wins over hiding sign-ins.
        "excludeActions": None if q.include_sign_ins or q.action or q.event_id else list(SIGN_IN_ACTIONS),
        "eventId": q.event_id,
    }


def list_events(q: AuditEventsQuery) -> AuditPage:
    db = get_pool()
    f = _filter(q)
    rows = event_repo.list_audit_events(db, f, q.page_size, (q.page - 1) * q.page_size)
    return {"items": [_view(r) for r in rows], "total": event_repo.count_audit_events(db, f), "page": q.page,
            "pageSize": q.page_size}  # fmt: skip


CSV_COLUMNS: list[Column] = [
    {"key": "id", "label": "Event #", "kind": "text"},
    {"key": "createdAt", "label": "Time (UTC)", "kind": "text"},
    {"key": "actorLabel", "label": "Actor", "kind": "text"},
    {"key": "action", "label": "Action", "kind": "text"},
    {"key": "label", "label": "Description", "kind": "text"},
    {"key": "entityType", "label": "Entity type", "kind": "text"},
    {"key": "entityId", "label": "Entity id", "kind": "text"},
    {"key": "referenceNo", "label": "Instrument reference", "kind": "text"},
    {"key": "before", "label": "Before", "kind": "text"},
    {"key": "after", "label": "After", "kind": "text"},
]


def export_csv(user: AuthUser, q: AuditEventsQuery) -> tuple[str, str]:
    """(filename, CSV text) of up to 10,000 matching events, newest first; the export itself is REPORT_EXPORTED."""
    db = get_pool()
    f = _filter(q)
    rows = [_view(r) for r in event_repo.list_audit_events(db, f, CSV_LIMIT, 0)]
    cells = [
        {**r, "before": None if r["before"] is None else js_json(r["before"]),
         "after": None if r["after"] is None else js_json(r["after"])}
        for r in rows
    ]  # fmt: skip
    filters = {
        k: v
        for k, v in q.model_dump(by_alias=True).items()
        if v is not None and k not in ("page", "pageSize", "format")
    }
    record_export(user, "audit-log", filters, len(rows))
    return f"fdr-audit-log-{clock.today(db)}.csv", to_csv(CSV_COLUMNS, cells)


def integrity(fresh: bool) -> Integrity:
    """verify_chain, cached for 30 s of wall time (an infrastructure cache, not business time)."""
    global _integrity_cache
    now = time.monotonic()
    if not fresh and _integrity_cache and now - _integrity_cache[0] < INTEGRITY_TTL_SECONDS:
        return _integrity_cache[1]
    db = get_pool()
    result: Integrity = {**verify_chain(db), "verifiedAt": iso_ms(clock.now(db))}
    _integrity_cache = (now, result)
    return result


def clear_integrity_cache() -> None:
    global _integrity_cache
    _integrity_cache = None


class DocumentAccessView(TypedDict):
    id: int
    createdAt: str
    actorId: str | None
    actorLabel: str
    documentId: str
    instrumentId: str | None
    referenceNo: str | None
    filename: str | None
    docType: str | None
    mode: str | None
    role: str | None


def document_access(instrument_id: str | None) -> list[DocumentAccessView]:
    rows = event_repo.list_document_access(get_pool(), instrument_id, 500)
    return [{**r, "createdAt": iso_ms(r["createdAt"])} for r in rows]


# ---- Demo tamper tool (D17; the demo router is mounted only when DEMO_MODE=true) ----------------------------------


def _tampered(after: object) -> object:
    """A plausible forgery: the amount raised by ₹10 lakh when there is one, else an extra key."""
    if isinstance(after, dict):
        amount = after.get("amount")
        if isinstance(amount, str):
            try:
                return {**after, "amount": f"{Decimal(amount) + Decimal('1000000'):.2f}"}
            except InvalidOperation:
                pass
        return {**after, "tampered": True}
    return {"tampered": True}


def _target(db: Db, event_id: int | None) -> EventRow:
    if event_id is not None:
        found = event_repo.find_event(db, event_id)
        if found is None:
            raise NotFound("Event not found")
        return found
    target = event_repo.latest_event(db, "INSTRUMENT_SUBMITTED") or event_repo.latest_event(db, None)
    if target is None:
        raise InvalidState("The audit log is empty; there is nothing to tamper with")
    return target


class TamperResult(TypedDict):
    eventId: int


def tamper(data: TamperInput) -> TamperResult:
    """Rewrites one event's after_json without recomputing its hash, keeping the original so it can be undone."""
    with transaction() as tx:
        target = _target(tx, data.event_id)
        event_repo.tamper_event(tx, target["id"], target["after_json"], _tampered(target["after_json"]), clock.now(tx))
    clear_integrity_cache()
    return {"eventId": target["id"]}


class UndoResult(TypedDict):
    restored: list[int]


def undo_tamper() -> UndoResult:
    with transaction() as tx:
        restored = event_repo.undo_tampers(tx)
    if not restored:
        raise InvalidState("No tampered event to restore")
    clear_integrity_cache()
    return {"restored": restored}
