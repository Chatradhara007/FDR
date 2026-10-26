"""Improvement metrics (§7.6): the portal's own data (app-clock events) against the `improvement_baseline` rule.
Every figure is labelled "Simulated on demo data" (D26); the baseline changes only through the rules table."""

from __future__ import annotations

from collections import defaultdict
from statistics import median
from typing import Literal, TypedDict, cast

from ..db.pool import get_pool
from ..domain import clock
from ..domain.access import AuthUser
from ..domain.gaps import find_gaps
from ..domain.rules import load_improvement_baseline
from ..repositories import report_repo as rr
from ..repositories.discrepancy_repo import DiscrepancyRow
from ..repositories.observation_repo import ObservationRow
from ..repositories.provenance_repo import ProvenanceRow
from ..services.instrument_service import doc_rules
from ..shared_constants import SIMULATED_LABEL, InstrumentType
from .report_service import Column, record_export, to_csv

Better = Literal["lower", "higher"]
REMINDER_LEAD_DAYS = 30


class Figure(TypedDict):
    value: float | None
    display: str


class Metric(TypedDict):
    key: str
    title: str
    unit: str
    better: Better
    portal: Figure
    manual: Figure
    sampleSize: int | None
    explanation: str
    label: str


class Improvement(TypedDict):
    label: str
    asOf: str
    baselineNote: str
    metrics: list[Metric]


def _fig(value: float | None, unit: str, empty: str = "No data yet") -> Figure:
    if value is None:
        return {"value": None, "display": empty}
    shown = f"{value:.1f}".rstrip("0").rstrip(".")
    return {"value": value, "display": f"{shown} {unit}".strip() if unit != "%" else f"{shown}%"}


def _metric(key: str, title: str, unit: str, better: Better, portal: Figure, manual: Figure, n: int | None,
            explanation: str) -> Metric:  # fmt: skip
    return {"key": key, "title": title, "unit": unit, "better": better, "portal": portal, "manual": manual,
            "sampleSize": n, "explanation": explanation, "label": SIMULATED_LABEL}  # fmt: skip


def _auto_problems() -> tuple[int, int]:
    """(discrepancies raised from bank responses, gaps found by find_gaps across live instruments)."""
    db = get_pool()
    rules = doc_rules(db)
    data = rr.live_gap_inputs(db)
    groups: dict[str, dict[str, list[dict[str, object]]]] = defaultdict(lambda: defaultdict(list))
    for part in ("provenance", "documents", "discrepancies", "observations"):
        for row in data[part]:
            groups[str(row["instrumentId"])][part].append(row)
    gaps = 0
    for inst in data["instruments"]:
        g = groups[str(inst["id"])]
        kind = cast(InstrumentType, inst["type"])
        gaps += len(find_gaps(
            {"lienMarked": bool(inst["lienMarked"])},
            cast(list[ProvenanceRow], g["provenance"]),
            [str(d["docType"]) for d in g["documents"]],
            cast(list[DiscrepancyRow], g["discrepancies"]),
            cast(list[ObservationRow], g["observations"]),
            {"requiredDocs": rules["requiredDocs"][kind], "lienRequired": rules["lienRequired"][kind]},
        ))  # fmt: skip
    return rr.bank_discrepancy_count(db), gaps


def improvement() -> Improvement:
    db = get_pool()
    base = load_improvement_baseline(db)

    hours = rr.submission_to_verification_hours(db)
    reminders = rr.matured_with_early_reminder(db, REMINDER_LEAD_DAYS)
    detect = rr.overdue_detection_days(db)
    bank_found, gaps = _auto_problems()
    pending = rr.pending_item_count(db)
    caught = None if reminders["matured"] == 0 else reminders["caught"] * 100 / reminders["matured"]

    metrics = [
        _metric("verification", "Submission → bank verification outcome", "hours", "lower",
                _fig(median(hours) if hours else None, "hours"), _fig(base.manual_verification_days * 24.0, "hours"),
                len(hours), f"Median time from submission to the first conclusive bank result. Manual baseline: "
                f"{base.manual_verification_days} days of letters to the bank."),
        _metric("caughtBeforeExpiry", "Lapses caught before expiry", "%", "higher", _fig(caught, "%"),
                _fig(float(base.manual_caught_before_expiry_pct), "%"), reminders["matured"],
                f"Of instruments that reached maturity, the share that had a reminder at least {REMINDER_LEAD_DAYS} "
                "days before."),
        _metric("lapseDetection", "Days to detect a lapsing instrument", "days", "lower",
                _fig(float(median(detect)) if detect else None, "days"),
                _fig(float(base.manual_lapse_detection_days), "days"), len(detect),
                "Days between maturity and the first overdue-renewal alert (0 while the daily job runs)."),
        _metric("autoProblems", "Problems detected automatically", "problems", "higher",
                _fig(float(bank_found + gaps), "problems"), _fig(0.0, "problems", "Not tracked"), None,
                f"{bank_found} discrepancies from bank responses + {gaps} gaps on live instruments (missing documents, "
                "unconfirmed fields, lien not marked). Manual process: found only when someone looks."),
        _metric("steps", "Steps per case", "steps", "lower", _fig(float(base.portal_steps_per_case), "steps"),
                _fig(float(base.manual_steps_per_case), "steps"), None, "From the improvement_baseline rule."),
        _metric("visibility", "Pending cases visible", "cases", "higher", _fig(float(pending), "cases"),
                {"value": None, "display": "Not tracked"}, None,
                "Instruments in scrutiny or returned plus open release requests, all on the dashboard."),
    ]  # fmt: skip
    return {"label": SIMULATED_LABEL, "asOf": clock.today(db), "baselineNote": base.note, "metrics": metrics}


CSV_COLUMNS: list[Column] = [
    {"key": "title", "label": "Metric", "kind": "text"},
    {"key": "portal", "label": "Portal", "kind": "text"},
    {"key": "manual", "label": "Manual baseline", "kind": "text"},
    {"key": "sampleSize", "label": "Sample size", "kind": "int"},
    {"key": "explanation", "label": "How it is computed", "kind": "text"},
    {"key": "label", "label": "Basis", "kind": "text"},
]


def improvement_csv(user: AuthUser) -> tuple[str, str]:
    data = improvement()
    rows = [{"title": m["title"], "portal": m["portal"]["display"], "manual": m["manual"]["display"],
             "sampleSize": m["sampleSize"], "explanation": m["explanation"], "label": m["label"]}
            for m in data["metrics"]]  # fmt: skip
    record_export(user, "improvement", {}, len(rows))
    return f"fdr-improvement-{data['asOf']}.csv", to_csv(CSV_COLUMNS, rows)
