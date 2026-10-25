"""JSON responses serialised like Express's res.json(): timestamps as `toISOString()`, compact output."""

from __future__ import annotations

from fastapi.responses import JSONResponse

from ..domain.canonical_json import js_json


class ApiJSONResponse(JSONResponse):
    def render(self, content: object) -> bytes:
        return js_json(content).encode("utf-8")


def json_response(content: object, status_code: int = 200, headers: dict[str, str] | None = None) -> ApiJSONResponse:
    return ApiJSONResponse(content, status_code=status_code, headers=headers)
