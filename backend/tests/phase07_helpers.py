"""Shared setup for the Phase 07 tests: release requests and discrepancies inserted directly (read-side phase)."""

from __future__ import annotations

import json
from typing import Any

from app.db.pool import get_pool, one
from app.domain import clock
from helpers import SeededUser, api, bearer
from httpx import Response

LEVELS_3 = [
    {"level": 1, "role": "officer", "action": "RECOMMEND", "label": "Scrutiny officer recommendation"},
    {"level": 2, "role": "approver", "action": "DECIDE", "label": "Competent authority decision"},
    {"level": 3, "role": "approver", "action": "DECIDE", "label": "Second competent authority"},
]


def get(user: SeededUser, path: str) -> Response:
    return api().get(f"/api/v1{path}", headers=bearer(user))


def ok(res: Response, status: int = 200) -> Any:
    assert res.status_code == status, res.text
    return res.json()


def add_discrepancy(instrument_id: str, field: str = "amount") -> str:
    row = one(
        get_pool(),
        """INSERT INTO discrepancies (instrument_id, field_name, claimed_value, confirmed_value, reason, created_at)
     VALUES ($1, $2, '25000000.00', '20000000.00', 'Amount mismatch', $3) RETURNING id""",
        [instrument_id, field, clock.now(get_pool())],
    )
    return str(row["id"])


def add_release_request(instrument_id: str, requested_by: str, status: str, level: int) -> str:
    at = clock.now(get_pool())
    row = one(
        get_pool(),
        """INSERT INTO release_requests (instrument_id, requested_by, reason, status, required_levels, current_level,
                                     requested_at, stage_started_at)
     VALUES ($1, $2, 'Obligation fulfilled', $3, $4::jsonb, $5, $6, $6) RETURNING id""",
        [instrument_id, requested_by, status, json.dumps(LEVELS_3), level, at],
    )
    return str(row["id"])


def add_approval(request_id: str, level: int, role: str, user_id: str, decision: str) -> None:
    one(
        get_pool(),
        """INSERT INTO release_approvals (release_request_id, level, role, approver_id, decision, remarks,
                                      conditions_snapshot, decided_at)
     VALUES ($1, $2, $3::user_role, $4, $5, 'ok', '[]'::jsonb, $6) RETURNING id""",
        [request_id, level, role, user_id, decision, clock.now(get_pool())],
    )
