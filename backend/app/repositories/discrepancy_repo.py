from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict, cast

from ..db.pool import Db, many, maybe_one, one
from ..shared_constants import TrackedField


class DiscrepancyRow(TypedDict):
    id: str
    instrumentId: str
    verificationId: str | None
    fieldName: TrackedField
    claimedValue: str
    confirmedValue: str | None
    reason: str
    status: Literal["OPEN", "RESOLVED"]
    resolutionNote: str | None
    resolvedBy: str | None
    resolvedByName: str | None
    createdAt: datetime
    resolvedAt: datetime | None


COLUMNS = """
  d.id, d.instrument_id AS "instrumentId", d.verification_id AS "verificationId", d.field_name AS "fieldName",
  d.claimed_value AS "claimedValue", d.confirmed_value AS "confirmedValue", d.reason, d.status,
  d.resolution_note AS "resolutionNote", d.resolved_by AS "resolvedBy",
  (SELECT name FROM users WHERE id = d.resolved_by) AS "resolvedByName",
  d.created_at AS "createdAt", d.resolved_at AS "resolvedAt\""""


def list_discrepancies(db: Db, instrument_id: str, open_only: bool = False) -> list[DiscrepancyRow]:
    """Open ones first, then newest first."""
    rows = many(
        db,
        f"""SELECT {COLUMNS} FROM discrepancies d
      WHERE d.instrument_id = $1 AND (NOT $2 OR d.status = 'OPEN')
      ORDER BY (d.status = 'OPEN') DESC, d.created_at DESC, d.id""",
        [instrument_id, open_only],
    )
    return cast(list[DiscrepancyRow], rows)


def open_discrepancy(
    db: Db,
    instrument_id: str,
    verification_id: str | None,
    field_name: TrackedField,
    claimed: str,
    confirmed: str | None,
    reason: str,
    at: datetime,
) -> str | None:
    """Inserts an OPEN discrepancy unless one is already open for that field (returns None then)."""
    row = maybe_one(
        db,
        """INSERT INTO discrepancies (instrument_id, verification_id, field_name, claimed_value, confirmed_value, reason,
                                  created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (instrument_id, field_name) WHERE status = 'OPEN' DO NOTHING
     RETURNING id""",
        [instrument_id, verification_id, field_name, claimed, confirmed, reason, at],
    )
    return None if row is None else str(row["id"])


def lock_discrepancy(db: Db, discrepancy_id: str) -> DiscrepancyRow:
    return cast(
        DiscrepancyRow,
        one(
            db,
            f"SELECT {COLUMNS} FROM discrepancies d WHERE d.id = $1 FOR UPDATE",
            [discrepancy_id],
            "Discrepancy not found",
        ),
    )


def resolve_discrepancy(db: Db, discrepancy_id: str, note: str, by: str, at: datetime) -> None:
    one(
        db,
        """UPDATE discrepancies SET resolution_note = $2, resolved_by = $3, resolved_at = $4, status = 'RESOLVED'
      WHERE id = $1 AND status = 'OPEN' RETURNING id""",
        [discrepancy_id, note, by, at],
        "Discrepancy not found",
    )
