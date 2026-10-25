from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.responses import Response

from ..domain.access import AuthUser
from ..middleware.auth import ALL_ROLES, require_role
from ..middleware.responses import json_response
from ..services.instrument_service import get_meta

router = APIRouter()


@router.get("/meta")
def meta(user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    return json_response(get_meta())
