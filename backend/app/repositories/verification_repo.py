from __future__ import annotations

from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, many, one
from ..domain.canonical_json import js_json
from ..shared_constants import VerificationResult


class VerificationRow(TypedDict):
    id: str
    instrumentId: str
    source: str
    requestPayload: object
    responsePayload: object
    result: VerificationResult
    requestedBy: str
    requestedByName: str | None
    requestedAt: datetime
    respondedAt: datetime | None


class NewVerification(TypedDict):
    instrumentId: str
    source: str
    requestPayload: object
    responsePayload: object
    result: VerificationResult
    requestedBy: str
    requestedAt: datetime
    respondedAt: datetime | None


def insert_verification(db: Db, v: NewVerification) -> str:
    row = one(
        db,
        """INSERT INTO verifications (instrument_id, source, request_payload, response_payload, result, requested_by,
                                  requested_at, responded_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8) RETURNING id""",
        [
            v["instrumentId"], v["source"], js_json(v["requestPayload"]),
            None if v["responsePayload"] is None else js_json(v["responsePayload"]), v["result"], v["requestedBy"],
            v["requestedAt"], v["respondedAt"],
        ],
    )  # fmt: skip
    return str(row["id"])


def list_verifications(db: Db, instrument_id: str) -> list[VerificationRow]:
    """Newest first."""
    rows = many(
        db,
        """SELECT v.id, v.instrument_id AS "instrumentId", v.source, v.request_payload AS "requestPayload",
            v.response_payload AS "responsePayload", v.result, v.requested_by AS "requestedBy",
            u.name AS "requestedByName", v.requested_at AS "requestedAt", v.responded_at AS "respondedAt"
       FROM verifications v LEFT JOIN users u ON u.id = v.requested_by
      WHERE v.instrument_id = $1 ORDER BY v.requested_at DESC, v.id""",
        [instrument_id],
    )
    return cast(list[VerificationRow], rows)
