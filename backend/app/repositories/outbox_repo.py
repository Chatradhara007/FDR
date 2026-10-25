from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, exec_, many
from ..domain.canonical_json import js_json
from ..shared_constants import Role


class NewOutboxMessage(TypedDict):
    alert_id: str
    to_role: Role
    to_user_id: str | None
    to_institution_id: str | None
    subject: str
    body: str
    created_at: str


def insert_outbox(db: Db, messages: Sequence[NewOutboxMessage]) -> None:
    if not messages:
        return
    exec_(
        db,
        """INSERT INTO outbox (alert_id, to_role, to_user_id, to_institution_id, subject, body, created_at)
     SELECT r.alert_id, r.to_role::user_role, r.to_user_id, r.to_institution_id, r.subject, r.body, r.created_at
       FROM jsonb_to_recordset($1::jsonb) AS r(
              alert_id uuid, to_role text, to_user_id uuid, to_institution_id uuid, subject text, body text,
              created_at timestamptz)""",
        [js_json(list(messages))],
    )


class OutboxItem(TypedDict):
    id: int
    alertId: str | None
    toRole: Role | None
    toUserId: str | None
    toUserName: str | None
    toInstitutionId: str | None
    toInstitutionName: str | None
    subject: str
    body: str
    createdAt: datetime


def list_outbox(db: Db, page: int, page_size: int) -> tuple[list[OutboxItem], int]:
    rows = many(
        db,
        """SELECT o.id, o.alert_id AS "alertId", o.to_role AS "toRole", o.to_user_id AS "toUserId", u.name AS "toUserName",
            o.to_institution_id AS "toInstitutionId", inst.name AS "toInstitutionName", o.subject, o.body,
            o.created_at AS "createdAt", count(*) OVER () AS total
       FROM outbox o
       LEFT JOIN users u ON u.id = o.to_user_id
       LEFT JOIN institutions inst ON inst.id = o.to_institution_id
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $1 OFFSET $2""",
        [page_size, (page - 1) * page_size],
    )
    total = int(rows[0]["total"]) if rows else 0
    return [cast(OutboxItem, {k: v for k, v in r.items() if k != "total"}) for r in rows], total
