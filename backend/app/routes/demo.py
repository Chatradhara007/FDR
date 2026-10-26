from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.responses import Response

from ..domain.access import AuthUser
from ..middleware.auth import require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse
from ..schemas import TamperInput
from ..services import audit_service, auth_service

# Mounted only when DEMO_MODE=true (D17); otherwise these paths fall through to 404.
router = APIRouter()


# Public by design: feeds the login page's "Sign in as" buttons.
@router.get("/demo/users")
def demo_users() -> Response:
    return json_response(auth_service.list_demo_users())


@router.post("/demo/tamper")
def tamper(user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)) -> Response:
    """Alters one event without recomputing its hash, so the integrity check can be shown catching it."""
    return json_response(audit_service.tamper(parse(TamperInput, body)))


@router.post("/demo/tamper/undo")
def undo_tamper(user: AuthUser = Depends(require_role("admin"))) -> Response:
    """Restores every tampered event's original data; the chain verifies again."""
    return json_response(audit_service.undo_tamper())
