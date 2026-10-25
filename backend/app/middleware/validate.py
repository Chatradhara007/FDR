"""Validates request bodies / queries against the pydantic schemas; lists every failing field (422)."""

from __future__ import annotations

import json
from typing import TypeVar

from fastapi import Request
from pydantic import ValidationError

from ..domain.errors import ValidationFailed
from ..schemas import ApiModel, Part, issues_from

M = TypeVar("M", bound=ApiModel)


def parse[M: ApiModel](model: type[M], data: object, part: Part = "body") -> M:
    try:
        return model.model_validate(data)
    except ValidationError as err:
        raise ValidationFailed(issues_from(model, err, part)) from None


async def json_body(request: Request) -> object:
    """The parsed JSON body ({} when there is none, like express.json()); malformed JSON is a 422."""
    raw = await request.body()
    content_type = request.headers.get("content-type", "")
    if not raw or "json" not in content_type:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        raise ValidationFailed([{"field": "body", "message": "Malformed JSON"}]) from None


def query_dict(request: Request) -> dict[str, str | list[str]]:
    """Query string as qs/Express parses it: repeated keys and `key[]` become lists."""
    out: dict[str, str | list[str]] = {}
    for key, value in request.query_params.multi_items():
        name = key[:-2] if key.endswith("[]") else key
        if name in out or key.endswith("[]"):
            prev = out.get(name)
            items = prev if isinstance(prev, list) else ([] if prev is None else [prev])
            out[name] = [*items, value]
        else:
            out[name] = value
    return out
