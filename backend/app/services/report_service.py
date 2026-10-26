"""Report presets (§7.5): JSON for the preview, CSV (UTF-8 with BOM) for download. Every CSV export writes
REPORT_EXPORTED with the preset, the filters and the row count."""

from __future__ import annotations

import csv
import io
import uuid
from collections.abc import Callable, Mapping, Sequence
from datetime import date, timedelta
from typing import Literal, TypedDict

from ..db.pool import Db, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of
from ..domain.audit import record_event
from ..domain.errors import NotFound
from ..repositories import report_repo as rr
from ..repositories.instrument_repo import ListFilters, list_instruments
from ..schemas import ReportQuery
from ..shared_constants import (
    FIELD_LABELS,
    LIVE_STATUSES,
    RELEASE_REQUEST_STATUS_LABELS,
    REPORT_PRESETS,
    STATUS_LABELS,
    VERIFICATION_RESULT_LABELS,
    VERIFICATION_STATE_LABELS,
    InstrumentStatus,
)
from .institution_service import all_institution_summaries

ColumnKind = Literal["text", "date", "amount", "int", "status", "verification", "result", "releaseStatus", "field"]
ALL_ROWS = 100_000
BOM = "﻿"


class Column(TypedDict):
    key: str
    label: str
    kind: ColumnKind


class Report(TypedDict):
    preset: str
    title: str
    asOf: str
    filters: dict[str, object]
    columns: list[Column]
    rows: list[dict[str, object]]
    total: int


def _c(key: str, label: str, kind: ColumnKind = "text") -> Column:
    return {"key": key, "label": label, "kind": kind}


REF = _c("referenceNo", "Reference no.")
INST = _c("institutionName", "Institution")
REGION = _c("region", "Region")
BANK = _c("issuingBank", "Bank")
AMOUNT = _c("amount", "Amount (₹)", "amount")
STATUS = _c("status", "Status", "status")
VERIF = _c("verificationState", "Verification", "verification")

REGISTER_COLUMNS = [
    REF, _c("type", "Type"), INST, REGION, BANK, AMOUNT, _c("issueDate", "Issue date", "date"),
    _c("maturityDate", "Maturity date", "date"), _c("daysToMaturity", "Days to maturity", "int"), STATUS, VERIF,
]  # fmt: skip


def _filters(q: ReportQuery) -> rr.InstrumentFilter:
    return {"region": q.region, "type": q.type, "bank": q.bank, "institutionId": q.institution_id}


def _register_rows(db: Db, q: ReportQuery, today: str, statuses: list[InstrumentStatus] | None,
                   maturity_from: str | None, maturity_to: str | None) -> list[dict[str, object]]:  # fmt: skip
    f: ListFilters = {
        "status": statuses, "type": q.type, "bank": q.bank, "region": q.region, "institutionId": q.institution_id,
        "q": None, "maturityFrom": maturity_from, "maturityTo": maturity_to, "sort": "maturityDate", "page": 1,
        "pageSize": ALL_ROWS,
    }  # fmt: skip
    items, _ = list_instruments(db, f, today, lambda p: "", lambda p: "")
    return [dict(i) for i in items]


def _register(db: Db, q: ReportQuery, today: str) -> tuple[list[Column], list[dict[str, object]], dict[str, object]]:
    rows = _register_rows(db, q, today, q.status, q.maturity_from, q.maturity_to)
    return REGISTER_COLUMNS, rows, {"status": q.status, "maturityFrom": q.maturity_from, "maturityTo": q.maturity_to}


def _expiring(db: Db, q: ReportQuery, today: str) -> tuple[list[Column], list[dict[str, object]], dict[str, object]]:
    until = (date.fromisoformat(today) + timedelta(days=q.days)).isoformat()
    rows = _register_rows(db, q, today, list(LIVE_STATUSES), today, until)
    return REGISTER_COLUMNS, rows, {"days": q.days}


def _pending(db: Db, q: ReportQuery, today: str) -> tuple[list[Column], list[dict[str, object]], dict[str, object]]:
    cols = [REF, INST, REGION, BANK, AMOUNT, STATUS, VERIF, _c("submittedOn", "Submitted on", "date"),
            _c("ageingDays", "Ageing (days)", "int"), _c("lastResult", "Last bank result", "result")]  # fmt: skip
    return cols, rr.pending_verification_rows(db, _filters(q), today), {}


def _discrepancies(
    db: Db, q: ReportQuery, today: str
) -> tuple[list[Column], list[dict[str, object]], dict[str, object]]:
    cols = [REF, INST, BANK, _c("fieldName", "Field", "field"), _c("claimedValue", "Institution claimed"),
            _c("confirmedValue", "Bank confirmed"), _c("reason", "Reason"), _c("status", "Discrepancy status"),
            _c("openedOn", "Opened on", "date"), _c("ageDays", "Age (days)", "int"),
            _c("resolvedOn", "Resolved on", "date")]  # fmt: skip
    return cols, rr.discrepancy_rows(db, _filters(q), today, not q.all), {"all": q.all}


