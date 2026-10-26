"""User management (Phase 8 §8.2). Admin only. Password hashes never leave this module or enter an event."""

from __future__ import annotations

from typing import TypedDict

from ..db.pool import Conn, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of
from ..domain.audit import record_event
from ..domain.canonical_json import iso_ms
from ..domain.errors import Conflict, NotFound, ValidationFailed
from ..domain.passwords import hash_password
from ..repositories import user_repo
from ..repositories.institution_repo import find_institution_by_id
from ..repositories.user_repo import AdminUserRow
from ..schemas import FieldIssue, PasswordResetInput, UserCreateInput, UserPatchInput
from ..shared_constants import Role


class UserView(TypedDict):
    id: str
    name: str
    email: str
    role: Role
    institutionId: str | None
    institutionName: str | None
    designation: str | None
    active: bool
    version: int
    createdAt: str
    updatedAt: str | None


def _view(u: AdminUserRow) -> UserView:
    return {
        **u,
        "createdAt": iso_ms(u["createdAt"]),
        "updatedAt": iso_ms(u["updatedAt"]) if u["updatedAt"] else None,
    }


def _public(u: AdminUserRow) -> dict[str, object]:
    """What a user event records about the user (never the password hash)."""
    return {
        "name": u["name"],
        "email": u["email"],
        "role": u["role"],
        "institutionId": u["institutionId"],
        "designation": u["designation"],
        "active": u["active"],
    }


def list_users() -> list[UserView]:
    return [_view(u) for u in user_repo.list_admin_users(get_pool())]


def create_user(admin: AuthUser, data: UserCreateInput) -> UserView:
    issues: list[FieldIssue] = []
    if data.role == "institution" and data.institution_id is None:
        issues.append({"field": "institutionId", "message": "Choose the institution this user belongs to"})
    if data.role != "institution" and data.institution_id is not None:
        issues.append({"field": "institutionId", "message": "Only institution users belong to an institution"})
    if data.institution_id is not None and find_institution_by_id(get_pool(), data.institution_id) is None:
        issues.append({"field": "institutionId", "message": "Choose an institution"})
    if issues:
        raise ValidationFailed(issues)
    password_hash = hash_password(data.password)  # outside the transaction: bcrypt is slow
    with transaction() as tx:
        if user_repo.email_taken(tx, data.email):
            raise Conflict("A user with this email already exists", {"field": "email"}, "EMAIL_TAKEN")
        user_id = user_repo.insert_user(
            tx,
            {
                "name": data.name,
                "email": data.email,
                "passwordHash": password_hash,
                "role": data.role,
                "institutionId": data.institution_id,
                "designation": data.designation,
                "createdAt": clock.now(tx),
            },
        )
        created = user_repo.find_admin_user(tx, user_id)
        assert created is not None
        record_event(
            tx, actor=actor_of(admin), action="USER_CREATED", entity_type="user", entity_id=user_id,
            after=_public(created),
        )  # fmt: skip
    return _view(created)


def _lock(tx: Conn, user_id: str, version: int | None) -> AdminUserRow:
    user = user_repo.lock_admin_user(tx, user_id)
    if user is None:
        raise NotFound("User not found")
    if version is not None and user["version"] != version:
        raise Conflict(
            "This user was changed by someone else — reload and try again",
            {"currentVersion": user["version"]},
            "STALE_VERSION",
        )
    return user


def update_user(admin: AuthUser, user_id: str, data: UserPatchInput) -> UserView:
    sent = data.model_fields_set
    with transaction() as tx:
        user = _lock(tx, user_id, data.version)
        name = data.name if "name" in sent and data.name is not None else user["name"]
        designation = data.designation if "designation" in sent else user["designation"]
        active = data.active if "active" in sent and data.active is not None else user["active"]
        if user_id == admin.id and not active:
            raise ValidationFailed([{"field": "active", "message": "You cannot deactivate your own account"}])
        before: dict[str, object] = {"name": user["name"], "designation": user["designation"], "active": user["active"]}
        after: dict[str, object] = {"name": name, "designation": designation, "active": active}
        changed = [k for k in after if after[k] != before[k]]
        if not changed:
            return _view(user)
        user_repo.update_user(tx, user_id, name, designation, active, clock.now(tx))
        action = "USER_DEACTIVATED" if user["active"] and not active else "USER_UPDATED"
        record_event(
            tx,
            actor=actor_of(admin),
            action=action,
            entity_type="user",
            entity_id=user_id,
            before={k: before[k] for k in changed} | {"email": user["email"]},
            after={k: after[k] for k in changed} | {"email": user["email"]},
        )
        updated = user_repo.find_admin_user(tx, user_id)
    assert updated is not None
    return _view(updated)


def reset_password(admin: AuthUser, user_id: str, data: PasswordResetInput) -> UserView:
    password_hash = hash_password(data.password)
    with transaction() as tx:
        user = _lock(tx, user_id, None)
        user_repo.set_password_hash(tx, user_id, password_hash, clock.now(tx))
        record_event(
            tx, actor=actor_of(admin), action="PASSWORD_RESET", entity_type="user", entity_id=user_id,
            after={"email": user["email"]},
        )  # fmt: skip
        updated = user_repo.find_admin_user(tx, user_id)
    assert updated is not None
    return _view(updated)
