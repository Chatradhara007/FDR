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
