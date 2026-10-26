"""Phase 08 §8.1: rules administration (AC1–AC3, AC8 for rules) and the semantic validation of every rule type."""

from __future__ import annotations

from typing import Any

import pytest
from app.db.pool import get_pool, many, one
from app.shared_constants import RULE_DEFAULTS
from helpers import alerts_of, api, bearer, make_instrument, reset_db, set_today, user_for

D0 = "2026-10-25"
DEFAULTS = {r["key"]: r["config"] for r in RULE_DEFAULTS}


@pytest.fixture(autouse=True)
def _fresh() -> None:
    reset_db()
    set_today(D0)


def admin() -> dict[str, str]:
    return bearer(user_for("admin@demo.in"))


def rule(key: str) -> dict[str, Any]:
    res = api().get("/api/v1/rules", headers=admin())
    assert res.status_code == 200
    found: dict[str, Any] = next(r for r in res.json() if r["key"] == key)
    return found


def put(key: str, config: object, version: int | None = None, active: bool = True) -> Any:
    v = rule(key)["version"] if version is None else version
    return api().put(f"/api/v1/rules/{key}", headers=admin(), json={"config": config, "active": active, "version": v})


def fields(res: Any) -> dict[str, str]:
    assert res.status_code == 422, res.text
    return {d["field"]: d["message"] for d in res.json()["details"]}


def test_list_returns_every_rule_with_its_default_and_version() -> None:
    res = api().get("/api/v1/rules", headers=bearer(user_for("auditor@demo.in")))
    assert res.status_code == 200
    rules = res.json()
    assert [r["key"] for r in rules] == [r["key"] for r in RULE_DEFAULTS]
    for r in rules:
        assert r["config"] == r["defaultConfig"] == DEFAULTS[r["key"]]
        assert r["active"] is True and r["version"] == 1 and r["updatedAt"] is None
    assert "recipients" not in rules[[r["key"] for r in rules].index("release_pending")]["config"]


def _process_time(day: str) -> None:
    res = api().post("/api/v1/clock/set", headers=admin(), json={"date": day})
    assert res.status_code == 200


def test_ac1_reminder_offsets_45_15_then_restore_default() -> None:
    inst_40 = make_instrument("ACTIVE", "2026-12-04")  # 40 days left on D0
    inst_10 = make_instrument("ACTIVE", "2026-11-04")  # 10 days left
    res = put(
        "reminder", {"offsets": [{"days": 15, "recipients": ["officer"]}, {"days": 45, "recipients": ["officer"]}]}
    )
    assert res.status_code == 200, res.text
    assert [o["days"] for o in res.json()["config"]["offsets"]] == [45, 15]  # stored normalised, largest first
    assert api().post("/api/v1/jobs/evaluate", headers=admin()).status_code == 200
    keys = {a["rule_key"] for i in (inst_40, inst_10) for a in alerts_of(i)}
    assert keys == {"maturity:45", "maturity:15"}
    live_10 = [a["rule_key"] for a in alerts_of(inst_10) if a["status"] != "RESOLVED"]
    assert live_10 == ["maturity:15"]
    assert [a["rule_key"] for a in alerts_of(inst_40)] == ["maturity:45"]

    restored = api().post("/api/v1/rules/reminder/restore-default", headers=admin())
    assert restored.status_code == 200
    assert [o["days"] for o in restored.json()["config"]["offsets"]] == [90, 60, 30, 7]
    inst_25 = make_instrument("ACTIVE", "2026-11-19")  # 25 days left
    _process_time(D0)
    assert {a["rule_key"] for a in alerts_of(inst_25) if a["status"] != "RESOLVED"} == {"maturity:30"}


def test_ac2_invalid_configs_are_rejected_with_field_details() -> None:
    weights = {**DEFAULTS["risk_weights"], "amount": 0.5}  # type: ignore[dict-item]
    assert fields(put("risk_weights", weights)) == {"config": "Weights must add up to 1.00 (now 1.20)"}

    ladder = {
        "levels": [
            {"level": 1, "role": "officer", "afterDays": 0},
            {"level": 2, "role": "approver", "afterDays": 10},
            {"level": 3, "role": "admin", "afterDays": 5},
        ],
        "kinds": ["PENDING_VERIFICATION"],
    }
    assert "config.levels" in fields(put("escalation", ladder))
    same = {
        **ladder,
        "levels": [{"level": 1, "role": "officer", "afterDays": 0}, {"level": 2, "role": "approver", "afterDays": 0}],
    }
    assert "config.levels" in fields(put("escalation", same))
    bad_role = {**ladder, "levels": [{"level": 1, "role": "auditor", "afterDays": 0}]}
    assert fields(put("escalation", bad_role)) == {"config.levels.0.role": "Choose officer, approver or admin"}

    docs = fields(put("required_docs", {"FDR": ["FDR_COPY", "PASSPORT"], "SECURITY_DEPOSIT": []}))
    assert docs == {"config.FDR": "Unknown document type", "config.SECURITY_DEPOSIT": "Require at least one document"}
    assert fields(put("required_docs", {"FDR": ["RELEASE_LETTER"], "SECURITY_DEPOSIT": ["DEPOSIT_CONFIRMATION"]})) == {
        "config.FDR": "Unknown document type"
    }

    reminders = fields(
        put("reminder", {"offsets": [{"days": 0, "recipients": ["auditor"]}, {"days": 0, "recipients": []}]})
    )
    assert reminders == {
        "config.offsets.0.days": "Must be at least 1",
        "config.offsets.0.recipients": "Reminders go to institution, officer, approver or admin",
        "config.offsets.1.days": "Must be at least 1",
        "config.offsets.1.recipients": "Choose at least one recipient",
    }
    assert fields(put("reminder", {"offsets": []})) == {"config.offsets": "Add at least one reminder offset"}

    levels = {**DEFAULTS["approval_levels"]}  # type: ignore[dict-item]
    levels["levels"] = [{"level": 1, "role": "approver", "action": "DECIDE", "label": "Decide"}]
    assert fields(put("approval_levels", levels)) == {
        "config.levels": "Level 1 must be the scrutiny officer's recommendation"
    }
    levels["levels"] = [{"level": 1, "role": "officer", "action": "RECOMMEND", "label": "Recommend"}]
    assert fields(put("approval_levels", levels)) == {"config.levels": "The last level must decide"}
    levels = {**DEFAULTS["approval_levels"], "extraApprovalAbove": "-5"}  # type: ignore[dict-item]
    assert fields(put("approval_levels", levels)) == {"config.extraApprovalAbove": "Enter an amount"}

    conditions = {"conditions": [
        {"code": "NO_OPEN_DISCREPANCY", "auto": True, "mandatory": True, "description": "a"},
        {"code": "NO_OPEN_DISCREPANCY", "auto": True, "mandatory": True, "description": "b"},
    ]}  # fmt: skip
    assert fields(put("release_conditions", conditions)) == {"config.conditions": "Each condition code once"}
    conditions = {"conditions": [{"code": "MAGIC_CHECK", "auto": True, "mandatory": True, "description": "a"}]}
    assert fields(put("release_conditions", conditions)) == {
        "config.conditions": "No automatic check exists for MAGIC_CHECK"
    }
    assert fields(put("lien_required", {"FDR": "yes", "SECURITY_DEPOSIT": False})) == {"config.FDR": "Choose yes or no"}

    # Every rejection left the stored rules untouched.
    assert all(r["version"] == 1 for r in api().get("/api/v1/rules", headers=admin()).json())


