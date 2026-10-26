from __future__ import annotations

from typing import Literal, TypedDict

from ..config import config
from ..db.pool import get_pool, transaction
from ..domain.access import AuthUser
from ..domain.audit import NIL_UUID, Actor, record_event
from ..domain.errors import Unauthorized
from ..domain.passwords import check_password, hash_password
from ..domain.token import sign_token
from ..repositories.user_repo import UserRow, find_user_by_email, find_user_by_id, list_users_by_emails
from ..seed.base import DEMO_USER_EMAILS
from ..shared_constants import Role

INVALID = "Email or password is incorrect"
# Compared against when the email is unknown, so both failures take the same time.
_dummy_hash: str | None = None


class SessionUser(TypedDict):
    id: str
    name: str
    email: str
    role: Role
    institutionId: str | None
    institutionName: str | None
    designation: str | None


class LoginResponse(TypedDict):
    token: str
    user: SessionUser


class DemoUser(TypedDict):
    email: str
    name: str
    role: Role
    institutionName: str | None


def _to_session_user(u: UserRow) -> SessionUser:
    return {
        "id": u["id"],
        "name": u["name"],
        "email": u["email"],
        "role": u["role"],
        "institutionId": u["institution_id"],
        "institutionName": u["institution_name"],
        "designation": u["designation"],
    }


FailReason = Literal["UNKNOWN_EMAIL", "BAD_PASSWORD", "INACTIVE"]


def _record_login(user: UserRow | None, email: str, ip: str, reason: FailReason | None) -> None:
    """LOGIN_SUCCEEDED / LOGIN_FAILED (§8.2). Unknown emails are logged against the nil UUID with the email typed."""
    after: dict[str, object] = {"email": email, "ip": ip}
    if reason:
        after["reason"] = reason
    actor = Actor(id=user["id"], label=user["name"]) if user else Actor(label="Unknown user")
    with transaction() as tx:
        record_event(
            tx,
            actor=actor,
            action="LOGIN_FAILED" if reason else "LOGIN_SUCCEEDED",
            entity_type="user",
            entity_id=user["id"] if user else NIL_UUID,
            after=after,
        )


def login(email: str, password: str, ip: str = "") -> LoginResponse:
    global _dummy_hash
    user = find_user_by_email(get_pool(), email)
    if _dummy_hash is None:
        _dummy_hash = hash_password("not-a-real-password")
    ok = check_password(password, user["password_hash"] if user else _dummy_hash)
    if user is None or not ok or not user["active"]:
        reason: FailReason = "UNKNOWN_EMAIL" if user is None else "BAD_PASSWORD" if not ok else "INACTIVE"
        _record_login(user, email, ip, reason)
        raise Unauthorized(INVALID, None, "INVALID_CREDENTIALS")
    _record_login(user, email, ip, None)
    token = sign_token(user["id"], user["role"], user["institution_id"])
    return {"token": token, "user": _to_session_user(user)}


def load_session_user(user_id: str) -> AuthUser | None:
    """Loads the session user for authenticate(); None when missing or deactivated."""
    u = find_user_by_id(get_pool(), user_id)
    if u is None or not u["active"]:
        return None
    return AuthUser(id=u["id"], name=u["name"], role=u["role"], institutionId=u["institution_id"])


def session_ended_message(user_id: str) -> str:
    """Why a valid token no longer works: in demo mode a missing user means a demo reset removed them."""
    if config.demo_mode and find_user_by_id(get_pool(), user_id) is None:
        return "Demo data was reset, sign in again"
    return "Your session has ended, sign in again"


def me(user_id: str) -> SessionUser:
    u = find_user_by_id(get_pool(), user_id)
    if u is None or not u["active"]:
        raise Unauthorized()
    return _to_session_user(u)


def list_demo_users() -> list[DemoUser]:
    rows = list_users_by_emails(get_pool(), DEMO_USER_EMAILS)
    order = {e: i for i, e in enumerate(DEMO_USER_EMAILS)}
    rows.sort(key=lambda u: order.get(u["email"], 0))
    return [
        {"email": u["email"], "name": u["name"], "role": u["role"], "institutionName": u["institution_name"]}
        for u in rows
    ]
