"""Startup checks for secrets (Phase 8 §8.4). The app refuses to start with a weak setup unless DEMO_MODE is on."""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging

from .config import config

log = logging.getLogger("fdr")

MIN_JWT_SECRET = 32
# The values shipped in .env.example and docker-compose.yml; never acceptable for a showcase install.
PLACEHOLDER_JWT_SECRETS = frozenset({"change-me-to-a-long-random-string", "dev-secret-change-me"})


class InsecureConfig(RuntimeError):
    pass


def file_key() -> bytes:
    """The AES-256 key for documents at rest. Without FILE_ENCRYPTION_KEY a DEMO_MODE install derives one from
    JWT_SECRET (so dev files stay readable across restarts); anything else must configure a real key."""
    raw = config.file_encryption_key
    if raw is None:
        if not config.demo_mode:
            raise InsecureConfig("FILE_ENCRYPTION_KEY is not set (32 random bytes, base64)")
        return hashlib.sha256(b"fdr-file-key|" + config.jwt_secret.encode()).digest()
    try:
        key = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise InsecureConfig("FILE_ENCRYPTION_KEY is not valid base64") from None
    if len(key) != 32:
        raise InsecureConfig("FILE_ENCRYPTION_KEY must decode to exactly 32 bytes")
    return key


def check_startup_config() -> None:
    if config.showcase_mode:
        if config.jwt_secret in PLACEHOLDER_JWT_SECRETS or len(config.jwt_secret) < MIN_JWT_SECRET:
            raise InsecureConfig(
                "SHOWCASE_MODE=true needs a real JWT_SECRET (at least 32 random characters, not the placeholder). "
                'Generate one: python -c "import secrets;print(secrets.token_urlsafe(48))"'
            )
        if config.file_encryption_key is None:
            raise InsecureConfig(
                "SHOWCASE_MODE=true needs FILE_ENCRYPTION_KEY (32 random bytes, base64). "
                'Generate one: python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"'
            )
    if len(config.jwt_secret) < MIN_JWT_SECRET:
        if not config.demo_mode:
            raise InsecureConfig(f"JWT_SECRET must be at least {MIN_JWT_SECRET} characters (DEMO_MODE is off)")
        log.warning("JWT_SECRET is shorter than %d characters; acceptable only because DEMO_MODE=true", MIN_JWT_SECRET)
    file_key()
    if config.file_encryption_key is None:
        log.warning("FILE_ENCRYPTION_KEY is not set; using a key derived from JWT_SECRET (DEMO_MODE only)")
