from __future__ import annotations

from fastapi.testclient import TestClient
from mock_bank.main import app


def test_health() -> None:
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
