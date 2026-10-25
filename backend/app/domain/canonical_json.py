"""Deterministic JSON for hashing (D16), byte-identical to the original JS `canonicalJson`:
object keys sorted recursively (UTF-16 code unit order, like Array.prototype.sort), numbers and
strings formatted as JSON.stringify does, timestamps as `toISOString()`.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, date, datetime


def iso_ms(dt: datetime) -> str:
    """`Date.prototype.toISOString()`: UTC, millisecond precision, `Z` suffix."""
    u = dt.astimezone(UTC)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def js_number(n: int | float) -> str:
    """Number formatting of JSON.stringify (integral floats without `.0`, exponents like `1e+21`)."""
    if isinstance(n, int):
        return str(n)
    if not math.isfinite(n):
        return "null"
    if n.is_integer() and abs(n) < 1e21:
        return str(int(n))
    r = repr(n)
    if "e" in r:
        mantissa, exp = r.split("e")
        sign = "-" if exp.startswith("-") else "+"
        return f"{mantissa}e{sign}{exp.lstrip('+-').lstrip('0') or '0'}"
    return r


def _is_array_index(k: str) -> bool:
    return k.isdigit() and k.isascii() and (k == "0" or not k.startswith("0")) and int(k) < 2**32 - 1


def _ordered(keys: list[str], sort: bool) -> list[str]:
    """JS objects enumerate array-index keys first (numeric order), then the rest; sorting applies to the rest."""
    index = sorted((k for k in keys if _is_array_index(k)), key=int)
    rest = [k for k in keys if not _is_array_index(k)]
    if sort:
        rest.sort(key=lambda k: k.encode("utf-16-be", "surrogatepass"))
    return index + rest


def _dump(value: object, sort: bool) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int | float):
        return js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, datetime):
        return json.dumps(iso_ms(value))
    if isinstance(value, date):
        return json.dumps(value.isoformat())
    if isinstance(value, dict):
        items = {str(k): v for k, v in value.items()}
        keys = _ordered(list(items), sort)
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{_dump(items[k], sort)}" for k in keys) + "}"
    if isinstance(value, list | tuple):
        return "[" + ",".join(_dump(v, sort) for v in value) + "]"
    raise TypeError(f"Not JSON-serialisable: {type(value).__name__}")


def canonical_json(value: object) -> str:
    return _dump(value, sort=True)


def js_json(value: object) -> str:
    """JSON.stringify without sorting (keys in insertion order); used for JSONB parameters and responses."""
    return _dump(value, sort=False)


def to_json_value(value: object) -> object:
    """JSON round trip: timestamps become ISO strings, exactly what JSONB gives back."""
    return None if value is None else json.loads(js_json(value))
