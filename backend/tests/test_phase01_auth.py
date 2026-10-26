from __future__ import annotations

import os

import pytest
from app.db.pool import exec_, get_pool
from helpers import api, bearer, reset_db, user_for


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()


def test_ac1_login_succeeds_with_the_right_password_and_returns_token_and_user() -> None:
    res = api().post("/api/v1/auth/login", json={"email": "Officer@Demo.in ", "password": "Demo@123"})
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["token"], str)
    user = body["user"]
    assert isinstance(user["id"], str) and isinstance(user["designation"], str)
    assert {k: v for k, v in user.items() if k not in ("id", "designation")} == {
        "name": "Anjali Deshmukh",
        "email": "officer@demo.in",
        "role": "officer",
        "institutionId": None,
        "institutionName": None,
    }
    assert set(user) == {"id", "name", "email", "role", "institutionId", "institutionName", "designation"}
    me = api().get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json() == user


def test_ac1_institution_user_carries_institution_id_and_name() -> None:
    res = api().post("/api/v1/auth/login", json={"email": "inst1@demo.in", "password": "Demo@123"})
    assert res.status_code == 200
    user = res.json()["user"]
    assert user["role"] == "institution"
    assert user["institutionName"] == "Vasavi Institute of Engineering & Technology, Hyderabad"
    assert isinstance(user["institutionId"], str)


def test_ac1_wrong_password_and_unknown_email_both_give_the_same_401() -> None:
    wrong = api().post("/api/v1/auth/login", json={"email": "officer@demo.in", "password": "nope"})
    unknown = api().post("/api/v1/auth/login", json={"email": "ghost@demo.in", "password": "Demo@123"})
    assert wrong.status_code == 401 and unknown.status_code == 401
    assert wrong.json()["code"] == "INVALID_CREDENTIALS" and wrong.json()["details"] is None
    assert unknown.json() == wrong.json()


def test_login_validates_input_as_422_listing_every_field() -> None:
    res = api().post("/api/v1/auth/login", json={"email": "not-an-email"})
    assert res.status_code == 422
    assert sorted(d["field"] for d in res.json()["details"]) == ["email", "password"]


def test_a_deactivated_user_cannot_log_in_and_their_existing_token_stops_working() -> None:
    officer = user_for("officer@demo.in")
    exec_(get_pool(), "UPDATE users SET active = false WHERE email = 'officer@demo.in'")
    assert (
        api().post("/api/v1/auth/login", json={"email": "officer@demo.in", "password": "Demo@123"}).status_code == 401
    )
    assert api().get("/api/v1/auth/me", headers=bearer(officer)).status_code == 401


def test_ac2_the_6th_attempt_within_a_minute_for_the_same_email_and_ip_is_429() -> None:
    agent = api()
    for i in range(5):
        res = agent.post("/api/v1/auth/login", json={"email": "approver@demo.in", "password": f"bad{i}"})
        assert res.status_code == 401
    sixth = agent.post("/api/v1/auth/login", json={"email": "approver@demo.in", "password": "Demo@123"})
    assert sixth.status_code == 429
    assert sixth.json()["code"] == "RATE_LIMITED" and sixth.json()["details"] is None
    # Another email from the same IP is not affected.
    other = agent.post("/api/v1/auth/login", json={"email": "admin@demo.in", "password": "Demo@123"})
    assert other.status_code == 200


def test_demo_users_listed_when_demo_mode_true_and_404_otherwise() -> None:
    prev = os.environ.get("DEMO_MODE")
    try:
        os.environ["DEMO_MODE"] = "true"
        res = api().get("/api/v1/demo/users")
        assert res.status_code == 200
        assert "inst1@demo.in" in [u["email"] for u in res.json()]
        first = res.json()[0]
        assert isinstance(first["name"], str)
        assert {k: v for k, v in first.items() if k != "name"} == {
            "email": "inst1@demo.in",
            "role": "institution",
            "institutionName": "Vasavi Institute of Engineering & Technology, Hyderabad",
        }
        assert "password" not in res.text
        os.environ["DEMO_MODE"] = "false"
        assert api().get("/api/v1/demo/users").status_code == 404
    finally:
        if prev is None:
            os.environ.pop("DEMO_MODE", None)
        else:
            os.environ["DEMO_MODE"] = prev
