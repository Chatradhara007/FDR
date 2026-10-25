"""Shared test helpers (ported from the original helpers.ts)."""

from __future__ import annotations

import base64
import random
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.db.pool import exec_, get_pool, many, one, transaction
from app.domain import clock
from app.domain.token import sign_token
from app.main import create_app
from app.repositories.instrument_repo import InstrumentRow, NewInstrument, insert_instrument
from app.repositories.user_repo import find_user_by_email
from app.seed.base import seed_base
from app.shared_constants import Role
from fastapi import APIRouter
from fastapi.testclient import TestClient
from httpx import Response


def reset_db() -> None:
    """Truncates every table except schema_migrations, then re-inserts fixed rows."""
    pool = get_pool()
    tables = many(
        pool, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
    )
    if tables:
        names = ", ".join(f'"{t["tablename"]}"' for t in tables)
        exec_(pool, f"TRUNCATE {names} RESTART IDENTITY CASCADE")
    _insert_fixed_rows()


def _insert_fixed_rows() -> None:
    """Fixed rows every test expects: the REAL app clock, default rules, base institutions and users."""
    pool = get_pool()
    exec_(pool, "INSERT INTO app_clock (id, mode) VALUES (1, 'REAL') ON CONFLICT (id) DO NOTHING")
    seed_base(pool)


def api(mount_test_routes: Callable[[APIRouter], None] | None = None) -> TestClient:
    return TestClient(create_app(mount_test_routes), raise_server_exceptions=False)


@dataclass(frozen=True)
class SeededUser:
    id: str
    name: str
    role: Role
    institutionId: str | None
    token: str


def user_for(email: str) -> SeededUser:
    """A seeded user with a valid bearer token (no login round trip, so the login rate limiter is untouched)."""
    u = find_user_by_email(get_pool(), email)
    if u is None:
        raise AssertionError(f"no seeded user {email}")
    token = sign_token(u["id"], u["role"], u["institution_id"])
    return SeededUser(u["id"], u["name"], u["role"], u["institution_id"], token)


def bearer(u: SeededUser) -> dict[str, str]:
    return {"Authorization": f"Bearer {u.token}"}


def institution_id(email: str) -> str:
    u = find_user_by_email(get_pool(), email)
    if u is None or u["institution_id"] is None:
        raise AssertionError(f"{email} is not an institution user")
    return u["institution_id"]


def create_instrument(**overrides: Any) -> InstrumentRow:
    """Inserts a DRAFT instrument directly through the repository."""
    at = clock.now(get_pool())
    values: dict[str, Any] = {
        "type": "FDR",
        "referenceNo": "SBI/FD/2026/0001",
        "issuingBank": "State Bank of India",
        "amount": "2500000.00",
        "issueDate": "2026-04-01",
        "maturityDate": "2027-04-01",
        "beneficiaryName": "Member Secretary, AICTE",
        **overrides,
    }
    with transaction() as tx:
        return insert_instrument(tx, NewInstrument(**values), at)  # type: ignore[typeddict-item]


def count_events(where: str = "true", params: list[object] | None = None) -> int:
    return int(one(get_pool(), f"SELECT count(*) AS n FROM events WHERE {where}", params or [])["n"])


# ---- Phase 02 helpers ----

_file_counter = 0


def pdf_bytes(tag: str | None = None) -> bytes:
    """A minimal PDF whose bytes (and so checksum) differ per call unless `tag` is given."""
    global _file_counter
    if tag is None:
        _file_counter += 1
        tag = f"file-{_file_counter}-{random.random()}"
    return f"%PDF-1.4\n% {tag}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n".encode()


# 1x1 PNG.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

VALID_FDR: dict[str, Any] = {
    "type": "FDR",
    "referenceNo": "SBIN/FDR/2026/00731",
    "issuingBank": "State Bank of India",
    "branch": "Begumpet",
    "amount": "25,00,000",
    "issueDate": "2026-04-01",
    "maturityDate": "2027-04-01",
    "beneficiaryName": "Member Secretary, AICTE",
    "lienMarked": True,
    "purpose": "Security deposit for approval of new institution",
}


