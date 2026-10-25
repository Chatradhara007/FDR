"""JWT expiry uses wall time by design (CLAUDE.md rule 2 exception)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt

from ..config import config


def sign_token(user_id: str, role: str, institution_id: str | None, expires_in: timedelta = timedelta(hours=8)) -> str:
    issued = datetime.now(UTC)
    payload = {"role": role, "institutionId": institution_id, "sub": user_id, "iat": issued, "exp": issued + expires_in}
    return jwt.encode(payload, config.jwt_secret, algorithm="HS256")


def verify_token(token: str) -> dict[str, object]:
    """Raises jwt.InvalidTokenError when the token is malformed, tampered with or expired."""
    return jwt.decode(token, config.jwt_secret, algorithms=["HS256"])
