"""Phase 07 acceptance checks 5 and 7: report presets (JSON + CSV with BOM, REPORT_EXPORTED) and improvement metrics."""

from __future__ import annotations

import csv
import io
from typing import Any

import pytest
from app.db.pool import exec_, get_pool, many, transaction
from app.domain.audit import Actor, record_event
from app.services.report_service import PRESETS
from app.shared_constants import SIMULATED_LABEL
from helpers import evaluate_on, make_instrument, reset_db, set_today, user_for
from phase07_helpers import add_discrepancy, add_release_request, get, ok

D0 = "2026-10-25"


@pytest.fixture(autouse=True)
def _db() -> None:
    reset_db()
    set_today(D0)


def seed() -> None:
    a = make_instrument("ACTIVE", "2026-12-01", amount="2000000.00")
    make_instrument(
        "UNDER_SCRUTINY", "2027-06-01", verification_state="UNVERIFIED", submitted_at="2026-10-20T05:00:00Z"
    )
    make_instrument("LAPSED", "2026-08-01", institution_email="inst2@demo.in")
    add_discrepancy(a)
    add_release_request(make_instrument("RELEASE_REQUESTED", "2027-06-01"), user_for("inst1@demo.in").id,
                        "PENDING_CONDITIONS", 1)  # fmt: skip


def export_events() -> list[dict[str, Any]]:
    return many(get_pool(), "SELECT actor_id, after_json FROM events WHERE action = 'REPORT_EXPORTED' ORDER BY id")


@pytest.mark.parametrize("preset", list(PRESETS))
def test_ac5_each_preset_json_and_csv(preset: str) -> None:
    seed()
    officer = user_for("officer@demo.in")
    report = ok(get(officer, f"/reports/{preset}"))
    assert report["preset"] == preset and report["asOf"] == D0
    assert report["total"] == len(report["rows"]) > 0, preset
    assert export_events() == []  # the JSON preview is not an export

    res = get(officer, f"/reports/{preset}?format=csv")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/csv")
    assert f'filename="fdr-{preset}-{D0}.csv"' in res.headers["content-disposition"]
    raw = res.content
    assert raw.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM so Excel reads it as UTF-8
    lines = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    assert lines[0] == [c["label"] for c in report["columns"]]
    assert len(lines) - 1 == report["total"]

    events = export_events()
    assert len(events) == 1
    assert events[0]["actor_id"] == officer.id
    assert events[0]["after_json"]["preset"] == preset
    assert events[0]["after_json"]["rows"] == report["total"]
    assert "filters" in events[0]["after_json"]


def test_ac5_csv_values_filters_and_access() -> None:
    seed()
    officer = user_for("auditor@demo.in")
    res = get(officer, "/reports/register?format=csv&status=ACTIVE&region=South-Central")
    rows = list(csv.DictReader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert len(rows) == 1
    assert rows[0]["Amount (₹)"] == "2000000.00" and rows[0]["Maturity date"] == "2026-12-01"
    assert rows[0]["Status"] == "Active"
    after = export_events()[0]["after_json"]
    assert after["filters"] == {"region": "South-Central", "status": ["ACTIVE"]} and after["rows"] == 1
    expiring = ok(get(officer, "/reports/expiring?days=60"))
    assert [r["maturityDate"] for r in expiring["rows"]] == ["2026-12-01"]
    assert ok(get(officer, "/reports/discrepancies"))["rows"][0]["fieldName"] == "amount"
    assert ok(get(officer, "/reports/lapsed"))["rows"][0]["daysOverdue"] == 85
    assert get(user_for("inst1@demo.in"), "/reports/register").status_code == 403
    assert get(user_for("inst1@demo.in"), "/reports/register?format=csv").status_code == 403
    assert get(officer, "/reports/nope").status_code == 404
    assert get(officer, "/reports/register?format=xml").status_code == 422
    assert len(export_events()) == 1


def test_ac7_improvement_metrics_on_empty_data() -> None:
    data = ok(get(user_for("auditor@demo.in"), "/metrics/improvement"))
    assert data["label"] == SIMULATED_LABEL
    assert all(m["label"] == SIMULATED_LABEL for m in data["metrics"])
    by = {m["key"]: m for m in data["metrics"]}
    assert by["verification"]["portal"] == {"value": None, "display": "No data yet"}
    assert by["verification"]["manual"]["value"] == 21 * 24
    assert by["steps"]["portal"]["value"] == 5 and by["steps"]["manual"]["value"] == 14


def test_ac7_improvement_metrics_on_data_and_baseline_from_rule() -> None:
    officer = user_for("officer@demo.in")
    inst = make_instrument("ACTIVE", "2026-12-04")  # 40 days to maturity
    actor = Actor(id=officer.id, label=officer.name)
    with transaction() as tx:
        record_event(tx, actor=actor, action="INSTRUMENT_SUBMITTED", entity_type="instrument", entity_id=inst,
                     instrument_id=inst)  # fmt: skip
    set_today("2026-10-26")
    with transaction() as tx:
        record_event(tx, actor=actor, action="VERIFICATION_RESULT", entity_type="verification", entity_id=inst,
                     instrument_id=inst, after={"result": "CONFIRMED"})  # fmt: skip
    evaluate_on("2026-10-26")  # 90-day reminder, 39 days ahead
    evaluate_on("2026-12-04")  # matured; overdue-renewal alert
    exec_(
        get_pool(),
        "UPDATE rules SET config = jsonb_set(config, '{manualStepsPerCase}', '20') WHERE key = 'improvement_baseline'",
    )

    data = ok(get(officer, "/metrics/improvement"))
    by = {m["key"]: m for m in data["metrics"]}
    assert by["verification"]["portal"]["value"] == 24.0
    assert by["caughtBeforeExpiry"]["portal"]["value"] == 100.0
    assert by["lapseDetection"]["portal"]["value"] == 0.0
    assert by["autoProblems"]["portal"]["value"] >= 1
    assert by["steps"]["manual"]["value"] == 20  # baseline comes only from the rule

    res = get(officer, "/metrics/improvement?format=csv")
    assert res.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.DictReader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert {r["Basis"] for r in rows} == {SIMULATED_LABEL}
    assert rows[0]["Manual baseline"] == "504 hours"
    assert export_events()[-1]["after_json"] == {"preset": "improvement", "filters": {}, "rows": len(rows)}
    assert get(user_for("inst1@demo.in"), "/metrics/improvement").status_code == 403
