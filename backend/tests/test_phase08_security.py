"""Phase 08 §8.4: encryption at rest (AC6), route guard (AC7), auditor is read-only (AC8), headers, size limits,
startup checks."""

from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import Path

import pytest
from app.config import config
from app.db.pool import get_pool, one
from app.main import create_app
from app.middleware.auth import authenticate
from app.middleware.security import SECURITY_HEADERS
from app.security import InsecureConfig, check_startup_config
from app.services import storage
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from helpers import api, bearer, create_draft_via_api, pdf_bytes, reset_db, upload_doc, user_for

REPO = Path(__file__).resolve().parents[2]
# The unauthenticated routes, on purpose. `/verify/release/...` is the public release-order check behind the QR code:
# read-only, rate-limited, and it returns six fields (no amounts, no personal data). Adding a route here is a decision.
PUBLIC = {
    ("GET", "/api/v1/health"),
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/demo/users"),
    ("GET", "/api/v1/verify/release/{order_no:path}"),
}


@pytest.fixture(autouse=True)
def _fresh() -> None:
    reset_db()


# ---- AC6: documents are encrypted at rest ------------------------------------------------------------------------


def test_ac6_uploaded_files_are_encrypted_on_disk_and_downloads_return_the_original() -> None:
    inst = user_for("inst1@demo.in")
    instrument_id = create_draft_via_api(inst)["id"]
    data = pdf_bytes()
    res = upload_doc(inst, instrument_id, "FDR_COPY", data)
    assert res.status_code == 201
    doc_id = res.json()["document"]["id"]
    row = one(get_pool(), "SELECT storage_path, sha256, size_bytes FROM documents WHERE id = $1", [doc_id])
    on_disk = (config.storage_dir / row["storage_path"]).read_bytes()
    assert on_disk.startswith(b"FDE1") and on_disk != data and data not in on_disk
    assert len(on_disk) == 4 + 12 + len(data) + 16
    assert row["sha256"] == hashlib.sha256(data).hexdigest() and row["size_bytes"] == len(data)
    for mode in ("download", "preview"):
        got = api().get(f"/api/v1/instruments/{instrument_id}/documents/{doc_id}/{mode}", headers=bearer(inst))
        assert got.status_code == 200 and got.content == data
        assert got.headers["content-type"] == "application/pdf"


def test_legacy_plaintext_files_are_still_readable_and_a_corrupted_file_is_refused() -> None:
    legacy = f"{uuid.uuid4()}/{uuid.uuid4()}.pdf"
    path = storage.resolve_stored(legacy)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"%PDF-1.4 legacy")
    assert storage.read_stored(legacy) == b"%PDF-1.4 legacy"

    inst = user_for("inst1@demo.in")
    instrument_id = create_draft_via_api(inst)["id"]
    doc_id = upload_doc(inst, instrument_id, "FDR_COPY").json()["document"]["id"]
    stored = one(get_pool(), "SELECT storage_path FROM documents WHERE id = $1", [doc_id])["storage_path"]
    full = config.storage_dir / stored
    raw = bytearray(full.read_bytes())
    raw[20] ^= 0xFF
    full.write_bytes(bytes(raw))
    with pytest.raises(RuntimeError, match="integrity check"):
        storage.read_stored(stored)
    res = api().get(f"/api/v1/instruments/{instrument_id}/documents/{doc_id}/download", headers=bearer(inst))
    assert res.status_code == 500 and res.json()["code"] == "INTERNAL"


# ---- AC7: every route except the allow-list authenticates ---------------------------------------------------------


def api_routes() -> list[tuple[str, APIRoute]]:
    """(full path, route) for every /api/v1 route. FastAPI 0.16x wraps included routers in lazily resolved
    contexts; older versions list APIRoutes directly. Both are handled."""
    out: list[tuple[str, APIRoute]] = []
    for r in create_app().routes:
        if isinstance(r, APIRoute):
            out.append((r.path, r))
        elif hasattr(r, "effective_route_contexts"):
            for ctx in r.effective_route_contexts():
                if isinstance(ctx.original_route, APIRoute):
                    out.append((ctx.path, ctx.original_route))
    return [(p, r) for p, r in out if p.startswith("/api/v1")]


def _uses_authenticate(d: Dependant) -> bool:
    return d.call is authenticate or any(_uses_authenticate(sub) for sub in d.dependencies)


def test_ac7_every_api_route_requires_authentication_except_the_allow_list() -> None:
    routes = api_routes()
    assert len(routes) > 50
    unguarded = {(m, p) for p, r in routes for m in r.methods if not _uses_authenticate(r.dependant)}
    assert unguarded == PUBLIC
    # And at runtime: no token, no data.
    for p, r in routes:
        for m in r.methods:
            if (m, p) in PUBLIC:
                continue
            path = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), p)
            res = api().request(m, path)
            assert res.status_code == 401, (m, path, res.status_code)


# ---- AC8: the auditor reads everything and changes nothing --------------------------------------------------------


