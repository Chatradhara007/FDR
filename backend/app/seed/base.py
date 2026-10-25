"""Base dataset: institutions, demo users and default rules. Idempotent. Phase 9 layers the demo
instruments on top (docs/seed-spec.md)."""

from __future__ import annotations

from typing import TypedDict

from ..db.pool import Db
from ..domain import clock
from ..domain.passwords import hash_password
from ..repositories.institution_repo import NewInstitution, upsert_institution
from ..repositories.rule_repo import insert_rule_if_missing
from ..repositories.user_repo import insert_user_if_missing
from ..shared_constants import RULE_DEFAULTS, Role

DEMO_PASSWORD = "Demo@123"

INSTITUTIONS: dict[str, NewInstitution] = {
    "inst1": {
        "aicte_id": "1-1234567890",
        "name": "Vasavi College of Engineering, Hyderabad",
        "region": "South-Central",
        "state": "Telangana",
        "contact_email": "principal@vasavi.demo.in",
    },
    "inst2": {
        "aicte_id": "1-2345678901",
        "name": "Sri Venkateswara Institute of Technology, Tirupati",
        "region": "Southern",
        "state": "Andhra Pradesh",
        "contact_email": "principal@svit.demo.in",
    },
}


class SeedUser(TypedDict):
    email: str
    name: str
    role: Role
    institution: str | None
    designation: str


USERS: tuple[SeedUser, ...] = (
    {"email": "inst1@demo.in", "name": "Dr. K. Ramakrishna Rao", "role": "institution", "institution": "inst1",
     "designation": "Principal, Vasavi College of Engineering"},
    {"email": "inst2@demo.in", "name": "Dr. P. Lakshmi Narayana", "role": "institution", "institution": "inst2",
     "designation": "Director, Sri Venkateswara Institute of Technology"},
    {"email": "officer@demo.in", "name": "Anjali Deshmukh", "role": "officer", "institution": None,
     "designation": "Scrutiny Officer, South-Central Region"},
    {"email": "officer2@demo.in", "name": "Rahul Menon", "role": "officer", "institution": None,
     "designation": "Scrutiny Officer, Southern Region"},
    {"email": "approver@demo.in", "name": "Dr. S. Venkatesh", "role": "approver", "institution": None,
     "designation": "Deputy Director (Finance), AICTE"},
    {"email": "admin@demo.in", "name": "Meera Iyer", "role": "admin", "institution": None,
     "designation": "System Administrator, AICTE"},
    {"email": "auditor@demo.in", "name": "Arvind Kulkarni", "role": "auditor", "institution": None,
     "designation": "Internal Auditor, AICTE"},
)  # fmt: skip

DEMO_USER_EMAILS: tuple[str, ...] = tuple(u["email"] for u in USERS)

_password_hash: str | None = None


def seed_base(db: Db) -> None:
    global _password_hash
    if _password_hash is None:
        _password_hash = hash_password(DEMO_PASSWORD)
    created_at = clock.now(db)

    institution_ids = {key: upsert_institution(db, inst)["id"] for key, inst in INSTITUTIONS.items()}
    for u in USERS:
        insert_user_if_missing(
            db,
            {
                "name": u["name"],
                "email": u["email"],
                "passwordHash": _password_hash,
                "role": u["role"],
                "institutionId": institution_ids[u["institution"]] if u["institution"] else None,
                "designation": u["designation"],
                "createdAt": created_at,
            },
        )
    for rule in RULE_DEFAULTS:
        insert_rule_if_missing(db, rule)
