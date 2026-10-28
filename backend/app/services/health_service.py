from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal, TypedDict

import httpx

from ..config import config
from ..db.pool import get_pool, maybe_one
from ..domain.canonical_json import iso_ms

Status = Literal["up", "down"]


class Health(TypedDict):
    status: Literal["ok"]
    db: Status
    mockBank: Status
    time: str
    showcaseMode: bool


def _db_status() -> Status:
    try:
        maybe_one(get_pool(), "SELECT 1")
        return "up"
    except Exception:
        return "down"


def _mock_bank_status() -> Status:
    try:
        res = httpx.get(f"{config.mock_bank_url}/health", timeout=1.5)
        return "up" if res.is_success else "down"
    except httpx.HTTPError:
        return "down"


def get_health() -> Health:
    # Infrastructure timestamp (wall time), not business time.
    return {"status": "ok", "db": _db_status(), "mockBank": _mock_bank_status(), "time": iso_ms(datetime.now(UTC)),
            "showcaseMode": config.showcase_mode}  # fmt: skip
