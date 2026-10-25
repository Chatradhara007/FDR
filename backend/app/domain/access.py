from __future__ import annotations

from dataclasses import dataclass

from ..shared_constants import Role
from .audit import Actor
from .errors import NotFound


@dataclass(frozen=True)
class AuthUser:
    """The signed-in user, loaded from the DB by authenticate() on every request."""

    id: str
    name: str
    role: Role
    institutionId: str | None


def actor_of(user: AuthUser) -> Actor:
    return Actor(id=user.id, label=user.name)


def assert_can_see(user: AuthUser, institution_id: str, what: str = "Instrument") -> None:
    """Institution users may only see their own institution's records; others get 404, not 403 (rule 8)."""
    if user.role == "institution" and institution_id != user.institutionId:
        raise NotFound(f"{what} not found")


def scope_instruments_query(user: AuthUser, params: list[object], alias: str = "i") -> str:
    """SQL fragment restricting an instruments query to the user's institution (empty for AICTE roles).

    Appends the parameter to `params`; use as `WHERE true{scope_instruments_query(user, params)}`.
    """
    if user.role != "institution":
        return ""
    params.append(user.institutionId)
    return f" AND {alias}.institution_id = ${len(params)}"


def scope_alerts_query(user: AuthUser, params: list[object], alias: str = "a") -> str:
    """SQL fragment limiting alerts to the ones addressed to the user (D23); appends parameters to `params`.

    institution: its own institution's institution-role copies. officer: officer alerts addressed to them or to the
    pool. approver / admin: their role pool. auditor: everything (read-only oversight).
    """
    if user.role == "auditor":
        return ""
    params.append(user.role)
    sql = f" AND {alias}.recipient_role = ${len(params)}::user_role"
    if user.role == "institution":
        params.append(user.institutionId)
        sql += f" AND {alias}.institution_id = ${len(params)}"
    elif user.role == "officer":
        params.append(user.id)
        sql += f" AND ({alias}.recipient_user_id IS NULL OR {alias}.recipient_user_id = ${len(params)})"
    return sql


def scope_alert_stats_query(user: AuthUser, params: list[object], alias: str = "a") -> str:
    """Alert columns on instrument lists: AICTE roles see the instrument's worst open level across every copy (an item
    escalated to the admin shows as L3 in the officer's queue); institutions count only their own copies."""
    return scope_alerts_query(user, params, alias) if user.role == "institution" else ""
