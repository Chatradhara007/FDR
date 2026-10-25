"""authenticate / require_role as FastAPI dependencies.

authenticate verifies the bearer token, then loads the user: deactivated or deleted users are rejected immediately.
"""

from __future__ import annotations

import re
from collections.abc import Callable

import jwt
from fastapi import Depends, Request

from ..domain.access import AuthUser
from ..domain.errors import Forbidden, Unauthorized
from ..domain.token import verify_token
from ..services.auth_service import load_session_user
from ..shared_constants import ROLES, Role

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
ALL_ROLES: tuple[Role, ...] = ROLES
BEARER = re.compile(r"^Bearer (.+)$")


def authenticate(request: Request) -> AuthUser:
    match = BEARER.match(request.headers.get("authorization", ""))
    if not match:
        raise Unauthorized()
    try:
        payload = verify_token(match.group(1))
        sub = payload.get("sub")
        if not isinstance(sub, str) or not UUID.match(sub) or payload.get("role") not in ROLES:
            raise jwt.InvalidTokenError("bad claims")
    except jwt.InvalidTokenError:
        raise Unauthorized("Invalid or expired session") from None
    user = load_session_user(sub)
    if user is None:
        raise Unauthorized("Invalid or expired session")
    return user


def require_role(*roles: Role) -> Callable[[AuthUser], AuthUser]:
    def check(user: AuthUser = Depends(authenticate)) -> AuthUser:
        if user.role not in roles:
            raise Forbidden()
        return user

    return check
