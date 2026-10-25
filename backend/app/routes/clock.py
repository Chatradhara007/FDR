from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.responses import Response

from ..domain.access import AuthUser
from ..middleware.auth import ALL_ROLES, require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse
from ..schemas import ClockAdvanceInput, ClockSetInput
from ..services import clock_service

router = APIRouter()


@router.get("/clock")
def get_clock(user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    return json_response(clock_service.get_clock())


@router.post("/clock/advance")
def advance(user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)) -> Response:
    return json_response(clock_service.advance(user, parse(ClockAdvanceInput, body).days))


@router.post("/clock/set")
def set_date(user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)) -> Response:
    return json_response(clock_service.set_date(user, parse(ClockSetInput, body).date))


@router.post("/clock/reset")
def reset(user: AuthUser = Depends(require_role("admin"))) -> Response:
    return json_response(clock_service.reset(user))
