"""Phase 08 §8.2: user management (AC4) and sign-in events (AC9)."""

from __future__ import annotations

from typing import Any

import pytest
from app.db.pool import get_pool, many, one
from app.domain.audit import NIL_UUID, verify_chain
from app.domain.token import sign_token
from app.seed.base import DEMO_PASSWORD
from helpers import api, bearer, institution_id, reset_db, user_for

NEW_OFFICER = {
    "name": "Ravi Kumar",
    "email": "Ravi.Kumar@aicte.example",
    "role": "officer",
    "designation": "Assistant Director",
    "password": "secret123",
}


@pytest.fixture(autouse=True)
def _fresh() -> None:
    reset_db()


def admin() -> dict[str, str]:
    return bearer(user_for("admin@demo.in"))


def create(body: dict[str, Any]) -> Any:
    return api().post("/api/v1/users", headers=admin(), json=body)


def login(email: str, password: str) -> Any:
    return api().post("/api/v1/auth/login", json={"email": email, "password": password})


def test_create_list_and_sign_in_as_the_new_user() -> None:
    res = create(NEW_OFFICER)
    assert res.status_code == 201, res.text
    user = res.json()
    assert user["email"] == "ravi.kumar@aicte.example" and user["role"] == "officer" and user["active"] is True
    assert user["version"] == 1 and "passwordHash" not in user and "password_hash" not in user
    listed = api().get("/api/v1/users", headers=admin()).json()
    assert any(u["id"] == user["id"] for u in listed)
    assert login("ravi.kumar@aicte.example", "secret123").status_code == 200
    created = one(get_pool(), "SELECT after_json FROM events WHERE action = 'USER_CREATED'")["after_json"]
    assert created["email"] == "ravi.kumar@aicte.example" and "password" not in str(created).lower()
    stored = one(get_pool(), "SELECT password_hash FROM users WHERE id = $1", [user["id"]])["password_hash"]
    assert stored.startswith("$2b$10$")


def test_create_validation_lists_every_field() -> None:
    res = create({"name": "", "email": "nope", "role": "boss", "password": "short"})
    assert res.status_code == 422
    assert {d["field"] for d in res.json()["details"]} == {"name", "email", "role", "password"}
    for weak in ("abcdefgh", "12345678", "a1b2c3"):
        r = create({**NEW_OFFICER, "password": weak})
        assert r.json()["details"] == [
            {"field": "password", "message": "Use at least 8 characters with a letter and a digit"}
        ]
    no_inst = create({**NEW_OFFICER, "role": "institution"})
    assert no_inst.json()["details"] == [
        {"field": "institutionId", "message": "Choose the institution this user belongs to"}
    ]
    inst = institution_id("inst1@demo.in")
    officer_with_inst = create({**NEW_OFFICER, "institutionId": inst})
    assert officer_with_inst.json()["details"][0]["field"] == "institutionId"
    ok = create({**NEW_OFFICER, "role": "institution", "institutionId": inst})
    assert ok.status_code == 201 and ok.json()["institutionId"] == inst
    dup = create({**NEW_OFFICER, "email": "ADMIN@demo.in"})
    assert dup.status_code == 409 and dup.json()["code"] == "EMAIL_TAKEN"


def test_ac4_deactivated_user_token_stops_working_and_login_fails() -> None:
    officer = user_for("officer@demo.in")
    assert api().get("/api/v1/auth/me", headers=bearer(officer)).status_code == 200
    assert login("officer@demo.in", DEMO_PASSWORD).status_code == 200
    res = api().patch(f"/api/v1/users/{officer.id}", headers=admin(), json={"active": False, "version": 1})
    assert res.status_code == 200 and res.json()["active"] is False and res.json()["version"] == 2
    assert api().get("/api/v1/auth/me", headers=bearer(officer)).status_code == 401
    assert api().get("/api/v1/scrutiny/queue", headers=bearer(officer)).status_code == 401
    assert login("officer@demo.in", DEMO_PASSWORD).status_code == 401
    event = one(get_pool(), "SELECT before_json, after_json FROM events WHERE action = 'USER_DEACTIVATED'")
    assert event["before_json"]["active"] is True and event["after_json"]["active"] is False
    # Reactivating restores access (an ordinary update).
    back = api().patch(f"/api/v1/users/{officer.id}", headers=admin(), json={"active": True, "version": 2})
    assert back.status_code == 200
    assert api().get("/api/v1/auth/me", headers=bearer(officer)).status_code == 200


