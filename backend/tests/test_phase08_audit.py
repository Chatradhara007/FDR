"""Phase 08 §8.3: audit trail, integrity check (AC5), document access log, reversible demo tamper."""

from __future__ import annotations

import pytest
from app.db.pool import get_pool, one
from app.domain.audit import verify_chain
from app.services import audit_service
from helpers import api, bearer, ready_fdr, reset_db, set_today, user_for

D0 = "2026-10-25"


@pytest.fixture(autouse=True)
def _fresh() -> None:
    reset_db()
    set_today(D0)
    audit_service.clear_integrity_cache()


def admin() -> dict[str, str]:
    return bearer(user_for("admin@demo.in"))


def auditor() -> dict[str, str]:
    return bearer(user_for("auditor@demo.in"))


def submitted_instrument() -> str:
    inst = user_for("inst1@demo.in")
    instrument_id = ready_fdr(inst)
    detail = api().get(f"/api/v1/instruments/{instrument_id}", headers=bearer(inst)).json()
    res = api().post(
        f"/api/v1/instruments/{instrument_id}/submit", headers=bearer(inst), json={"version": detail["version"]}
    )
    assert res.status_code == 200, res.text
    return instrument_id


def integrity(h: dict[str, str], fresh: bool = True) -> dict[str, object]:
    res = api().get(f"/api/v1/audit/integrity{'?fresh=1' if fresh else ''}", headers=h)
    assert res.status_code == 200
    body: dict[str, object] = res.json()
    return body


def test_ac5_integrity_ok_then_tamper_detected_then_undo_restores() -> None:
    submitted_instrument()
    fresh = integrity(auditor())
    assert fresh["ok"] is True and fresh["firstBrokenId"] is None and isinstance(fresh["checked"], int)
    assert fresh["checked"] > 0 and str(fresh["verifiedAt"]).endswith("Z")

    submitted = one(get_pool(), "SELECT id, after_json FROM events WHERE action = 'INSTRUMENT_SUBMITTED'")
    res = api().post("/api/v1/demo/tamper", headers=admin(), json={})
    assert res.status_code == 200 and res.json() == {"eventId": submitted["id"]}
    altered = one(get_pool(), "SELECT after_json FROM events WHERE id = $1", [submitted["id"]])["after_json"]
    assert altered != submitted["after_json"]

    # The tamper clears the cache, so even a cached read sees the break.
    broken = integrity(auditor(), fresh=False)
    assert broken["ok"] is False and broken["firstBrokenId"] == submitted["id"]
    assert verify_chain(get_pool())["firstBrokenId"] == submitted["id"]

    undo = api().post("/api/v1/demo/tamper/undo", headers=admin())
    assert undo.status_code == 200 and undo.json() == {"restored": [submitted["id"]]}
    assert verify_chain(get_pool())["ok"] is True
    assert integrity(auditor(), fresh=False)["ok"] is True
    restored = one(get_pool(), "SELECT after_json FROM events WHERE id = $1", [submitted["id"]])["after_json"]
    assert restored == submitted["after_json"]
    nothing = api().post("/api/v1/demo/tamper/undo", headers=admin())
    assert nothing.status_code == 409


def test_tamper_twice_still_undoes_to_the_original_and_a_chosen_event_can_be_tampered() -> None:
    submitted_instrument()
    first = one(get_pool(), "SELECT id, after_json FROM events ORDER BY id LIMIT 1")
    for _ in range(2):
        assert api().post("/api/v1/demo/tamper", headers=admin(), json={"eventId": first["id"]}).status_code == 200
    assert verify_chain(get_pool())["firstBrokenId"] == first["id"]
    assert api().post("/api/v1/demo/tamper/undo", headers=admin()).status_code == 200
    assert (
        one(get_pool(), "SELECT after_json FROM events WHERE id = $1", [first["id"]])["after_json"]
        == first["after_json"]
    )
    assert verify_chain(get_pool())["ok"] is True
    assert api().post("/api/v1/demo/tamper", headers=admin(), json={"eventId": 999999}).status_code == 404


def test_the_append_only_trigger_still_rejects_plain_updates() -> None:
    import psycopg

    submitted_instrument()
    with pytest.raises(psycopg.errors.RaiseException):
        one(get_pool(), "UPDATE events SET after_json = '{}'::jsonb WHERE id = 1 RETURNING id")


def test_tamper_routes_are_admin_only_and_404_without_demo_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    for h in (auditor(), bearer(user_for("officer@demo.in"))):
        assert api().post("/api/v1/demo/tamper", headers=h, json={}).status_code == 403
        assert api().post("/api/v1/demo/tamper/undo", headers=h).status_code == 403
    monkeypatch.setenv("DEMO_MODE", "false")
    assert api().post("/api/v1/demo/tamper", headers=admin(), json={}).status_code == 404
    assert api().post("/api/v1/demo/tamper/undo", headers=admin()).status_code == 404


def test_integrity_is_cached_for_30_seconds_unless_fresh() -> None:
    submitted_instrument()
    first = integrity(auditor(), fresh=False)
    api().post("/api/v1/auth/login", json={"email": "ghost@demo.in", "password": "nope12345"})  # adds an event
    assert integrity(auditor(), fresh=False) == first
    assert integrity(auditor(), fresh=True)["checked"] == int(str(first["checked"])) + 1