def _lapsed(db: Db, q: ReportQuery, today: str) -> tuple[list[Column], list[dict[str, object]], dict[str, object]]:
    cols = [REF, INST, REGION, BANK, AMOUNT, _c("maturityDate", "Maturity date", "date"), STATUS,
            _c("daysOverdue", "Days overdue", "int"), _c("replacementStatus", "Replacement", "status")]  # fmt: skip
    return cols, rr.lapsed_rows(db, _filters(q), today), {}


def _releases(db: Db, q: ReportQuery, today: str) -> tuple[list[Column], list[dict[str, object]], dict[str, object]]:
    cols = [REF, INST, BANK, AMOUNT, _c("status", "Request status", "releaseStatus"),
            _c("currentLevel", "Current level", "int"), _c("levels", "Levels", "int"),
            _c("requestedOn", "Requested on", "date"), _c("closedOn", "Closed on", "date"),
            _c("approvals", "Approvals"), _c("refundReference", "Refund reference")]  # fmt: skip
    return cols, rr.release_rows(db, _filters(q), q.from_, q.to), {"from": q.from_, "to": q.to}


SUMMARY_STATUSES: tuple[InstrumentStatus, ...] = (
    "SUBMITTED", "UNDER_SCRUTINY", "RETURNED", "ACTIVE", "EXPIRING", "MATURED", "LAPSED", "RELEASE_REQUESTED",
    "RENEWED", "RELEASED",
)  # fmt: skip


def _institution_summary(
    db: Db, q: ReportQuery, today: str
) -> tuple[list[Column], list[dict[str, object]], dict[str, object]]:
    cols = [_c("name", "Institution"), _c("aicteId", "AICTE id"), REGION, _c("state", "State"),
            _c("liveCount", "Live instruments", "int"), _c("liveAmount", "Live amount (₹)", "amount")]  # fmt: skip
    cols += [_c(f"count_{s}", STATUS_LABELS[s], "int") for s in SUMMARY_STATUSES]
    cols += [_c("openDiscrepancies", "Open discrepancies", "int"), _c("openAlerts", "Open alerts", "int"),
             _c("openProblems", "Open problems", "int")]  # fmt: skip
    rows: list[dict[str, object]] = []
    for s in all_institution_summaries(db, q.region):
        row: dict[str, object] = {
            k: s[k] for k in ("id", "name", "aicteId", "region", "state", "liveCount", "liveAmount")
        }
        for st in SUMMARY_STATUSES:
            row[f"count_{st}"] = s["byStatus"][st]["count"] if st in s["byStatus"] else 0
        row["openDiscrepancies"] = s["openProblems"]["openDiscrepancies"]
        row["openAlerts"] = s["openProblems"]["openAlerts"]
        row["openProblems"] = s["openProblems"]["total"]
        rows.append(row)
    return cols, rows, {}


Builder = Callable[[Db, ReportQuery, str], tuple[list[Column], list[dict[str, object]], dict[str, object]]]
PRESETS: dict[str, Builder] = {
    "register": _register,
    "expiring": _expiring,
    "pending-verification": _pending,
    "discrepancies": _discrepancies,
    "lapsed": _lapsed,
    "releases": _releases,
    "institution-summary": _institution_summary,
}


def build_report(preset: str, q: ReportQuery) -> Report:
    builder = PRESETS.get(preset)
    if builder is None:
        raise NotFound("Report not found")
    db = get_pool()
    today = clock.today(db)
    columns, rows, extra = builder(db, q, today)
    filters = {k: v for k, v in {**_filters(q), **extra}.items() if v not in (None, False, [])}
    return {"preset": preset, "title": REPORT_PRESETS[preset], "asOf": today, "filters": filters,
            "columns": columns, "rows": rows, "total": len(rows)}  # fmt: skip


def cell(value: object, kind: ColumnKind) -> str:
    """CSV text: ISO dates, plain amounts, human labels for codes, empty for missing values."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text = str(value)
    labels: Mapping[str, str] | None = {
        "status": STATUS_LABELS, "verification": VERIFICATION_STATE_LABELS, "result": VERIFICATION_RESULT_LABELS,
        "releaseStatus": RELEASE_REQUEST_STATUS_LABELS, "field": FIELD_LABELS,
    }.get(kind)  # type: ignore[assignment]  # fmt: skip
    return labels.get(text, text) if labels else text


def to_csv(columns: Sequence[Column], rows: Sequence[Mapping[str, object]]) -> str:
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow([c["label"] for c in columns])
    for r in rows:
        w.writerow([cell(r.get(c["key"]), c["kind"]) for c in columns])
    return BOM + out.getvalue()


def record_export(user: AuthUser, preset: str, filters: Mapping[str, object], row_count: int) -> None:
    with transaction() as tx:
        record_event(tx, actor=actor_of(user), action="REPORT_EXPORTED", entity_type="report",
                     entity_id=str(uuid.uuid4()), after={"preset": preset, "filters": dict(filters), "rows": row_count})  # fmt: skip


def export_csv(user: AuthUser, preset: str, q: ReportQuery) -> tuple[str, str]:
    """(filename, CSV text); writes REPORT_EXPORTED."""
    report = build_report(preset, q)
    text = to_csv(report["columns"], report["rows"])
    record_export(user, preset, report["filters"], report["total"])
    return f"fdr-{preset}-{report['asOf']}.csv", text
