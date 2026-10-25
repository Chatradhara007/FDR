from __future__ import annotations

from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, exec_, many, maybe_one, one
from ..shared_constants import DocType


class DocumentRow(TypedDict):
    """API shape plus storagePath (never sent to clients)."""

    id: str
    instrumentId: str
    docType: DocType
    filename: str
    storagePath: str
    mimeType: str
    sizeBytes: int
    sha256: str
    uploadedBy: str
    uploadedAt: datetime


COLUMNS = """
  d.id, d.instrument_id AS "instrumentId", d.doc_type AS "docType", d.filename, d.storage_path AS "storagePath",
  d.mime_type AS "mimeType", d.size_bytes AS "sizeBytes", d.sha256, d.uploaded_by AS "uploadedBy",
  d.uploaded_at AS "uploadedAt\""""


class NewDocument(TypedDict):
    instrumentId: str
    docType: str
    filename: str
    storagePath: str
    mimeType: str
    sizeBytes: int
    sha256: str
    uploadedBy: str
    uploadedAt: datetime


def insert_document(db: Db, d: NewDocument) -> DocumentRow:
    row = one(
        db,
        f"""WITH ins AS (
       INSERT INTO documents (instrument_id, doc_type, filename, storage_path, mime_type, size_bytes, sha256, uploaded_by, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *)
     SELECT {COLUMNS} FROM ins d""",
        [
            d["instrumentId"], d["docType"], d["filename"], d["storagePath"], d["mimeType"], d["sizeBytes"],
            d["sha256"], d["uploadedBy"], d["uploadedAt"],
        ],
    )  # fmt: skip
    return cast(DocumentRow, row)


def list_live_documents(db: Db, instrument_id: str) -> list[DocumentRow]:
    rows = many(
        db,
        f"SELECT {COLUMNS} FROM documents d WHERE d.instrument_id = $1 AND d.deleted_at IS NULL"
        " ORDER BY d.uploaded_at, d.id",
        [instrument_id],
    )
    return cast(list[DocumentRow], rows)


def find_live_document(db: Db, instrument_id: str, doc_id: str) -> DocumentRow | None:
    """A live (not deleted) document of this instrument."""
    row = maybe_one(
        db,
        f"SELECT {COLUMNS} FROM documents d WHERE d.id = $1 AND d.instrument_id = $2 AND d.deleted_at IS NULL",
        [doc_id, instrument_id],
    )
    return cast(DocumentRow | None, row)


def find_live_by_checksum(db: Db, instrument_id: str, sha256: str) -> DocumentRow | None:
    row = maybe_one(
        db,
        f"""SELECT {COLUMNS} FROM documents d
      WHERE d.instrument_id = $1 AND d.sha256 = $2 AND d.deleted_at IS NULL ORDER BY d.uploaded_at, d.id LIMIT 1""",
        [instrument_id, sha256],
    )
    return cast(DocumentRow | None, row)


def soft_delete_document(db: Db, doc_id: str, by: str, at: datetime) -> None:
    exec_(
        db,
        "UPDATE documents SET deleted_at = $2, deleted_by = $3 WHERE id = $1 AND deleted_at IS NULL",
        [doc_id, at, by],
    )
