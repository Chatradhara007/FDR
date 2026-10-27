"""SQL for advisory flags and document text findings. Advisory only: nothing here touches status or trust tiers."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict, cast

from ..db.pool import Db, exec_, many
from ..domain.canonical_json import js_json
from ..shared_constants import InstrumentStatus

FlagKind = Literal["DUPLICATE_REFERENCE", "HIGH_AMOUNT", "BENEFICIARY_NEAR_MISS"]


class FlagRow(TypedDict):
    id: str
    instrumentId: str
    kind: FlagKind
    reason: str
    detail: dict[str, object]
    createdAt: datetime


def open_flags(db: Db, instrument_id: str) -> list[FlagRow]:
    rows = many(
        db,
        """SELECT id, instrument_id AS "instrumentId", kind, reason, detail, created_at AS "createdAt"
       FROM advisory_flags WHERE instrument_id = $1 AND cleared_at IS NULL ORDER BY kind""",
        [instrument_id],
    )
    return cast(list[FlagRow], rows)


def clear_flags(db: Db, instrument_id: str, at: datetime) -> None:
    exec_(db, "UPDATE advisory_flags SET cleared_at = $2 WHERE instrument_id = $1 AND cleared_at IS NULL",
          [instrument_id, at])  # fmt: skip


def insert_flag(
    db: Db, instrument_id: str, kind: FlagKind, reason: str, detail: dict[str, object], at: datetime
) -> None:
    exec_(
        db,
        """INSERT INTO advisory_flags (instrument_id, kind, reason, detail, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)""",
        [instrument_id, kind, reason, js_json(detail), at],
    )


class OtherHolder(TypedDict):
    id: str
    institutionName: str
    status: InstrumentStatus


def same_reference_elsewhere(db: Db, bank: str, norm_reference: str, institution_id: str) -> list[OtherHolder]:
    """Submitted instruments of OTHER institutions with the same bank and (whitespace-free, upper-case) reference."""
    rows = many(
        db,
        """SELECT i.id, n.name AS "institutionName", i.status FROM instruments i
       JOIN institutions n ON n.id = i.institution_id
      WHERE i.issuing_bank = $1 AND regexp_replace(upper(i.reference_no), '\\s', '', 'g') = $2
        AND i.institution_id <> $3 AND i.status <> 'DRAFT'
      ORDER BY i.created_at""",
        [bank, norm_reference, institution_id],
    )
    return cast(list[OtherHolder], rows)


def earlier_amounts(db: Db, institution_id: str, exclude_id: str, created_at: datetime) -> list[str]:
    """Amounts of the institution's other submitted instruments that existed when this one was created: what it had
    lodged before. Judging against earlier history only keeps a flag the same however often it is recomputed (a later,
    larger deposit never changes the verdict on an earlier one). Instruments created at the same instant count."""
    rows = many(
        db,
        """SELECT amount FROM instruments
      WHERE institution_id = $1 AND id <> $2 AND status <> 'DRAFT' AND amount IS NOT NULL AND created_at <= $3""",
        [institution_id, exclude_id, created_at],
    )
    return [str(r["amount"]) for r in rows]


# ---- document findings ----


class FindingRow(TypedDict):
    id: str
    documentId: str
    instrumentId: str
    status: Literal["READ", "UNREADABLE"]
    reason: str | None
    extracted: dict[str, object]
    metadataSignal: dict[str, object] | None
    createdAt: datetime


def insert_finding(
    db: Db, document_id: str, instrument_id: str, status: str, reason: str | None, extracted: object,
    metadata: object, at: datetime,
) -> None:  # fmt: skip
    exec_(
        db,
        """INSERT INTO document_findings (document_id, instrument_id, status, reason, extracted, metadata_signal,
                                      created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)""",
        [document_id, instrument_id, status, reason, js_json(extracted),
         None if metadata is None else js_json(metadata), at],
    )  # fmt: skip


def findings_for_instrument(db: Db, instrument_id: str) -> list[FindingRow]:
    rows = many(
        db,
        """SELECT f.id, f.document_id AS "documentId", f.instrument_id AS "instrumentId", f.status, f.reason,
            f.extracted, f.metadata_signal AS "metadataSignal", f.created_at AS "createdAt"
       FROM document_findings f JOIN documents d ON d.id = f.document_id
      WHERE f.instrument_id = $1 AND d.deleted_at IS NULL ORDER BY d.uploaded_at, f.id""",
        [instrument_id],
    )
    return cast(list[FindingRow], rows)
