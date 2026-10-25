from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.responses import Response

from ..domain.access import AuthUser
from ..middleware.auth import require_role
from ..middleware.responses import json_response
from ..services import alert_service

router = APIRouter()


@router.post("/jobs/evaluate")
def evaluate(user: AuthUser = Depends(require_role("admin"))) -> Response:
    return json_response(alert_service.run_evaluation())