def test_events_list_filters_labels_and_sign_in_hiding() -> None:
    instrument_id = submitted_instrument()
    api().post("/api/v1/auth/login", json={"email": "ghost@demo.in", "password": "nope12345"})
    res = api().get("/api/v1/audit/events", headers=auditor())
    assert res.status_code == 200
    body = res.json()
    assert body["page"] == 1 and body["total"] == len(body["items"])
    ids = [e["id"] for e in body["items"]]
    assert ids == sorted(ids, reverse=True)
    assert body["items"][0]["action"] == "LOGIN_FAILED" and body["items"][0]["label"] == "Sign-in failed"

    hidden = api().get("/api/v1/audit/events?includeSignIns=false", headers=auditor()).json()
    assert hidden["total"] == body["total"] - 1
    assert all(e["action"] not in ("LOGIN_SUCCEEDED", "LOGIN_FAILED") for e in hidden["items"])
    # An explicit action filter wins over hiding sign-ins.
    only = api().get("/api/v1/audit/events?includeSignIns=false&action=LOGIN_FAILED", headers=auditor()).json()
    assert only["total"] == 1

    submitted = api().get("/api/v1/audit/events?action=INSTRUMENT_SUBMITTED", headers=auditor()).json()["items"]
    assert len(submitted) == 1 and submitted[0]["referenceNo"] == "SBIN/FDR/2026/00731"
    assert submitted[0]["label"] and submitted[0]["after"] is not None
    by_inst = api().get(f"/api/v1/audit/events?instrumentId={instrument_id}&pageSize=2", headers=auditor()).json()
    assert len(by_inst["items"]) == 2 and by_inst["total"] > 2
    assert all(e["instrumentId"] == instrument_id for e in by_inst["items"])
    actor = user_for("inst1@demo.in").id
    by_actor = api().get(f"/api/v1/audit/events?actorId={actor}&entityType=document", headers=auditor()).json()
    assert by_actor["total"] == 2 and {e["action"] for e in by_actor["items"]} == {"DOCUMENT_UPLOADED"}
    one_event = api().get(f"/api/v1/audit/events?eventId={submitted[0]['id']}", headers=auditor()).json()
    assert [e["id"] for e in one_event["items"]] == [submitted[0]["id"]]
    q = api().get("/api/v1/audit/events?q=ghost@demo", headers=auditor()).json()
    assert q["total"] == 1
    assert api().get("/api/v1/audit/events?q=100%25_", headers=auditor()).json()["total"] == 0  # LIKE wildcards escaped
    today = api().get(f"/api/v1/audit/events?from={D0}&to={D0}", headers=auditor()).json()
    assert today["total"] == body["total"]
    assert api().get("/api/v1/audit/events?from=2026-10-26", headers=auditor()).json()["total"] == 0
    bad = api().get("/api/v1/audit/events?from=yesterday&actorId=x", headers=auditor())
    assert bad.status_code == 422 and {d["field"] for d in bad.json()["details"]} == {"query.from", "query.actorId"}


def test_events_csv_export_is_recorded() -> None:
    submitted_instrument()
    res = api().get("/api/v1/audit/events?format=csv&action=INSTRUMENT_SUBMITTED", headers=auditor())
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    assert "fdr-audit-log-2026-10-25.csv" in res.headers["content-disposition"]
    lines = res.content.decode("utf-8-sig").strip().splitlines()
    assert lines[0].startswith("Event #,Time (UTC),Actor,Action,Description")
    assert len(lines) == 2 and "INSTRUMENT_SUBMITTED" in lines[1]
    export = one(get_pool(), "SELECT after_json FROM events WHERE action = 'REPORT_EXPORTED'")["after_json"]
    assert (
        export["preset"] == "audit-log"
        and export["rows"] == 1
        and export["filters"]["action"] == "INSTRUMENT_SUBMITTED"
    )


def test_document_access_log() -> None:
    instrument_id = submitted_instrument()
    officer = user_for("officer@demo.in")
    doc = api().get(f"/api/v1/instruments/{instrument_id}", headers=bearer(officer)).json()["documents"][0]
    for mode in ("download", "preview"):
        r = api().get(f"/api/v1/instruments/{instrument_id}/documents/{doc['id']}/{mode}", headers=bearer(officer))
        assert r.status_code == 200
    res = api().get(f"/api/v1/audit/document-access?instrumentId={instrument_id}", headers=auditor())
    assert res.status_code == 200
    rows = res.json()
    assert [(r["mode"], r["actorLabel"], r["role"]) for r in rows] == [
        ("preview", officer.name, "officer"), ("download", officer.name, "officer"),
    ]  # fmt: skip
    assert rows[0]["filename"] == doc["filename"] and rows[0]["docType"] == doc["docType"]
    assert rows[0]["referenceNo"] == "SBIN/FDR/2026/00731" and rows[0]["documentId"] == doc["id"]
    assert len(api().get("/api/v1/audit/document-access", headers=admin()).json()) == 2


def test_audit_endpoints_are_admin_and_auditor_only() -> None:
    for email in ("officer@demo.in", "approver@demo.in", "inst1@demo.in"):
        h = bearer(user_for(email))
        for path in ("/audit/events", "/audit/integrity", "/audit/document-access"):
            assert api().get(f"/api/v1{path}", headers=h).status_code == 403
