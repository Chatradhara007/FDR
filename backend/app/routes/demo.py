from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.responses import Response

from ..domain.access import AuthUser
from ..middleware.auth import require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse
from ..schemas import BankCorrectionInput, TamperInput
from ..services import audit_service, auth_service, demo_service
from .instruments import content_disposition

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


@router.post("/demo/reset")
def reset(user: AuthUser = Depends(require_role("admin"))) -> Response:
    """Wipes and re-seeds the demo dataset (docs/seed-spec.md); the clock ends SIMULATED at today's date.
    409 while the evaluation job or another reset is running."""
    return json_response(demo_service.reset(user))


@router.post("/demo/bank-correction")
def bank_correction(user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)) -> Response:
    """Changes one mock bank record (the bank corrected it after the institution's representation; demo step 7)."""
    return json_response(demo_service.bank_correction(user, parse(BankCorrectionInput, body)))


@router.get("/demo/anchors")
def anchors(user: AuthUser = Depends(require_role("admin"))) -> Response:
    return json_response(demo_service.anchors())


@router.get("/demo/files/{name}")
def sample_file(name: str, user: AuthUser = Depends(require_role("admin"))) -> Response:
    """Demo step 1's sample PDFs (A1's FDR copy and bank letter, with today's seeded dates)."""
    content, filename = demo_service.sample_file(name)
    return Response(
        content,
        media_type="application/pdf",
        headers={"Content-Disposition": content_disposition("attachment", filename), "Cache-Control": "no-store"},
    )