def test_ac8_auditor_reads_but_every_mutation_is_403() -> None:
    h = bearer(user_for("auditor@demo.in"))
    for path in ("/audit/events", "/audit/integrity", "/audit/document-access", "/dashboard", "/reports/register",
                 "/metrics/improvement", "/rules", "/scrutiny/queue", "/release-requests", "/instruments"):  # fmt: skip
        assert api().get(f"/api/v1{path}", headers=h).status_code == 200, path
    mutations = [
        (m, p)
        for p, r in api_routes()
        for m in r.methods
        if m in ("POST", "PUT", "PATCH", "DELETE") and (m, p) not in PUBLIC
    ]
    assert len(mutations) > 30
    modules = {p.split("/")[3] for _, p in mutations}
    assert {"instruments", "rules", "users", "clock", "jobs", "alerts", "release-requests", "demo"} <= modules
    for m, p in mutations:
        res = api().request(m, re.sub(r"\{[^}]+\}", str(uuid.uuid4()), p), headers=h, json={})
        assert res.status_code == 403, (m, p, res.status_code)


# ---- headers, limits, logs ----------------------------------------------------------------------------------------


def test_security_headers_on_every_response_and_cors_limited_to_the_frontend() -> None:
    for res in (
        api().get("/api/v1/health"),
        api().get("/api/v1/nowhere"),
        api().get("/api/v1/meta"),
        api().post("/api/v1/auth/login", json={}),
    ):
        for name, value in SECURITY_HEADERS.items():
            assert res.headers.get(name) == value, (res.request.url, name)
    ok = api().options(
        "/api/v1/meta", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    evil = api().options(
        "/api/v1/meta", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in evil.headers


def test_document_routes_keep_the_strict_frame_policy() -> None:
    """Change 4: previews open as blob URLs in a new tab (frontend/src/api/client.ts apiOpenInTab), never embedded in
    an iframe/object/embed, so the document routes keep `frame-ancestors 'none'` and `X-Frame-Options: DENY` like
    every other route. If a page ever embeds a document, this test fails: relax the policy for that route only."""
    inst = user_for("inst1@demo.in")
    instrument_id = create_draft_via_api(inst)["id"]
    doc_id = upload_doc(inst, instrument_id, "FDR_COPY").json()["document"]["id"]
    for mode in ("download", "preview"):
        res = api().get(f"/api/v1/instruments/{instrument_id}/documents/{doc_id}/{mode}", headers=bearer(inst))
        assert res.status_code == 200
        assert res.headers["x-frame-options"] == "DENY"
        assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
        assert res.headers["x-content-type-options"] == "nosniff"
    embeds = [
        p.relative_to(REPO).as_posix()
        for p in (REPO / "frontend" / "src").rglob("*.tsx")
        if re.search(r"<(iframe|object|embed)\b", p.read_text(encoding="utf-8"), re.IGNORECASE)
    ]
    assert embeds == []


def test_json_bodies_over_1_mb_are_refused() -> None:
    h = bearer(user_for("admin@demo.in"))
    big = '{"note": "' + "x" * (1024 * 1024) + '"}'
    res = api().post("/api/v1/jobs/evaluate", headers={**h, "Content-Type": "application/json"}, content=big)
    assert res.status_code == 413 and res.json()["code"] == "PAYLOAD_TOO_LARGE"
    assert res.headers["x-frame-options"] == "DENY"

    def chunks() -> object:
        yield big.encode()

    chunked = api().put(
        "/api/v1/rules/reminder",
        headers={**h, "Content-Type": "application/json"},
        content=chunks(),  # type: ignore[arg-type]
    )
    assert chunked.status_code == 413


def test_uploads_over_10_mb_are_refused() -> None:
    inst = user_for("inst1@demo.in")
    instrument_id = create_draft_via_api(inst)["id"]
    res = upload_doc(inst, instrument_id, "FDR_COPY", b"%PDF-1.4\n" + b"0" * (11 * 1024 * 1024))
    assert res.status_code == 413


def test_request_log_has_no_tokens(caplog: pytest.LogCaptureFixture) -> None:
    admin = user_for("admin@demo.in")
    with caplog.at_level("INFO", logger="fdr.request"):
        api().get("/api/v1/meta?token=secret-in-query", headers=bearer(admin))
    lines = [r.getMessage() for r in caplog.records if r.name == "fdr.request"]
    assert len(lines) == 1
    line = lines[0]
    assert line.startswith("GET /api/v1/meta 200 ") and f"user={admin.id}" in line and "request=" in line
    assert admin.token not in line and "secret-in-query" not in line


# ---- startup checks -----------------------------------------------------------------------------------------------


def test_startup_refuses_a_short_jwt_secret_unless_demo_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "short")
    monkeypatch.setenv("DEMO_MODE", "false")
    with pytest.raises(InsecureConfig, match="JWT_SECRET"):
        create_app()
    monkeypatch.setenv("DEMO_MODE", "true")
    check_startup_config()  # warns only


def test_startup_requires_a_valid_file_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.delenv("FILE_ENCRYPTION_KEY")
    with pytest.raises(InsecureConfig, match="FILE_ENCRYPTION_KEY is not set"):
        check_startup_config()
    monkeypatch.setenv("DEMO_MODE", "true")
    check_startup_config()  # DEMO_MODE derives a key from JWT_SECRET
    for bad, message in (("not base64!", "not valid base64"), ("c2hvcnQ=", "exactly 32 bytes")):
        monkeypatch.setenv("FILE_ENCRYPTION_KEY", bad)
        with pytest.raises(InsecureConfig, match=message):
            check_startup_config()
