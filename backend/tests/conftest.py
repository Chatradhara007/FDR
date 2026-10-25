"""Points the app at the test database before any app module reads DATABASE_URL.

Refuses to run without TEST_DATABASE_URL so a dev database is never dropped by accident. Tests share one
real database (fdr_test) and run serially.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

_test_url = os.environ.get("TEST_DATABASE_URL")
if not _test_url:
    raise RuntimeError("TEST_DATABASE_URL is not set; refusing to run tests against DATABASE_URL")
os.environ["DATABASE_URL"] = _test_url
os.environ["MOCK_BANK_URL"] = os.environ.get(
    "TEST_MOCK_BANK_URL", "http://127.0.0.1:9"
)  # unreachable unless a test starts one
os.environ["SCHEDULER_ENABLED"] = "false"  # the real-clock daily job never runs inside tests
os.environ["JWT_SECRET"] = "test-secret-at-least-32-bytes-long!"
# Uploaded files go to a throwaway directory, never the dev storage.
os.environ["STORAGE_DIR"] = os.path.join(tempfile.gettempdir(), f"fdr-test-storage-{os.getpid()}")


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    from app.db.migrate import migrate, reset_schema
    from app.db.pool import close_pool

    reset_schema()
    migrate()
    yield
    close_pool()
