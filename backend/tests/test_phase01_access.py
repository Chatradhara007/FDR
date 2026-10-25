from __future__ import annotations

import pytest
from app.domain.access import scope_instruments_query
from helpers import api, bearer, create_instrument, institution_id, reset_db, user_for


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()


def test_ac3_another_institutions_instrument_is_404_for_institution_users_200_for_officers() -> None:
    inst = create_instrument(institutionId=institution_id("inst2@demo.in"))
    path = f"/api/v1/instruments/{inst['id']}"
    other = api().get(path, headers=bearer(user_for("inst1@demo.in")))
    assert other.status_code == 404
    assert other.json()["code"] == "NOT_FOUND" and other.json()["details"] is None
    assert set(other.json()) == {"code", "message", "details"}

    own = api().get(path, headers=bearer(user_for("inst2@demo.in")))
    assert own.status_code == 200
    assert {k: own.json()[k] for k in ("id", "status", "amount", "maturityDate", "version")} == {
        "id": inst["id"], "status": "DRAFT", "amount": "2500000.00", "maturityDate": "2027-04-01", "version": 1,
    }  # fmt: skip

    for email in ("officer@demo.in", "approver@demo.in", "admin@demo.in", "auditor@demo.in"):
        assert api().get(path, headers=bearer(user_for(email))).status_code == 200, email


def test_unknown_or_malformed_ids_are_404_no_token_is_401() -> None:
    officer = user_for("officer@demo.in")
    assert (
        api().get("/api/v1/instruments/00000000-0000-0000-0000-000000000001", headers=bearer(officer)).status_code
        == 404
    )
    assert api().get("/api/v1/instruments/not-a-uuid", headers=bearer(officer)).status_code == 404
    assert api().get("/api/v1/instruments/not-a-uuid").status_code == 401


def test_scope_instruments_query_adds_an_institution_filter_only_for_institution_users() -> None:
    inst1 = user_for("inst1@demo.in")
    officer = user_for("officer@demo.in")
    from app.domain.access import AuthUser

    params: list[object] = ["x"]
    as_user = AuthUser(inst1.id, inst1.name, inst1.role, inst1.institutionId)
    assert scope_instruments_query(as_user, params) == " AND i.institution_id = $2"
    assert params == ["x", inst1.institutionId]
    p2: list[object] = []
    assert scope_instruments_query(AuthUser(officer.id, officer.name, officer.role, None), p2) == ""
    assert p2 == []
