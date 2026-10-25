from __future__ import annotations

from datetime import UTC, datetime

from app.domain.canonical_json import canonical_json


def test_sorts_keys_recursively() -> None:
    a = {"b": 1, "a": {"d": [{"z": 1, "y": 2}], "c": "x"}}
    b = {"a": {"c": "x", "d": [{"y": 2, "z": 1}]}, "b": 1}
    assert canonical_json(a) == canonical_json(b)
    assert canonical_json(a) == '{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}'


def test_follows_json_stringify_for_null_and_dates() -> None:
    assert canonical_json({"b": None}) == '{"b":null}'
    assert canonical_json(None) == "null"
    assert canonical_json({"t": datetime(2026, 10, 25, 4, 30, tzinfo=UTC)}) == '{"t":"2026-10-25T04:30:00.000Z"}'
    assert canonical_json([1.0, 2.5, True]) == "[1,2.5,true]"
