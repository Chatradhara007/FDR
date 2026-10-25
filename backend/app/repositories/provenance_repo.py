from __future__ import annotations

from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, exec_, many
from ..shared_constants import TrackedField, TrustTier


class ProvenanceRow(TypedDict):
    fieldName: TrackedField
    value: str
    tier: TrustTier
    source: str | None
    updatedAt: datetime


def list_provenance(db: Db, instrument_id: str) -> list[ProvenanceRow]:
    rows = many(
        db,
        """SELECT field_name AS "fieldName", value, tier, source, updated_at AS "updatedAt"
       FROM field_provenance WHERE instrument_id = $1 ORDER BY field_name""",
        [instrument_id],
    )
    return cast(list[ProvenanceRow], rows)


def upsert_provenance(
    db: Db, instrument_id: str, field_name: TrackedField, value: str, tier: TrustTier, source: str, at: datetime
) -> None:
    """Inserts or overwrites one field's provenance with the given value, tier and source."""
    exec_(
        db,
        """INSERT INTO field_provenance (instrument_id, field_name, value, tier, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (instrument_id, field_name)
     DO UPDATE SET value = EXCLUDED.value, tier = EXCLUDED.tier, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at""",
        [instrument_id, field_name, value, tier, source, at],
    )


def set_tier(db: Db, instrument_id: str, field_name: TrackedField, tier: TrustTier, source: str, at: datetime) -> None:
    """Changes the trust tier (and its source) of one field, keeping its value."""
    exec_(
        db,
        "UPDATE field_provenance SET tier = $3, source = $4, updated_at = $5 WHERE instrument_id = $1 AND field_name = $2",
        [instrument_id, field_name, tier, source, at],
    )