def test_update_reset_password_and_guards() -> None:
    officer = user_for("officer@demo.in")
    res = api().patch(
        f"/api/v1/users/{officer.id}", headers=admin(), json={"designation": "Deputy Director", "version": 1}
    )
    assert res.status_code == 200 and res.json()["designation"] == "Deputy Director"
    event = one(get_pool(), "SELECT before_json, after_json FROM events WHERE action = 'USER_UPDATED'")
    assert event["after_json"]["designation"] == "Deputy Director" and "name" not in event["after_json"]
    stale = api().patch(f"/api/v1/users/{officer.id}", headers=admin(), json={"name": "X", "version": 1})
    assert stale.status_code == 409 and stale.json()["code"] == "STALE_VERSION"
    me = user_for("admin@demo.in")
    self_off = api().patch(f"/api/v1/users/{me.id}", headers=admin(), json={"active": False, "version": 1})
    assert self_off.json()["details"] == [{"field": "active", "message": "You cannot deactivate your own account"}]

    weak = api().post(f"/api/v1/users/{officer.id}/reset-password", headers=admin(), json={"password": "password"})
    assert weak.status_code == 422
    reset = api().post(f"/api/v1/users/{officer.id}/reset-password", headers=admin(), json={"password": "newpass99"})
    assert reset.status_code == 200
    assert login("officer@demo.in", DEMO_PASSWORD).status_code == 401
    assert login("officer@demo.in", "newpass99").status_code == 200
    pw_event = one(get_pool(), "SELECT after_json FROM events WHERE action = 'PASSWORD_RESET'")["after_json"]
    assert pw_event == {"email": "officer@demo.in"}
    assert api().patch(f"/api/v1/users/{NIL_UUID}", headers=admin(), json={"version": 1}).status_code == 404
    assert api().patch("/api/v1/users/not-a-uuid", headers=admin(), json={"version": 1}).status_code == 404
    assert verify_chain(get_pool())["ok"]


def test_user_endpoints_are_admin_only() -> None:
    officer = user_for("officer@demo.in")
    for email in ("auditor@demo.in", "officer@demo.in", "approver@demo.in", "inst1@demo.in"):
        h = bearer(user_for(email))
        assert api().get("/api/v1/users", headers=h).status_code == 403
        assert api().post("/api/v1/users", headers=h, json=NEW_OFFICER).status_code == 403
        assert api().patch(f"/api/v1/users/{officer.id}", headers=h, json={"version": 1}).status_code == 403
        assert (
            api()
            .post(f"/api/v1/users/{officer.id}/reset-password", headers=h, json={"password": "abc12345"})
            .status_code
            == 403
        )


def test_ac9_login_success_and_failure_events() -> None:
    assert login("officer@demo.in", DEMO_PASSWORD).status_code == 200
    assert login("officer@demo.in", "wrong-password1").status_code == 401
    assert login("ghost@demo.in", "whatever1").status_code == 401
    officer = user_for("officer@demo.in")
    api().patch(f"/api/v1/users/{officer.id}", headers=admin(), json={"active": False, "version": 1})
    assert login("officer@demo.in", DEMO_PASSWORD).status_code == 401
    rows = many(
        get_pool(),
        """SELECT action, actor_id, actor_label, entity_type, entity_id, after_json FROM events
            WHERE action IN ('LOGIN_SUCCEEDED', 'LOGIN_FAILED') ORDER BY id""",
    )
    assert [(r["action"], r["after_json"].get("reason")) for r in rows] == [
        ("LOGIN_SUCCEEDED", None),
        ("LOGIN_FAILED", "BAD_PASSWORD"),
        ("LOGIN_FAILED", "UNKNOWN_EMAIL"),
        ("LOGIN_FAILED", "INACTIVE"),
    ]
    assert all(r["entity_type"] == "user" for r in rows)
    assert (
        rows[0]["actor_id"] == rows[0]["entity_id"] == officer.id
        and rows[0]["after_json"]["email"] == "officer@demo.in"
    )
    unknown = rows[2]
    assert unknown["actor_id"] is None and unknown["entity_id"] == NIL_UUID
    assert unknown["after_json"]["email"] == "ghost@demo.in"
    assert all(
        secret not in str(r["after_json"]) for r in rows for secret in (DEMO_PASSWORD, "wrong-password1", "whatever1")
    )


def test_a_token_for_a_deleted_role_claim_is_still_checked_against_the_db() -> None:
    """authenticate reloads the user on every request, so a token outliving its user's deactivation is useless."""
    officer = user_for("officer@demo.in")
    token = sign_token(officer.id, "officer", None)
    api().patch(f"/api/v1/users/{officer.id}", headers=admin(), json={"active": False, "version": 1})
    assert api().get("/api/v1/meta", headers={"Authorization": f"Bearer {token}"}).status_code == 401
