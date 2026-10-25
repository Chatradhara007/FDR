from __future__ import annotations

from fastapi import APIRouter
from starlette.responses import Response

from ..middleware.responses import json_response
from ..services import auth_service

# Mounted only when DEMO_MODE=true (D17); otherwise these paths fall through to 404.
router = APIRouter()


# Public by design: feeds the login page's "Sign in as" buttons.
@router.get("/demo/users")
def demo_users() -> Response:
    return json_response(auth_service.list_demo_users())
