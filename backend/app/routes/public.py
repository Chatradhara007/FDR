"""The only unauthenticated routes besides health, login and the demo user list (allow-listed in
test_phase08_security.py on purpose). Read-only, minimal output, rate-limited."""

from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.responses import Response

from ..domain.errors import TooManyRequests
from ..middleware.rate_limit import RateLimiter
from ..middleware.responses import json_response
from ..services import verify_service


def public_router() -> APIRouter:
    """A new router (and limiter) per app instance, so tests don't share counts."""
    router = APIRouter()
    limiter = RateLimiter(limit=30, window_seconds=60)  # per IP (wall time, like the sign-in limiter)

    @router.get("/verify/release/{order_no:path}")
    def verify_release(order_no: str, request: Request) -> Response:
        ip = request.client.host if request.client else ""
        allowed, headers = limiter.hit(ip)
        if not allowed:
            raise TooManyRequests("Too many lookups. Wait a minute and try again.", headers)
        return json_response(
            verify_service.verify_release_order(order_no), headers={**headers, "Cache-Control": "no-store"}
        )

    return router
