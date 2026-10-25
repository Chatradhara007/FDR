from __future__ import annotations

import bcrypt


def _bytes(password: str) -> bytes:
    """bcrypt only uses the first 72 bytes (bcryptjs truncated silently; the Python library refuses longer input)."""
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bytes(password), bcrypt.gensalt(rounds=10)).decode()


def check_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(_bytes(password), password_hash.encode())
