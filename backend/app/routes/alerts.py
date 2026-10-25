from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from ..domain.access import AuthUser
from ..domain.errors import NotFound
from ..middleware.auth import ALL_ROLES, UUID, require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse, query_dict
from ..schemas import AlertListQuery, NoteInput, PageQuery
from ..services import alert_service

router = APIRouter()


def _check(alert_id: str) -> None:
    if not UUID.match(alert_id):
        raise NotFound("Alert not found")


@router.get("/alerts")
def list_alerts(request: Request, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    return json_response(alert_service.list_for(user, parse(AlertListQuery, query_dict(request), "query")))


@router.get("/alerts/summary")
def summary(user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    return json_response(alert_service.summary_for(user))


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: str, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    _check(alert_id)
    return json_response(alert_service.acknowledge(user, alert_id))


@router.post("/alerts/{alert_id}/resolve")
def resolve(
    alert_id: str, user: AuthUser = Depends(require_role(*alert_service.RESOLVERS)), body: object = Depends(json_body)
) -> Response:
    _check(alert_id)
    return json_response(alert_service.resolve(user, alert_id, parse(NoteInput, body).note))


@router.get("/outbox")
def outbox(request: Request, user: AuthUser = Depends(require_role("admin"))) -> Response:
    return json_response(alert_service.outbox(parse(PageQuery, query_dict(request), "query")))
