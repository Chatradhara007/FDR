"""Request ids, the `{ code, message, details }` error shape, and 404 for unknown routes."""

from __future__ import annotations

import logging
import re
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from ..domain.errors import AppError, NotFound, ValidationFailed
from .responses import json_response

log = logging.getLogger("fdr")

SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def error_response(err: AppError, request_id: str | None = None) -> Response:
    headers = dict(err.headers)
    if request_id:
        headers["X-Request-Id"] = request_id
    return json_response({"code": err.code, "message": err.message, "details": err.details}, err.http_status, headers)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assigns X-Request-Id and turns any unhandled exception into 500 INTERNAL (no internals leaked)."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id")
        request_id = incoming if incoming and SAFE_ID.match(incoming) else str(uuid.uuid4())
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception:
            log.exception("[%s] unhandled error on %s %s", request_id, request.method, request.url.path)
            response = json_response(
                {"code": "INTERNAL", "message": "Unexpected error", "details": {"requestId": request_id}}, 500
            )
        response.headers["X-Request-Id"] = request_id
        return response


def install_error_handlers(app: FastAPI) -> None:
    async def app_error(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, AppError)
        return error_response(exc)

    async def http_error(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, StarletteHTTPException)
        if exc.status_code in (404, 405):
            return error_response(NotFound(f"No route for {request.method} {request.url.path}"))
        if exc.status_code == 400:
            return error_response(ValidationFailed([{"field": "body", "message": str(exc.detail)}]))
        return error_response(AppError("HTTP_ERROR", str(exc.detail), None, exc.status_code))

    async def request_validation_error(request: Request, exc: Exception) -> Response:
        # Routes validate through middleware/validate.py; this only catches framework-level parsing.
        return error_response(ValidationFailed([{"field": "body", "message": "Malformed request"}]))

    app.add_exception_handler(AppError, app_error)
    app.add_exception_handler(StarletteHTTPException, http_error)
    app.add_exception_handler(RequestValidationError, request_validation_error)
