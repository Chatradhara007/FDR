from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, exec_, many, maybe_one
from ..shared_constants import Role


class UserRow(TypedDict):
    id: str
    name: str
    email: str
    password_hash: str
    role: Role
    institution_id: str | None
    institution_name: str | None
    designation: str | None
    active: bool


SELECT_USER = """
  SELECT u.id, u.name, u.email, u.password_hash, u.role, u.institution_id, i.name AS institution_name,
         u.designation, u.active
    FROM users u LEFT JOIN institutions i ON i.id = u.institution_id"""


def find_user_by_email(db: Db, email: str) -> UserRow | None:
    return cast(UserRow | None, maybe_one(db, f"{SELECT_USER} WHERE lower(u.email) = lower($1)", [email]))


def find_user_by_id(db: Db, user_id: str) -> UserRow | None:
    return cast(UserRow | None, maybe_one(db, f"{SELECT_USER} WHERE u.id = $1", [user_id]))


def list_users_by_emails(db: Db, emails: Sequence[str]) -> list[UserRow]:
    return cast(list[UserRow], many(db, f"{SELECT_USER} WHERE u.email = ANY($1::text[]) AND u.active", [list(emails)]))


class NewUser(TypedDict):
    name: str
    email: str
    passwordHash: str
    role: Role
    institutionId: str | None
    designation: str | None
    createdAt: datetime


def insert_user_if_missing(db: Db, u: NewUser) -> bool:
    """Inserts unless the email exists; returns whether a row was created."""
    n = exec_(
        db,
        """INSERT INTO users (name, email, password_hash, role, institution_id, designation, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email) DO NOTHING""",
        [u["name"], u["email"], u["passwordHash"], u["role"], u["institutionId"], u["designation"], u["createdAt"]],
    )
    return n > 0


class AdminUserRow(TypedDict):
    id: str
    name: str
    email: str
    role: Role
    institutionId: str | None
    institutionName: str | None
    designation: str | None
    active: bool
    version: int
    createdAt: datetime
    updatedAt: datetime | None


SELECT_ADMIN_USER = """
  SELECT u.id, u.name, u.email, u.role, u.institution_id AS "institutionId", i.name AS "institutionName",
         u.designation, u.active, u.version, u.created_at AS "createdAt", u.updated_at AS "updatedAt"
    FROM users u LEFT JOIN institutions i ON i.id = u.institution_id"""


def list_admin_users(db: Db) -> list[AdminUserRow]:
    return cast(list[AdminUserRow], many(db, f"{SELECT_ADMIN_USER} ORDER BY u.active DESC, u.role, lower(u.name)"))


def find_admin_user(db: Db, user_id: str) -> AdminUserRow | None:
    return cast(AdminUserRow | None, maybe_one(db, f"{SELECT_ADMIN_USER} WHERE u.id = $1", [user_id]))


def lock_admin_user(tx: Db, user_id: str) -> AdminUserRow | None:
    row = maybe_one(tx, "SELECT id FROM users WHERE id = $1 FOR UPDATE", [user_id])
    return find_admin_user(tx, user_id) if row else None


def email_taken(db: Db, email: str) -> bool:
    return maybe_one(db, "SELECT 1 AS x FROM users WHERE lower(email) = lower($1)", [email]) is not None


def insert_user(db: Db, u: NewUser) -> str:
    row = maybe_one(
        db,
        """INSERT INTO users (name, email, password_hash, role, institution_id, designation, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id""",
        [u["name"], u["email"], u["passwordHash"], u["role"], u["institutionId"], u["designation"], u["createdAt"]],
    )
    assert row is not None
    return cast(str, row["id"])


def update_user(tx: Db, user_id: str, name: str, designation: str | None, active: bool, at: datetime) -> None:
    exec_(
        tx,
        """UPDATE users SET name = $2, designation = $3, active = $4, updated_at = $5, version = version + 1
          WHERE id = $1""",
        [user_id, name, designation, active, at],
    )


def set_password_hash(tx: Db, user_id: str, password_hash: str, at: datetime) -> None:
    exec_(
        tx,
        "UPDATE users SET password_hash = $2, updated_at = $3, version = version + 1 WHERE id = $1",
        [user_id, password_hash, at],
    )
