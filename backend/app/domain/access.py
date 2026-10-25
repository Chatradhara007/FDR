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
