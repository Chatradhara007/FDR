"""Security headers (helmet's role for the API), request size limits and the request log (Phase 8 §8.4)."""

from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from ..domain.errors import AppError
from .errors import error_response

log = logging.getLogger("fdr.request")

JSON_BODY_LIMIT = 1024 * 1024
# The upload route enforces 10 MB on the file itself; the envelope allows for the multipart framing.
MULTIPART_BODY_LIMIT = 10 * 1024 * 1024 + 64 * 1024

# An API serves JSON and files only: nothing may run, load, frame or be framed. Document previews are opened as
# blob URLs created by the frontend (never embedded from the API), so no route needs a relaxed policy.
SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "X-DNS-Prefetch-Control": "off",
    "X-Permitted-Cross-Domain-Policies": "none",
}


class PayloadTooLarge(AppError):
    def __init__(self, limit: int) -> None:
        super().__init__(
            "PAYLOAD_TOO_LARGE", f"Request body is larger than {limit // (1024 * 1024)} MB", {"limit": limit}, 413
        )


def body_limit(content_type: str) -> int:
    return MULTIPART_BODY_LIMIT if content_type.startswith("multipart/") else JSON_BODY_LIMIT


class SecurityMiddleware(BaseHTTPMiddleware):
    """Outermost layer: refuses oversized bodies by Content-Length, adds the security headers to every response,
    and logs one line per request (method, path, status, ms, request id, user id) — never the query string,
    headers, bodies or tokens."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        started = time.perf_counter()
        response: Response
        length = request.headers.get("content-length")
        limit = body_limit(request.headers.get("content-type", ""))
        if length is not None and length.isdigit() and int(length) > limit:
            response = error_response(PayloadTooLarge(limit))
        else:
            response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        log.info(
            "%s %s %d %.0fms request=%s user=%s",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
            response.headers.get("X-Request-Id", "-"),
            getattr(request.state, "user_id", None) or "-",
        )
        return response
