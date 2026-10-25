from __future__ import annotations

from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, many, one


class ReturnRow(TypedDict):
    id: str
    instrumentId: str
    officerId: str
    officerName: str | None
    reason: str
    createdAt: datetime


def insert_return(db: Db, instrument_id: str, officer_id: str, reason: str, at: datetime) -> str:
    row = one(
        db,
        "INSERT INTO returns (instrument_id, officer_id, reason, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [instrument_id, officer_id, reason, at],
    )
    return str(row["id"])


def list_returns(db: Db, instrument_id: str) -> list[ReturnRow]:
    """Newest first."""
    rows = many(
        db,
        """SELECT r.id, r.instrument_id AS "instrumentId", r.officer_id AS "officerId", u.name AS "officerName",
            r.reason, r.created_at AS "createdAt"
       FROM returns r LEFT JOIN users u ON u.id = r.officer_id
      WHERE r.instrument_id = $1 ORDER BY r.created_at DESC, r.id""",
        [instrument_id],
    )
    return cast(list[ReturnRow], rows)
