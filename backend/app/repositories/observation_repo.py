from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict, cast

from ..db.pool import Db, many, one
from ..shared_constants import ObservationSeverity


class ObservationRow(TypedDict):
    id: str
    instrumentId: str
    authorId: str | None
    authorName: str | None
    text: str
    severity: ObservationSeverity
    visibleToInstitution: bool
    status: Literal["OPEN", "RESOLVED"]
    resolutionNote: str | None
    resolvedBy: str | None
    createdAt: datetime
    resolvedAt: datetime | None


COLUMNS = """
  o.id, o.instrument_id AS "instrumentId", o.author_id AS "authorId",
  (SELECT name FROM users WHERE id = o.author_id) AS "authorName", o.text, o.severity,
  o.visible_to_institution AS "visibleToInstitution", o.status, o.resolution_note AS "resolutionNote",
  o.resolved_by AS "resolvedBy", o.created_at AS "createdAt", o.resolved_at AS "resolvedAt\""""


def list_observations(db: Db, instrument_id: str, visible_only: bool = False) -> list[ObservationRow]:
    """Open ones first, then newest first; `visible_only` keeps those shown to the institution (D24)."""
    rows = many(
        db,
        f"""SELECT {COLUMNS} FROM observations o
      WHERE o.instrument_id = $1 AND (NOT $2 OR o.visible_to_institution)
      ORDER BY (o.status = 'OPEN') DESC, o.created_at DESC, o.id""",
        [instrument_id, visible_only],
    )
    return cast(list[ObservationRow], rows)


def insert_observation(
    db: Db,
    instrument_id: str,
    author_id: str | None,
    text: str,
    severity: ObservationSeverity,
    visible: bool,
    at: datetime,
) -> ObservationRow:
    row = one(
        db,
        f"""WITH ins AS (
       INSERT INTO observations (instrument_id, author_id, text, severity, visible_to_institution, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *)
     SELECT {COLUMNS} FROM ins o""",
        [instrument_id, author_id, text, severity, visible, at],
    )
    return cast(ObservationRow, row)


def lock_observation(db: Db, observation_id: str) -> ObservationRow:
    return cast(
        ObservationRow,
        one(
            db,
            f"SELECT {COLUMNS} FROM observations o WHERE o.id = $1 FOR UPDATE",
            [observation_id],
            "Observation not found",
        ),
    )


def resolve_observation(db: Db, observation_id: str, note: str, by: str, at: datetime) -> None:
    one(
        db,
        """UPDATE observations SET resolution_note = $2, resolved_by = $3, resolved_at = $4, status = 'RESOLVED'
      WHERE id = $1 AND status = 'OPEN' RETURNING id""",
        [observation_id, note, by, at],
        "Observation not found",
    )
