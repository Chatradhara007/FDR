from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict, cast

from ..db.pool import get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of, assert_can_see
from ..domain.audit import record_event
from ..domain.errors import AppError, NotFound, ValidationFailed
from ..repositories.document_repo import (
    DocumentRow,
    find_live_by_checksum,
    find_live_document,
    insert_document,
    soft_delete_document,
)
from ..repositories.instrument_repo import find_instrument_by_id
from ..schemas import FieldIssue, doc_type_or_none
from . import storage
from .instrument_service import DocumentInfo, lock_own_editable


@dataclass(frozen=True)
class IncomingFile:
    path: str  # temp file written by the route
    originalname: str


class UploadResponse(TypedDict):
    document: DocumentInfo
    duplicateOf: str | None


def sanitize_filename(name: str) -> str:
    """Display-only name: no directories, control characters or quotes; never used in a storage path."""
    base = re.split(r"[\\/]", name)[-1]
    clean = re.sub(r"\s+", " ", re.sub(r'[\x00-\x1f\x7f"<>|:*?]', "", base)).strip()[:120]
    return clean or "document"


def _to_info(d: DocumentRow) -> DocumentInfo:
    return cast(DocumentInfo, {k: v for k, v in d.items() if k != "storagePath"})


def upload_document(
    user: AuthUser, instrument_id: str, raw_doc_type: object, file: IncomingFile | None
) -> UploadResponse:
    """2.4: detect the real type, store the file (outside the transaction), then record it under the
    instrument lock. Upload only in DRAFT/RETURNED. Same checksum -> accepted, `duplicateOf` set."""
    doc_type = doc_type_or_none(raw_doc_type)
    issues: list[FieldIssue] = []
    if file is None:
        issues.append({"field": "file", "message": "Choose a file to upload"})
    if doc_type is None:
        issues.append({"field": "docType", "message": "Choose a document type"})
    if file is None or doc_type is None:
        if file is not None:
            storage.remove_temp(file.path)
        raise ValidationFailed(issues)
    # Visibility first, so a stranger learns nothing and nothing is stored for them.
    try:
        inst = find_instrument_by_id(get_pool(), instrument_id)
        if inst is None:
            raise NotFound("Instrument not found")
        assert_can_see(user, inst["institutionId"])
    except Exception:
        storage.remove_temp(file.path)
        raise
    detected = storage.detect_file_type(file.path)
    if detected is None:
        storage.remove_temp(file.path)
        raise AppError(
            "UNSUPPORTED_FILE_TYPE",
            "Only PDF, PNG and JPEG files can be uploaded",
            [
                {
                    "field": "file",
                    "message": "This file is not a PDF, PNG or JPEG (checked from its contents, not its name)",
                }
            ],
            422,
        )
    stored = storage.save_upload(file.path, instrument_id, detected.ext)
    try:
        with transaction() as tx:
            lock_own_editable(tx, user, instrument_id, "changed")
            duplicate = find_live_by_checksum(tx, instrument_id, stored.sha256)
            doc = insert_document(
                tx,
                {
                    "instrumentId": instrument_id,
                    "docType": doc_type,
                    "filename": sanitize_filename(file.originalname),
                    "storagePath": stored.storage_path,
                    "mimeType": detected.mime,
                    "sizeBytes": stored.size,
                    "sha256": stored.sha256,
                    "uploadedBy": user.id,
                    "uploadedAt": clock.now(tx),
                },
            )
            record_event(
                tx,
                actor=actor_of(user),
                action="DOCUMENT_UPLOADED",
                entity_type="document",
                entity_id=doc["id"],
                instrument_id=instrument_id,
                after={
                    "docType": doc_type,
                    "filename": doc["filename"],
                    "sizeBytes": doc["sizeBytes"],
                    "sha256": doc["sha256"],
                    "duplicateOf": duplicate["id"] if duplicate else None,
                },
            )
    except BaseException:
        storage.discard_unrecorded(stored.storage_path)
        raise
    return {"document": _to_info(doc), "duplicateOf": duplicate["id"] if duplicate else None}


def remove_document(user: AuthUser, instrument_id: str, doc_id: str) -> None:
    """D15: soft delete while DRAFT/RETURNED; the file stays on disk as evidence."""
    with transaction() as tx:
        lock_own_editable(tx, user, instrument_id, "changed")
        doc = find_live_document(tx, instrument_id, doc_id)
        if doc is None:
            raise NotFound("Document not found")
        soft_delete_document(tx, doc_id, user.id, clock.now(tx))
        record_event(
            tx,
            actor=actor_of(user),
            action="DOCUMENT_REMOVED",
            entity_type="document",
            entity_id=doc_id,
            instrument_id=instrument_id,
            before={"docType": doc["docType"], "filename": doc["filename"], "sha256": doc["sha256"]},
        )


@dataclass(frozen=True)
class OpenedDocument:
    filename: str
    mime_type: str
    size_bytes: int
    path: Path


def open_document(
    user: AuthUser, instrument_id: str, doc_id: str, mode: Literal["download", "preview"]
) -> OpenedDocument:
    """Authorise, log DOCUMENT_ACCESSED, then hand back the file to stream (2.4)."""
    with transaction() as tx:
        inst = find_instrument_by_id(tx, instrument_id)
        if inst is None:
            raise NotFound("Instrument not found")
        assert_can_see(user, inst["institutionId"])
        doc = find_live_document(tx, instrument_id, doc_id)
        if doc is None:
            raise NotFound("Document not found")
        record_event(
            tx,
            actor=actor_of(user),
            action="DOCUMENT_ACCESSED",
            entity_type="document",
            entity_id=doc_id,
            instrument_id=instrument_id,
            after={"mode": mode, "role": user.role},
        )
    return OpenedDocument(doc["filename"], doc["mimeType"], doc["sizeBytes"], storage.path_for_read(doc["storagePath"]))
