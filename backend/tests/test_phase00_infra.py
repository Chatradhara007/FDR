from __future__ import annotations

import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from app.db.migrate import migrate
from app.db.pool import exec_, get_pool, many, maybe_one, one, transaction
from app.domain.access import AuthUser
from app.domain.errors import AppError
from app.middleware.auth import require_role
from app.middleware.responses import json_response
from fastapi import APIRouter, Depends
from helpers import api, reset_db, user_for
from starlette.responses import Response


@pytest.fixture(scope="module", autouse=True)
def _cleanup() -> Iterator[None]:
    yield
    exec_(get_pool(), "DROP TABLE IF EXISTS zz_phase00_probe")
    exec_(get_pool(), "DELETE FROM schema_migrations WHERE name LIKE 'zz_%'")


def test_applies_migrations_once_in_order_and_is_idempotent() -> None:
    folder = Path(tempfile.mkdtemp(prefix="fdr-mig-"))
    (folder / "zz_002_b.sql").write_text("ALTER TABLE zz_phase00_probe ADD COLUMN d date;")
    (folder / "zz_001_a.sql").write_text("CREATE TABLE zz_phase00_probe (id int, amount numeric(14,2));")
    assert migrate(folder) == ["zz_001_a.sql", "zz_002_b.sql"]
    assert migrate(folder) == []


def test_type_parsers_keep_date_and_numeric_as_strings() -> None:
    reset_db()
    exec_(get_pool(), "INSERT INTO zz_phase00_probe VALUES (1, 2500000.5, '2027-03-31')")
    row = one(get_pool(), "SELECT amount, d, count(*) OVER () AS n FROM zz_phase00_probe")
    assert row == {"amount": "2500000.50", "d": "2027-03-31", "n": 1}


def test_one_raises_not_found_maybe_one_returns_none_transactions_roll_back() -> None:
    reset_db()
    with pytest.raises(AppError) as err:
        one(get_pool(), "SELECT 1 FROM zz_phase00_probe")
    assert err.value.http_status == 404
    assert maybe_one(get_pool(), "SELECT 1 FROM zz_phase00_probe") is None
    with pytest.raises(RuntimeError, match="abort"), transaction() as tx:
        exec_(tx, "INSERT INTO zz_phase00_probe (id) VALUES (7)")
        raise RuntimeError("abort")
    assert many(get_pool(), "SELECT * FROM zz_phase00_probe") == []


def _mount(router: APIRouter) -> None:
    @router.get("/__test/admin-only")
    def admin_only(user: AuthUser = Depends(require_role("admin"))) -> Response:
        return json_response(
            {"user": {"id": user.id, "name": user.name, "role": user.role, "institutionId": user.institutionId}}
        )


def test_401_without_or_with_a_bad_token() -> None:
    assert api(_mount).get("/api/v1/__test/admin-only").status_code == 401
    bad = api(_mount).get("/api/v1/__test/admin-only", headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401
    assert bad.json()["code"] == "UNAUTHORIZED"


def test_403_for_the_wrong_role_200_for_the_right_one() -> None:
    """Phase 01: authenticate loads the user from the DB, so tokens must belong to seeded users."""
    reset_db()
    officer = user_for("officer@demo.in")
    admin = user_for("admin@demo.in")
    res403 = api(_mount).get("/api/v1/__test/admin-only", headers={"Authorization": f"Bearer {officer.token}"})
    assert res403.status_code == 403
    assert res403.json()["code"] == "FORBIDDEN" and res403.json()["details"] is None
    ok = api(_mount).get("/api/v1/__test/admin-only", headers={"Authorization": f"Bearer {admin.token}"})
    assert ok.status_code == 200
    assert ok.json()["user"] == {"id": admin.id, "name": admin.name, "role": "admin", "institutionId": None}
