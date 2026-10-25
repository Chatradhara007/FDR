"""Alerts inbox, bell summary, acknowledge / manual resolve, outbox, and on-demand evaluation (Phase 04)."""

from __future__ import annotations

from typing import TypedDict

from ..db.pool import get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of, scope_alerts_query
from ..domain.audit import record_event
from ..domain.errors import Forbidden, InvalidState, NotFound
from ..jobs.evaluate import Summary, evaluate
from ..repositories.alert_repo import (
    AlertFilters,
    AlertItem,
    acknowledge_alert,
    alert_summary,
    find_alert,
    list_alerts,
    lock_alert,
    resolve_alert_manually,
)
from ..repositories.outbox_repo import OutboxItem, list_outbox
from ..schemas import AlertListQuery, PageQuery
from ..shared_constants import ALERT_KINDS, AlertKind, AlertStatus, Role

# Who may close an alert by hand (with a note). Institutions and auditors may not.
RESOLVERS: tuple[Role, ...] = ("officer", "approver", "admin")


class AlertListResponse(TypedDict):
    items: list[AlertItem]
    total: int
    page: int
    pageSize: int


class AlertSummary(TypedDict):
    total: int
    byKind: dict[AlertKind, int]
    byLevel: dict[str, int]


class OutboxResponse(TypedDict):
    items: list[OutboxItem]
    total: int
    page: int
    pageSize: int


def _statuses(q: AlertListQuery) -> list[AlertStatus] | None:
    if q.status == "all":
        return None
    if q.status == "open":
        return ["OPEN", "ACKNOWLEDGED"]
    return [q.status]


def list_for(user: AuthUser, q: AlertListQuery) -> AlertListResponse:
    db = get_pool()
    filters: AlertFilters = {
        "statuses": _statuses(q),
        "kind": q.kind,
        "instrumentId": q.instrument_id,
        "mineUserId": user.id if q.mine else None,
        "level": q.level,
        "page": q.page,
        "pageSize": q.page_size,
    }
    items, total = list_alerts(db, filters, clock.today(db), lambda p: scope_alerts_query(user, p))
    return {"items": items, "total": total, "page": q.page, "pageSize": q.page_size}


def summary_for(user: AuthUser) -> AlertSummary:
    rows = alert_summary(get_pool(), lambda p: scope_alerts_query(user, p))
    by_kind: dict[AlertKind, int] = dict.fromkeys(ALERT_KINDS, 0)
    by_level: dict[str, int] = {}
    for r in rows:
        by_kind[r["kind"]] += r["n"]
        by_level[str(r["level"])] = by_level.get(str(r["level"]), 0) + r["n"]
    return {"total": sum(r["n"] for r in rows), "byKind": by_kind, "byLevel": by_level}


def _visible(user: AuthUser, alert_id: str) -> AlertItem:
    """Alerts not addressed to the user are reported as not found (rule 8)."""
    db = get_pool()
    alert = find_alert(db, alert_id, clock.today(db), lambda p: scope_alerts_query(user, p))
    if alert is None:
        raise NotFound("Alert not found")
    return alert


def acknowledge(user: AuthUser, alert_id: str) -> AlertItem:
    """Marks the alert as seen. Deliberately does not stop escalation: only fixing the cause or a manual resolution does."""
    if user.role == "auditor":
        raise Forbidden()
    alert = _visible(user, alert_id)
    with transaction() as tx:
        status = lock_alert(tx, alert_id)
        if status == "ACKNOWLEDGED":
            return _visible(user, alert_id)
        if status != "OPEN":
            raise InvalidState("Only an open alert can be acknowledged")
        acknowledge_alert(tx, alert_id, user.id, clock.now(tx))
        record_event(tx, actor=actor_of(user), action="ALERT_ACKNOWLEDGED", entity_type="alert", entity_id=alert_id,
                     instrument_id=alert["instrumentId"], before={"status": status},
                     after={"status": "ACKNOWLEDGED"})  # fmt: skip
    return _visible(user, alert_id)


def resolve(user: AuthUser, alert_id: str, note: str) -> AlertItem:
    if user.role not in RESOLVERS:
        raise Forbidden()
    alert = _visible(user, alert_id)
    with transaction() as tx:
        status = lock_alert(tx, alert_id)
        if status == "RESOLVED":
            raise InvalidState("This alert is already resolved")
        resolve_alert_manually(tx, alert_id, user.id, note, clock.now(tx))
        record_event(tx, actor=actor_of(user), action="ALERT_RESOLVED", entity_type="alert", entity_id=alert_id,
                     instrument_id=alert["instrumentId"], before={"status": status},
                     after={"status": "RESOLVED", "resolution": "MANUAL", "note": note})  # fmt: skip
    return _visible(user, alert_id)


def outbox(q: PageQuery) -> OutboxResponse:
    items, total = list_outbox(get_pool(), q.page, q.page_size)
    return {"items": items, "total": total, "page": q.page, "pageSize": q.page_size}


def run_evaluation() -> Summary:
    with transaction() as tx:
        return evaluate(tx, clock.today(tx))
