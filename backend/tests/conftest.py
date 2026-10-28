"""Points the app at the test database before any app module reads DATABASE_URL.

Refuses to run without TEST_DATABASE_URL so a dev database is never dropped by accident. Tests share one
real database (fdr_test) and run serially.
"""

from __future__ import annotations

import os
import socket
import tempfile
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import uvicorn
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

_test_url = os.environ.get("TEST_DATABASE_URL")
if not _test_url:
    raise RuntimeError("TEST_DATABASE_URL is not set; refusing to run tests against DATABASE_URL")
os.environ["DATABASE_URL"] = _test_url
os.environ["MOCK_BANK_URL"] = os.environ.get(
    "TEST_MOCK_BANK_URL", "http://127.0.0.1:9"
)  # unreachable unless a test starts one
# Hermetic modes: an .env or shell SHOWCASE_MODE/DEMO_MODE never changes the result. test_showcase.py turns
# showcase mode on itself with monkeypatch.
os.environ["SHOWCASE_MODE"] = "false"
os.environ["DEMO_MODE"] = "true"
os.environ["SCHEDULER_ENABLED"] = "false"  # the real-clock daily job never runs inside tests
os.environ["JWT_SECRET"] = "test-secret-at-least-32-bytes-long!"
# A fixed test key for documents at rest (32 bytes, base64), so tests never depend on DEMO_MODE's derived key.
os.environ["FILE_ENCRYPTION_KEY"] = "dGVzdC1maWxlLWtleS0zMi1ieXRlcy1sb25nLW9rISE="
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


# The real mock bank under uvicorn in a background thread (an external system on a real port), shared by the
# scrutiny (Phase 03) and renewal (Phase 05) tests.
BANK_ENV = {
    "MOCK_BANK_OFFLINE_BANKS": "Indian Overseas Bank",
    "MOCK_BANK_SLOW_BANKS": "Bank of India",
    "MOCK_BANK_SLOW_SECONDS": "1",
}


@pytest.fixture(scope="session")
def bank_url(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    os.environ.update(BANK_ENV)
    os.environ["MOCK_BANK_DATA_FILE"] = str(tmp_path_factory.mktemp("bank") / "records.json")
    from mock_bank.main import app as bank_app

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(bank_app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(f"{url}/health").status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.05)
    yield url
    server.should_exit = True
    thread.join(5)
