from __future__ import annotations

from fastapi import APIRouter
from starlette.responses import Response

from ..middleware.responses import json_response
from ..services.health_service import get_health

# Public by design: used by the login screen, Docker and monitoring before anyone signs in.
router = APIRouter()


@router.get("/health")
def health() -> Response:
    return json_response(get_health())
