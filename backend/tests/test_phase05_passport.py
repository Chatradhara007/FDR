"""Phase 05 acceptance checks 6–7: passport visibility by role (D24) and timeline labels from the one label map."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import httpx
import pytest
from app.domain.event_labels import label_for
from app.shared_constants import EVENT_LABELS, INSTITUTION_VISIBLE_ACTIONS, INSTRUMENT_STATUSES
from helpers import VALID_FDR, SeededUser, api, bearer, ready_fdr, reset_db, set_today, user_for
from httpx import Response

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def post(user: SeededUser, path: str, body: dict[str, Any] | None = None) -> Response:
    return api().post(f"/api/v1{path}", headers=bearer(user), json=body or {})


def get(user: SeededUser, path: str) -> Response:
    return api().get(f"/api/v1{path}", headers=bearer(user))


def ok(res: Response, status: int = 200) -> Any:
    assert res.status_code == status, res.text
    return res.json()


@pytest.fixture
def verified(bank_url: str, monkeypatch: pytest.MonkeyPatch) -> str:
    """An instrument under scrutiny with a bank MISMATCH (amount), one internal and one visible observation, and a
    document the officer opened."""
    monkeypatch.setenv("MOCK_BANK_URL", bank_url)
    reset_db()
    set_today("2026-10-25")
    record = {
        "bank": "State Bank of India", "reference_no": "SBIN/FDR/2026/00731", "amount": "2000000.00",
        "issue_date": "2026-04-01", "maturity_date": "2027-04-01", "beneficiary_name": "MEMBER SECRETARY AICTE",
        "lien_marked": True, "lien_in_favour_of": "Member Secretary, AICTE", "status": "LIVE",
    }  # fmt: skip
    assert httpx.post(f"{bank_url}/records/load", json={"records": [record]}).status_code == 200
    inst1, officer = user_for("inst1@demo.in"), user_for("officer@demo.in")
    instrument_id = ready_fdr(inst1, VALID_FDR)
    ok(post(inst1, f"/instruments/{instrument_id}/submit"))
    ok(post(officer, f"/instruments/{instrument_id}/claim"))
    assert ok(post(officer, f"/instruments/{instrument_id}/verify"))["result"] == "MISMATCH"
    obs = f"/instruments/{instrument_id}/observations"
    ok(post(officer, obs, {"text": "Internal: check branch", "severity": "INFO", "visibleToInstitution": False}), 201)
    ok(
        post(
            officer, obs, {"text": "Please send the lien letter", "severity": "CONCERN", "visibleToInstitution": True}
        ),
        201,
    )
    doc_id = ok(get(officer, f"/instruments/{instrument_id}"))["documents"][0]["id"]
    assert get(officer, f"/instruments/{instrument_id}/documents/{doc_id}/preview").status_code == 200
    return instrument_id


def test_ac6_institution_passport_hides_internal_items_and_officer_sees_them(verified: str) -> None:
    inst1, officer, inst2 = user_for("inst1@demo.in"), user_for("officer@demo.in"), user_for("inst2@demo.in")
    mine = ok(get(inst1, f"/instruments/{verified}/passport"))
    full = ok(get(officer, f"/instruments/{verified}/passport"))

    # Observations: only the visible one for the institution.
    assert [o["text"] for o in mine["observations"]] == ["Please send the lien letter"]
    assert {o["text"] for o in full["observations"]} == {"Internal: check branch", "Please send the lien letter"}
    # Verifications: outcome and per-field match, no raw payloads.
    (v,) = mine["verifications"]
    assert v["result"] == "MISMATCH" and v["fieldMatches"]["amount"] is False and v["fieldMatches"]["reference_no"]
    assert "requestPayload" not in v and "responsePayload" not in v and "requestedByName" not in v
    (fv,) = full["verifications"]
    assert fv["responsePayload"]["result"] == "MISMATCH" and fv["requestPayload"]["bank"] == "State Bank of India"
    assert "responsePayload" not in str(mine)
    # Timeline: no DOCUMENT_ACCESSED (nor any non-whitelisted action) for the institution.
    mine_actions = {e["action"] for e in mine["timeline"]}
    assert "DOCUMENT_ACCESSED" not in mine_actions and mine_actions <= set(INSTITUTION_VISIBLE_ACTIONS)
    assert {"DOCUMENT_ACCESSED", "OBSERVATION_ADDED", "INSTRUMENT_CLAIMED"} <= {e["action"] for e in full["timeline"]}
    accessed = next(e for e in full["timeline"] if e["action"] == "DOCUMENT_ACCESSED")
    assert accessed["label"] == f"Document viewed by {officer.name}" and accessed["icon"] == "view"
    # Discrepancies are internal; the institution's open problems omit the internal observation.
    assert mine["discrepancies"] == [] and full["discrepancies"][0]["fieldName"] == "amount"
    assert not any("Internal" in p["message"] for p in mine["summary"]["openProblems"])
    assert any(p["code"] == "OPEN_DISCREPANCY" for p in full["summary"]["openProblems"])
    # Another institution: 404, not 403 (rule 8).
    assert get(inst2, f"/instruments/{verified}/passport").status_code == 404


def test_passport_shape(verified: str) -> None:
    p = ok(get(user_for("officer@demo.in"), f"/instruments/{verified}/passport"))
    assert set(p) == {
        "instrument", "fields", "weakestTier", "chain", "documents", "verifications", "discrepancies", "observations",
        "returns", "alerts", "releaseRequests", "summary", "timeline",
    }  # fmt: skip
    assert [f["fieldName"] for f in p["fields"]][:3] == ["reference_no", "issuing_bank", "amount"]
    assert len(p["fields"]) == 7 and p["weakestTier"] == "CLAIMED"
    assert p["releaseRequests"] == [] and len(p["documents"]) == 2
    assert p["chain"] == [
        {
            "id": verified, "referenceNo": "SBIN/FDR/2026/00731", "issuingBank": "State Bank of India",
            "amount": "2500000.00", "issueDate": "2026-04-01", "maturityDate": "2027-04-01", "status": "UNDER_SCRUTINY",
            "depth": 0, "isCurrent": True, "gapDaysFromPrevious": None, "gapKind": None,
        }
    ]  # fmt: skip
    s = p["summary"]
    assert s["daysToMaturity"] == 158 and s["acceptedWithOverride"] is False and s["openAlertCount"] == 0
    # Timeline newest first, with app-clock times.
    ids = [e["id"] for e in p["timeline"]]
    assert ids == sorted(ids, reverse=True)
    assert p["timeline"][-1]["action"] == "INSTRUMENT_CREATED"
    assert all(e["at"].endswith("Z") for e in p["timeline"])


def _actions_in_code() -> set[str]:
    patterns = (
        r'action="([A-Z][A-Z_]+)"',  # record_event(..., action="X")
        r'_event\(\s*tx,\s*user,\s*"([A-Z][A-Z_]+)"',  # scrutiny_service._event(tx, user, "X", ...)
        r'_change\(\s*user,\s*"([A-Z][A-Z_]+)"',  # clock_service._change(user, "X", ...)
    )
    found: set[str] = set()
    for path in APP_DIR.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            found.update(re.findall(pattern, text))
    return found


def test_ac7_every_action_used_in_the_code_base_has_a_label() -> None:
    actions = _actions_in_code() | {f"STATUS_{s}" for s in INSTRUMENT_STATUSES}
    assert {"RENEWED_BY", "RENEWS", "RENEWAL_STARTED", "INSTRUMENT_CLAIMED", "CLOCK_ADVANCED"} <= actions
    assert sorted(a for a in actions if a not in EVENT_LABELS) == []
    assert set(INSTITUTION_VISIBLE_ACTIONS) <= set(EVENT_LABELS)


def test_ac7_timeline_labels_come_from_the_label_map(verified: str) -> None:
    p = ok(get(user_for("officer@demo.in"), f"/instruments/{verified}/passport"))
    for e in p["timeline"]:
        assert e["label"] == label_for(e["action"], e["before"], e["after"], e["actor"])
        assert e["label"]  # never empty
        if e["action"] not in ("VERIFICATION_RESULT", "DOCUMENT_ACCESSED"):
            assert e["label"] == EVENT_LABELS[e["action"]]
    result = next(e for e in p["timeline"] if e["action"] == "VERIFICATION_RESULT")
    assert result["label"] == "Bank verification: mismatch on amount"


def test_dynamic_labels() -> None:
    assert (
        label_for("RENEWED_BY", None, {"childId": "x", "referenceNo": "CNRB-0107"}, "Officer")
        == "Replaced by CNRB-0107"
    )
    assert label_for("RENEWS", None, {"parentId": "x", "referenceNo": "CNRB-0042"}, "Officer") == "Replaces CNRB-0042"
    assert label_for("ALERT_ESCALATED", None, {"role": "approver", "level": 2}, "system") == "Escalated to approver"
    assert label_for("VERIFICATION_RESULT", None, {"result": "CONFIRMED"}, "x") == "Bank verification: confirmed"
    assert label_for("STATUS_ACTIVE", None, {"status": "ACTIVE"}, "x") == EVENT_LABELS["STATUS_ACTIVE"]
    assert label_for("UNKNOWN_ACTION", None, None, "x") == "UNKNOWN_ACTION"
