from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from ..domain.access import AuthUser
from ..domain.errors import NotFound
from ..middleware.auth import ALL_ROLES, UUID, require_role
from ..middleware.responses import json_response
from ..middleware.validate import parse, query_dict
from ..schemas import DashboardQuery, InstitutionListQuery, ReportQuery
from ..services import dashboard_service, institution_service, metrics_service, myday_service, report_service
from ..shared_constants import Role
from .instruments import content_disposition

router = APIRouter()

INTERNAL: tuple[Role, ...] = ("officer", "approver", "admin", "auditor")


def _csv(filename: str, text: str) -> Response:
    return Response(
        text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition("attachment", filename), "Cache-Control": "no-store"},
    )


@router.get("/dashboard")
def dashboard(request: Request, user: AuthUser = Depends(require_role(*INTERNAL))) -> Response:
    return json_response(dashboard_service.get_dashboard(parse(DashboardQuery, query_dict(request), "query")))


@router.get("/myday")
def my_day(user: AuthUser = Depends(require_role("officer", "approver", "admin"))) -> Response:
    return json_response(myday_service.my_day(user))


@router.get("/institutions")
def institutions(request: Request, user: AuthUser = Depends(require_role(*INTERNAL))) -> Response:
    q = parse(InstitutionListQuery, query_dict(request), "query")
    return json_response(institution_service.list_institutions(q))


@router.get("/institutions/{institution_id}")
def institution(institution_id: str, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    if not UUID.match(institution_id):
        raise NotFound("Institution not found")
    return json_response(institution_service.get_profile(user, institution_id))


@router.get("/metrics/improvement")
def improvement(request: Request, user: AuthUser = Depends(require_role(*INTERNAL))) -> Response:
    if query_dict(request).get("format") == "csv":
        return _csv(*metrics_service.improvement_csv(user))
    return json_response(metrics_service.improvement())


@router.get("/reports/{preset}")
def report(preset: str, request: Request, user: AuthUser = Depends(require_role(*INTERNAL))) -> Response:
    q = parse(ReportQuery, query_dict(request), "query")
    if q.format == "csv":
        return _csv(*report_service.export_csv(user, preset, q))
    return json_response(report_service.build_report(preset, q))