def test_release_pending_has_no_recipients() -> None:
    bad = fields(put("release_pending", {"afterDays": 5, "recipients": ["approver"]}))
    assert list(bad) == ["config.recipients"]
    ok = put("release_pending", {"afterDays": 3})
    assert ok.status_code == 200 and ok.json()["config"] == {"afterDays": 3}


def test_ac3_rule_updated_event_has_before_and_after() -> None:
    res = put("pending_verification", {"afterDays": 9, "recipients": ["officer", "approver"]})
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == 2 and body["updatedByName"] and body["updatedAt"]
    restore = api().post("/api/v1/rules/pending_verification/restore-default", headers=admin())
    assert restore.status_code == 200 and restore.json()["version"] == 3
    events = many(
        get_pool(), "SELECT actor_label, before_json, after_json FROM events WHERE action = 'RULE_UPDATED' ORDER BY id"
    )
    assert len(events) == 2
    first, second = events
    assert first["before_json"] == {
        "key": "pending_verification",
        "config": DEFAULTS["pending_verification"],
        "active": True,
    }
    assert first["after_json"] == {
        "key": "pending_verification",
        "config": {"afterDays": 9, "recipients": ["officer", "approver"]},
        "active": True,
    }
    assert second["before_json"]["config"] == {"afterDays": 9, "recipients": ["officer", "approver"]}
    assert second["after_json"] == {
        "key": "pending_verification",
        "config": DEFAULTS["pending_verification"],
        "active": True,
        "restoredDefault": True,
    }


def test_stale_version_unknown_rule_and_access() -> None:
    assert put("risk_weights", DEFAULTS["risk_weights"], version=1).status_code == 200
    stale = put("risk_weights", DEFAULTS["risk_weights"], version=1)
    assert stale.status_code == 409 and stale.json()["code"] == "STALE_VERSION"
    missing = api().put("/api/v1/rules/nope", headers=admin(), json={"config": {}, "version": 1})
    assert missing.status_code == 404
    assert api().post("/api/v1/rules/nope/restore-default", headers=admin()).status_code == 404
    no_version = api().put("/api/v1/rules/reminder", headers=admin(), json={"config": DEFAULTS["reminder"]})
    assert fields(no_version) == {"version": "version is required"}
    for email in ("auditor@demo.in", "officer@demo.in", "approver@demo.in", "inst1@demo.in"):
        h = bearer(user_for(email))
        assert (
            api()
            .put("/api/v1/rules/reminder", headers=h, json={"config": DEFAULTS["reminder"], "version": 1})
            .status_code
            == 403
        )
        assert api().post("/api/v1/rules/reminder/restore-default", headers=h).status_code == 403
    for email in ("officer@demo.in", "approver@demo.in", "inst1@demo.in"):
        assert api().get("/api/v1/rules", headers=bearer(user_for(email))).status_code == 403


def test_saved_rules_are_read_by_the_services() -> None:
    """Required documents and risk weights saved through the editor take effect on the next operation."""
    res = put("required_docs", {"FDR": ["FDR_COPY"], "SECURITY_DEPOSIT": ["DEPOSIT_CONFIRMATION", "LIEN_LETTER"]})
    assert res.status_code == 200
    inst = make_instrument("UNDER_SCRUTINY", "2027-10-01")
    detail = api().get(f"/api/v1/instruments/{inst}", headers=admin()).json()
    assert detail["requiredDocs"] == ["FDR_COPY"]
    weights = {**DEFAULTS["risk_weights"], "amount": 0.1, "urgency": 0.5}  # type: ignore[dict-item]
    assert put("risk_weights", weights).status_code == 200
    stored = one(get_pool(), "SELECT config FROM rules WHERE key = 'risk_weights'")["config"]
    assert stored["amount"] == 0.1 and stored["urgency"] == 0.5
