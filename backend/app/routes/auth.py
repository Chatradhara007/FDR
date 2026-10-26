from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from ..domain.access import AuthUser
from ..domain.errors import TooManyRequests
from ..middleware.auth import ALL_ROLES, require_role
from ..middleware.rate_limit import RateLimiter
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse
from ..schemas import LoginInput
from ..services import auth_service


def auth_router() -> APIRouter:
    """A new router (and limiter) per app instance, so tests don't share attempt counts."""
    router = APIRouter()
    # 5 attempts per minute per IP + email (wall time: rate limiting is exempt from the app clock).
    limiter = RateLimiter(limit=5, window_seconds=60)

    @router.post("/auth/login")
    def login(request: Request, body: object = Depends(json_body)) -> Response:
        email = body.get("email") if isinstance(body, dict) else None
        ip = request.client.host if request.client else ""
        allowed, headers = limiter.hit(f"{ip}|{str(email or '').strip().lower()}")
        if not allowed:
            raise TooManyRequests("Too many sign-in attempts. Wait a minute and try again.", headers)
        data = parse(LoginInput, body)
        return json_response(auth_service.login(data.email, data.password, ip), headers=headers)

    @router.get("/auth/me")
    def me(user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
        return json_response(auth_service.me(user.id))

    return router
