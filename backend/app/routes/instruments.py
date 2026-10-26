from __future__ import annotations

import os
import re
import tempfile
import uuid
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.responses import FileResponse, Response

from ..domain.access import AuthUser
from ..domain.errors import AppError, NotFound
from ..middleware.auth import ALL_ROLES, UUID, require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse, query_dict
from ..schemas import InstrumentCreate, InstrumentListQuery, InstrumentPatch
from ..services import document_service, instrument_service, passport_service, renewal_service
from ..services.document_service import IncomingFile
from ..services.submission import submit_instrument

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Uploads land in the OS temp dir under a random name; storage.py moves them (2.4).
UPLOAD_TMP = os.path.join(tempfile.gettempdir(), "fdr-uploads")


def check_ids(instrument_id: str, doc_id: str | None = None) -> None:
    """Malformed ids are simply "not found" (no hint whether the record exists)."""
    if not UUID.match(instrument_id):
        raise NotFound("Instrument not found")
    if doc_id is not None and not UUID.match(doc_id):
        raise NotFound("Document not found")


@router.get("/instruments")
def list_instruments(request: Request, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    q = parse(InstrumentListQuery, query_dict(request), "query")
    return json_response(instrument_service.list_instruments(user, q))


@router.post("/instruments")
def create(user: AuthUser = Depends(require_role("institution")), body: object = Depends(json_body)) -> Response:
    return json_response(instrument_service.create_draft(user, parse(InstrumentCreate, body)), 201)


@router.get("/instruments/{instrument_id}")
def get(instrument_id: str, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    check_ids(instrument_id)
    return json_response(instrument_service.get_instrument(user, instrument_id))


@router.patch("/instruments/{instrument_id}")
def edit(
    instrument_id: str, user: AuthUser = Depends(require_role("institution")), body: object = Depends(json_body)
) -> Response:
    check_ids(instrument_id)
    return json_response(instrument_service.edit_instrument(user, instrument_id, parse(InstrumentPatch, body)))


@router.delete("/instruments/{instrument_id}")
def delete(instrument_id: str, user: AuthUser = Depends(require_role("institution"))) -> Response:
    check_ids(instrument_id)
    instrument_service.delete_draft(user, instrument_id)
    return Response(status_code=204)


@router.post("/instruments/{instrument_id}/submit")
def submit(instrument_id: str, user: AuthUser = Depends(require_role("institution"))) -> Response:
    check_ids(instrument_id)
    return json_response(submit_instrument(user, instrument_id))


@router.post("/instruments/{instrument_id}/renew")
def renew(instrument_id: str, user: AuthUser = Depends(require_role("institution"))) -> Response:
    check_ids(instrument_id)
    return json_response(renewal_service.renew(user, instrument_id), 201)


@router.get("/instruments/{instrument_id}/passport")
def passport(instrument_id: str, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    check_ids(instrument_id)
    return json_response(passport_service.get_passport(user, instrument_id))


async def receive_file(upload: UploadFile) -> IncomingFile:
    """Copies the multipart file to a temp file, enforcing the 10 MB limit."""
    os.makedirs(UPLOAD_TMP, exist_ok=True)
    tmp_path = os.path.join(UPLOAD_TMP, uuid.uuid4().hex)
    size = 0
    with open(tmp_path, "wb") as out:
        while chunk := await upload.read(64 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                break
            out.write(chunk)
    if size > MAX_UPLOAD_BYTES:
        os.remove(tmp_path)
        raise AppError(
            "FILE_TOO_LARGE",
            "Files can be at most 10 MB",
            [{"field": "file", "message": "File is larger than 10 MB"}],
            422,
        )
    return IncomingFile(tmp_path, _multipart_filename(upload.filename or ""))


def _multipart_filename(name: str) -> str:
    """Browsers (WHATWG form encoding) send `"`, CR and LF in multipart filenames as %22, %0D and %0A."""
    return name.replace("%22", '"').replace("%0D", "\r").replace("%0A", "\n")


@router.post("/instruments/{instrument_id}/documents")
async def upload(
    instrument_id: str, request: Request, user: AuthUser = Depends(require_role("institution"))
) -> Response:
    check_ids(instrument_id)
    async with request.form(max_files=1, max_fields=5) as form:
        raw_file = form.get("file")
        file = await receive_file(raw_file) if isinstance(raw_file, UploadFile) else None
        doc_type = form.get("docType")
    result = await run_in_threadpool(document_service.upload_document, user, instrument_id, doc_type, file)
    return json_response(result, 201)


@router.delete("/instruments/{instrument_id}/documents/{doc_id}")
def remove_document(instrument_id: str, doc_id: str, user: AuthUser = Depends(require_role("institution"))) -> Response:
    check_ids(instrument_id, doc_id)
    document_service.remove_document(user, instrument_id, doc_id)
    return Response(status_code=204)


def content_disposition(kind: Literal["attachment", "inline"], filename: str) -> str:
    """RFC 6266: an ASCII fallback plus the UTF-8 name."""
    ascii_name = re.sub(r'["\\]', "_", re.sub(r"[^\x20-\x7e]", "_", filename))
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe="-_.!~*'()")}"


def _send_document(user: AuthUser, instrument_id: str, doc_id: str, kind: Literal["attachment", "inline"]) -> Response:
    check_ids(instrument_id, doc_id)
    doc = document_service.open_document(user, instrument_id, doc_id, "preview" if kind == "inline" else "download")
    return FileResponse(
        doc.path,
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": content_disposition(kind, doc.filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/instruments/{instrument_id}/documents/{doc_id}/download")
def download(instrument_id: str, doc_id: str, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    return _send_document(user, instrument_id, doc_id, "attachment")


@router.get("/instruments/{instrument_id}/documents/{doc_id}/preview")
def preview(instrument_id: str, doc_id: str, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    return _send_document(user, instrument_id, doc_id, "inline")
