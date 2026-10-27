"""Settings read from the environment on every access (tests change some of them at runtime).

The repo-root .env is loaded for local dev; it never overrides variables that are already set,
so Docker / CI / test values win.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env", override=False)


class Config:
    @property
    def port(self) -> int:
        return int(os.environ.get("PORT", "3000"))

    @property
    def database_url(self) -> str:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL is not set (copy .env.example to .env)")
        return url

    @property
    def mock_bank_url(self) -> str:
        return os.environ.get("MOCK_BANK_URL", "http://localhost:4000")

    @property
    def frontend_origins(self) -> list[str]:
        return [s.strip() for s in os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173").split(",")]

    @property
    def public_base_url(self) -> str:
        """PUBLIC_BASE_URL: where the portal's pages are reachable by whoever scans a release order's QR code (for a
        phone on the demo laptop's Wi-Fi: http://<laptop LAN address>:5173). Defaults to the first frontend origin."""
        explicit = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
        return explicit or self.frontend_origins[0].rstrip("/")

    @property
    def demo_mode(self) -> bool:
        return os.environ.get("DEMO_MODE") == "true"

    @property
    def storage_dir(self) -> Path:
        """Uploaded files live here (STORAGE_DIR; relative paths resolve against the repo root)."""
        return (REPO_ROOT / os.environ.get("STORAGE_DIR", "./storage")).resolve()

    @property
    def scheduler_enabled(self) -> bool:
        """Daily evaluation in REAL clock mode (SCHEDULER_ENABLED=false turns it off; tests do)."""
        return os.environ.get("SCHEDULER_ENABLED", "true") != "false"

    @property
    def jwt_secret(self) -> str:
        return os.environ.get("JWT_SECRET", "dev-secret-change-me")

    @property
    def file_encryption_key(self) -> str | None:
        """FILE_ENCRYPTION_KEY: 32 random bytes, base64 (`python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`)."""
        return os.environ.get("FILE_ENCRYPTION_KEY") or None


config = Config()