def set_today(day: str) -> None:
    """Fixes the app clock so date rules are deterministic."""
    clock.set_simulated(get_pool(), day)


def create_draft_via_api(user: SeededUser, body: dict[str, Any] | None = None) -> dict[str, Any]:
    res = api().post("/api/v1/instruments", headers=bearer(user), json=VALID_FDR if body is None else body)
    if res.status_code != 201:
        raise AssertionError(f"create failed {res.status_code} {res.text}")
    data: dict[str, Any] = res.json()
    return data


def upload_doc(
    user: SeededUser,
    instrument_id: str,
    doc_type: str,
    data: bytes | None = None,
    filename: str = "doc.pdf",
    content_type: str = "application/pdf",
) -> Response:
    return api().post(
        f"/api/v1/instruments/{instrument_id}/documents",
        headers=bearer(user),
        data={"docType": doc_type},
        files={"file": (filename, pdf_bytes() if data is None else data, content_type)},
    )


def ready_fdr(user: SeededUser, body: dict[str, Any] | None = None) -> str:
    """Draft with all fields and the FDR's required documents, ready to submit."""
    instrument_id: str = create_draft_via_api(user, body)["id"]
    for doc_type in ("FDR_COPY", "BANK_LETTER"):
        res = upload_doc(user, instrument_id, doc_type)
        if res.status_code != 201:
            raise AssertionError(f"upload failed {res.status_code} {res.text}")
    return instrument_id


# ---- Phase 04 helpers ----


def make_instrument(
    status: str,
    maturity: str,
    *,
    institution_email: str = "inst1@demo.in",
    issue: str = "2025-01-01",
    ref: str | None = None,
    verification_state: str = "CONFIRMED",
    submitted_at: str | None = None,
    parent_id: str | None = None,
    assigned_officer_id: str | None = None,
    amount: str = "2500000.00",
) -> str:
    """Inserts an instrument straight into the given status (test setup only; the app changes status via transition())."""
    global _file_counter
    _file_counter += 1
    at = clock.now(get_pool())
    row = one(
        get_pool(),
        """INSERT INTO instruments (institution_id, type, reference_no, issuing_bank, amount, issue_date, maturity_date,
                                beneficiary_name, lien_marked, status, verification_state, submitted_at,
                                parent_instrument_id, assigned_officer_id, created_at, updated_at)
     VALUES ($1, 'FDR', $2, 'Canara Bank', $3, $4, $5, 'Member Secretary, AICTE', true, $6::instrument_status,
             $7::verification_state, $8, $9, $10, $11, $11)
     RETURNING id""",
        [
            institution_id(institution_email), ref or f"CNRB/FD/TEST/{_file_counter:05d}", amount, issue, maturity,
            status, verification_state, submitted_at, parent_id, assigned_officer_id, at,
        ],
    )  # fmt: skip
    return str(row["id"])


def evaluate_on(day: str) -> dict[str, Any]:
    """Sets the app clock to `day` and runs the evaluation job once."""
    from app.jobs.evaluate import evaluate

    set_today(day)
    with transaction() as tx:
        return dict(evaluate(tx, day))


def alerts_of(instrument_id: str) -> list[dict[str, Any]]:
    return many(
        get_pool(),
        """SELECT id, kind, rule_key, subject_id, level, root_alert_id, recipient_role, recipient_user_id, status,
              resolution, resolution_note, resolved_by, dedupe_key
         FROM alerts WHERE instrument_id = $1 ORDER BY level, rule_key, recipient_role""",
        [instrument_id],
    )


def instrument_status(instrument_id: str) -> str:
    return str(one(get_pool(), "SELECT status FROM instruments WHERE id = $1", [instrument_id])["status"])
