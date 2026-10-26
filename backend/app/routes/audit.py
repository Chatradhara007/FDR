"""Audit trail, integrity check and document access log (Phase 8 §8.3). Read-only: admin and auditor."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from ..domain.access import AuthUser
from ..middleware.auth import require_role
from ..middleware.responses import json_response
from ..middleware.validate import parse, query_dict
from ..schemas import AuditEventsQuery, DocumentAccessQuery, IntegrityQuery
from ..services import audit_service
from ..shared_constants import Role
from .reporting import csv_response

router = APIRouter()

READERS: tuple[Role, ...] = ("admin", "auditor")


@router.get("/audit/events")
def events(request: Request, user: AuthUser = Depends(require_role(*READERS))) -> Response:
    q = parse(AuditEventsQuery, query_dict(request), "query")
    if q.format == "csv":
        return csv_response(*audit_service.export_csv(user, q))
    return json_response(audit_service.list_events(q))


@router.get("/audit/integrity")
def integrity(request: Request, user: AuthUser = Depends(require_role(*READERS))) -> Response:
    return json_response(audit_service.integrity(parse(IntegrityQuery, query_dict(request), "query").fresh))


@router.get("/audit/document-access")
def document_access(request: Request, user: AuthUser = Depends(require_role(*READERS))) -> Response:
    q = parse(DocumentAccessQuery, query_dict(request), "query")
    return json_response(audit_service.document_access(q.instrument_id))
