"""Base dataset: institutions, demo users and default rules. Idempotent. Phase 9 layers the demo
instruments on top (docs/seed-spec.md)."""

from __future__ import annotations

import uuid
from typing import TypedDict

from ..db.pool import Db
from ..domain import clock
from ..domain.passwords import hash_password
from ..repositories.institution_repo import NewInstitution, upsert_institution
from ..repositories.rule_repo import insert_rule_if_missing
from ..repositories.user_repo import insert_user_if_missing
from ..shared_constants import RULE_DEFAULTS, Role

DEMO_PASSWORD = "Demo@123"

# Stable ids (uuid5) for the seeded institutions and users: a demo reset re-creates them with the same ids, so a
# signed-in session (the token names the user id) survives POST /demo/reset.
SEED_NAMESPACE = uuid.UUID("6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f")


def institution_uuid(key: str) -> str:
    return str(uuid.uuid5(SEED_NAMESPACE, f"institution:{key}"))


def user_uuid(email: str) -> str:
    return str(uuid.uuid5(SEED_NAMESPACE, f"user:{email.lower()}"))


def _inst(aicte_id: str, name: str, region: str, state: str, mail: str) -> NewInstitution:
    return {"aicte_id": aicte_id, "name": name, "region": region, "state": state,
            "contact_email": f"principal@{mail}.demo.in"}  # fmt: skip


# docs/seed-spec.md, "Institutions (12) and users" (synthetic).
INSTITUTIONS: dict[str, NewInstitution] = {
    "inst1": _inst("1-1234567890", "Vasavi Institute of Engineering & Technology, Hyderabad", "South-Central",
                   "Telangana", "vasavi"),
    "inst2": _inst("1-2345678901", "Godavari College of Engineering, Rajahmundry", "Southern", "Andhra Pradesh",
                   "godavari"),
    "inst3": _inst("1-3456789012", "Kaveri Institute of Technology, Mysuru", "South-West", "Karnataka", "kaveri"),
    "inst4": _inst("1-4567890123", "Narmada Polytechnic, Jabalpur", "Central", "Madhya Pradesh", "narmada"),
    "inst5": _inst("1-5678901234", "Sabarmati School of Management, Ahmedabad", "Western", "Gujarat", "sabarmati"),
    "inst6": _inst("1-6789012345", "Konkan College of Pharmacy, Ratnagiri", "Western", "Maharashtra", "konkan"),
    "inst7": _inst("1-7890123456", "Brahmaputra Institute of Technology, Guwahati", "Eastern", "Assam",
                   "brahmaputra"),
    "inst8": _inst("1-8901234567", "Hooghly Engineering College, Howrah", "Eastern", "West Bengal", "hooghly"),
    "inst9": _inst("1-9012345678", "Yamuna Institute of Architecture, Delhi", "Northern", "Delhi", "yamuna"),
    "inst10": _inst("1-0123456789", "Sutlej College of Engineering, Ludhiana", "North-West", "Punjab", "sutlej"),
    "inst11": _inst("1-1357924680", "Ganga Technical Campus, Varanasi", "Northern", "Uttar Pradesh", "ganga"),
    "inst12": _inst("1-2468013579", "Periyar Engineering College, Salem", "Southern", "Tamil Nadu", "periyar"),
}  # fmt: skip


class SeedUser(TypedDict):
    email: str
    name: str
    role: Role
    institution: str | None
    designation: str


_HEADS: tuple[tuple[str, str], ...] = (
    ("Dr. K. Ramakrishna Rao", "Principal"),
    ("Dr. P. Lakshmi Narayana", "Principal"),
    ("Dr. Shalini Hegde", "Director"),
    ("Shri Arun Tiwari", "Principal"),
    ("Dr. Nirav Mehta", "Director"),
    ("Dr. Sneha Patwardhan", "Principal"),
    ("Dr. Bhaskar Bora", "Director"),
    ("Dr. Moumita Sen", "Principal"),
    ("Ar. Kavita Malhotra", "Director"),
    ("Dr. Gurpreet Sandhu", "Principal"),
    ("Dr. Alok Mishra", "Director"),
    ("Dr. R. Senthil Kumar", "Principal"),
)


def _head(n: int, head: str, title: str) -> SeedUser:
    college = INSTITUTIONS[f"inst{n}"]["name"].split(",")[0]
    return {"email": f"inst{n}@demo.in", "name": head, "role": "institution", "institution": f"inst{n}",
            "designation": f"{title}, {college}"}  # fmt: skip


USERS: tuple[SeedUser, ...] = (
    *(_head(n, head, title) for n, (head, title) in enumerate(_HEADS, start=1)),
    {"email": "officer@demo.in", "name": "Anjali Deshmukh", "role": "officer", "institution": None,
     "designation": "Scrutiny Officer, South-Central & Southern"},
    {"email": "officer2@demo.in", "name": "Rahul Menon", "role": "officer", "institution": None,
     "designation": "Scrutiny Officer, Northern & Western"},
    {"email": "approver@demo.in", "name": "Dr. S. Venkatesh", "role": "approver", "institution": None,
     "designation": "Director, Regulation Bureau — competent authority"},
    {"email": "approver2@demo.in", "name": "Shri R. K. Malhotra", "role": "approver", "institution": None,
     "designation": "Deputy Secretary — second approver above ₹50 L"},
    {"email": "admin@demo.in", "name": "Meera Iyer", "role": "admin", "institution": None,
     "designation": "Portal Administrator"},
    {"email": "auditor@demo.in", "name": "Arvind Kulkarni", "role": "auditor", "institution": None,
     "designation": "Internal Audit (read-only)"},
)  # fmt: skip

DEMO_USER_EMAILS: tuple[str, ...] = tuple(u["email"] for u in USERS)

_password_hash: str | None = None


def seed_base(db: Db) -> None:
    global _password_hash
    if _password_hash is None:
        _password_hash = hash_password(DEMO_PASSWORD)
    created_at = clock.now(db)

    institution_ids = {
        key: upsert_institution(db, inst, institution_uuid(key))["id"] for key, inst in INSTITUTIONS.items()
    }
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
            user_uuid(u["email"]),
        )
    for rule in RULE_DEFAULTS:
        insert_rule_if_missing(db, rule)
