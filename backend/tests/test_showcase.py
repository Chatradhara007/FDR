"""SHOWCASE_MODE=true: demo-only endpoints are refused (403), the tamper demonstration needs DEMO_MODE as well, startup
refuses placeholder secrets, and the sample data is seeded once (under a lock), never again."""

from __future__ import annotations

import re
import threading
import time

import pytest
from app import server
from app.security import InsecureConfig, check_startup_config
from helpers import api, bearer, reset_db, user_for
from test_phase08_security import api_routes

DEMO_ROUTES = [
    ("GET", "/api/v1/demo/users"),
    ("POST", "/api/v1/demo/reset"),
    ("POST", "/api/v1/demo/bank-correction"),
    ("GET", "/api/v1/demo/anchors"),
    ("GET", "/api/v1/demo/files/fdr-copy"),
    ("GET", "/api/v1/demo/files/bank-letter"),
]
TAMPER_ROUTES = [("POST", "/api/v1/demo/tamper"), ("POST", "/api/v1/demo/tamper/undo")]


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_db()
    monkeypatch.setenv("SHOWCASE_MODE", "true")


@pytest.mark.parametrize("demo_mode", ["false", "true"])
def test_every_demo_endpoint_is_403(monkeypatch: pytest.MonkeyPatch, demo_mode: str) -> None:
    monkeypatch.setenv("DEMO_MODE", demo_mode)
    client = api()
    mounted = {(m, p) for p, r in api_routes() if p.startswith("/api/v1/demo/") for m in r.methods}
    # Nothing under /demo/ is left out of this test.
    listed = {(m, re.sub(r"/files/[^/]+$", "/files/{name}", p)) for m, p in DEMO_ROUTES + TAMPER_ROUTES}
    assert mounted == listed
    admin = bearer(user_for("admin@demo.in"))
    for m, p in DEMO_ROUTES:
        for headers in ({}, admin):
            res = client.request(m, p, headers=headers, json={})
            assert res.status_code == 403, (m, p, res.status_code)
            assert res.json()["code"] == "FORBIDDEN"


def test_tamper_needs_demo_mode_too(monkeypatch: pytest.MonkeyPatch) -> None:
    admin = bearer(user_for("admin@demo.in"))
    monkeypatch.setenv("DEMO_MODE", "false")
    for m, p in TAMPER_ROUTES:
        assert api().request(m, p, headers=admin, json={}).status_code == 403
    monkeypatch.setenv("DEMO_MODE", "true")
    for m, p in TAMPER_ROUTES:  # reachable again (409: an empty audit trail has nothing to tamper or restore)
        assert api().request(m, p, headers=admin, json={}).status_code in (200, 409)


def test_off_by_default_nothing_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SHOWCASE_MODE")
    monkeypatch.setenv("DEMO_MODE", "true")
    assert api().get("/api/v1/demo/users").status_code == 200
    monkeypatch.setenv("DEMO_MODE", "false")
    assert api().get("/api/v1/demo/users").status_code == 404
    assert api().get("/api/v1/health").json()["showcaseMode"] is False


def test_flags_reach_the_ui() -> None:
    assert api().get("/api/v1/health").json()["showcaseMode"] is True
    meta = api().get("/api/v1/meta", headers=bearer(user_for("officer@demo.in"))).json()
    assert meta["showcaseMode"] is True


def test_startup_refuses_placeholder_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEMO_MODE", "true")  # DEMO_MODE does not soften SHOWCASE_MODE
    for secret in ("change-me-to-a-long-random-string", "dev-secret-change-me", "short"):
        monkeypatch.setenv("JWT_SECRET", secret)
        with pytest.raises(InsecureConfig, match="SHOWCASE_MODE=true needs a real JWT_SECRET"):
            check_startup_config()
    monkeypatch.setenv("JWT_SECRET", "x" * 48)
    monkeypatch.delenv("FILE_ENCRYPTION_KEY")
    with pytest.raises(InsecureConfig, match="SHOWCASE_MODE=true needs FILE_ENCRYPTION_KEY"):
        check_startup_config()
    monkeypatch.setenv("FILE_ENCRYPTION_KEY", "dGVzdC1maWxlLWtleS0zMi1ieXRlcy1sb25nLW9rISE=")
    check_startup_config()


def test_seeds_once_under_a_lock_and_never_again(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    seeded = threading.Event()

    def fake_seed() -> dict[str, int]:
        calls.append(1)
        time.sleep(0.3)  # the second starter must wait on the lock, then find the data
        seeded.set()
        return {"instruments": 1, "durationMs": 300}

    monkeypatch.setattr(server, "reset_and_seed", fake_seed)
    monkeypatch.setattr(server.demo_repo, "has_instruments", lambda _db: seeded.is_set())
    threads = [threading.Thread(target=server.seed_showcase_once) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert calls == [1]
    server.seed_showcase_once()  # a later restart
    assert calls == [1]
