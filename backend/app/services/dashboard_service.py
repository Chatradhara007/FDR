"""Management dashboard (§7.2). One response, every figure from the app clock's `today`."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TypedDict

from ..db.pool import get_pool
from ..domain import clock
from ..repositories import report_repo as rr
from ..repositories.report_repo import InstrumentFilter
from ..schemas import DashboardQuery
from ..shared_constants import (
    ALERT_KINDS,
    DASHBOARD_STATUS_GROUPS,
    LIVE_STATUSES,
    VERIFICATION_STATES,
    AlertKind,
    InstrumentStatus,
    VerificationState,
)


class CountAmount(TypedDict):
    count: int
    amount: str


class Kpis(TypedDict):
    live: CountAmount
    confirmedAmount: str
    confirmedPct: float | None
    pendingScrutiny: int
    openDiscrepancies: int
    openEscalations: int
    advisoryFlags: int


class StatusGroupView(TypedDict):
    key: str
    label: str
    statuses: list[InstrumentStatus]
    count: int
    amount: str


class VerificationView(TypedDict):
    byState: dict[VerificationState, int]
    acceptedWithOverride: int


class BucketView(TypedDict):
    key: str
    label: str
    count: int
    amount: str


class MonthView(TypedDict):
    month: str
    count: int
    amount: str


class BankView(TypedDict):
    bank: str
    count: int
    verified: int
    verifications: int
    mismatches: int
    mismatchRate: float | None
    unavailable: int
    discrepancies: int


class AlertsView(TypedDict):
    byKind: dict[AlertKind, int]
    byLevel: dict[str, int]
    total: int


class Dashboard(TypedDict):
    asOf: str
    filters: InstrumentFilter
    kpis: Kpis
    byStatus: list[StatusGroupView]
    verification: VerificationView
    maturityBuckets: list[BucketView]
    maturityByMonth: list[MonthView]
    byRegion: list[rr.RegionTotal]
    byBank: list[BankView]
    alerts: AlertsView


BUCKETS = (("overdue", "Overdue"), ("d0_30", "0–30 days"), ("d31_60", "31–60 days"), ("d61_90", "61–90 days"))


def _money(d: Decimal) -> str:
    return f"{d.quantize(Decimal('0.01')):f}"


def _pct(part: Decimal, whole: Decimal) -> float | None:
    return None if whole == 0 else round(float(part * 100 / whole), 1)


def _next_months(today: str, n: int = 12) -> list[str]:
    d = date.fromisoformat(today)
    out = []
    y, m = d.year, d.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def get_dashboard(q: DashboardQuery) -> Dashboard:
    db = get_pool()
    today = clock.today(db)
    f: InstrumentFilter = {"region": q.region, "type": q.type}

    statuses = {r["status"]: r for r in rr.status_totals(db, f)}

    def total(sts: list[InstrumentStatus]) -> CountAmount:
        rows = [statuses[s] for s in sts if s in statuses]
        return {
            "count": sum(r["count"] for r in rows),
            "amount": _money(sum((Decimal(r["amount"]) for r in rows), Decimal(0))),
        }

    by_status: list[StatusGroupView] = [
        {"key": g["key"], "label": g["label"], "statuses": g["statuses"], **total(g["statuses"])}
        for g in DASHBOARD_STATUS_GROUPS
    ]
    live = total(list(LIVE_STATUSES))

    ver = rr.verification_totals(db, f)
    by_state: dict[VerificationState, int] = dict.fromkeys(VERIFICATION_STATES, 0)
    for v in ver:
        by_state[v["state"]] = v["count"]
    confirmed_amount = sum((Decimal(v["liveAmount"]) for v in ver if v["state"] == "CONFIRMED"), Decimal(0))

    buckets = {b["bucket"]: b for b in rr.maturity_buckets(db, f, today)}
    months = {m["month"]: m for m in rr.maturity_by_month(db, f, today)}

    banks: list[BankView] = [
        {
            "bank": b["bank"], "count": b["count"], "verified": b["verified"], "verifications": b["conclusive"],
            "mismatches": b["mismatches"],
            "mismatchRate": None if b["conclusive"] == 0 else round(b["mismatches"] * 100 / b["conclusive"], 1),
            "unavailable": b["unavailable"], "discrepancies": b["discrepancies"],
        }
        for b in rr.bank_totals(db, f)
    ]  # fmt: skip

    by_kind: dict[AlertKind, int] = dict.fromkeys(ALERT_KINDS, 0)
    by_level: dict[str, int] = {}
    alert_rows = rr.open_alert_totals(db, f)
    for a in alert_rows:
        by_kind[a["kind"]] += a["count"]
        by_level[str(a["level"])] = by_level.get(str(a["level"]), 0) + a["count"]

    return {
        "asOf": today,
        "filters": f,
        "kpis": {
            "live": live,
            "confirmedAmount": _money(confirmed_amount),
            "confirmedPct": _pct(confirmed_amount, Decimal(live["amount"])),
            "pendingScrutiny": total(["SUBMITTED", "UNDER_SCRUTINY"])["count"],
            "openDiscrepancies": rr.open_discrepancy_count(db, f),
            "openEscalations": sum(a["count"] for a in alert_rows if a["level"] >= 2),
            "advisoryFlags": rr.open_advisory_flag_count(db, f),
        },
        "byStatus": by_status,
        "verification": {"byState": by_state, "acceptedWithOverride": sum(v["override"] for v in ver)},
        "maturityBuckets": [
            {
                "key": k,
                "label": label,
                "count": buckets[k]["count"] if k in buckets else 0,
                "amount": buckets[k]["amount"] if k in buckets else "0.00",
            }
            for k, label in BUCKETS
        ],
        "maturityByMonth": [
            {
                "month": m,
                "count": months[m]["count"] if m in months else 0,
                "amount": months[m]["amount"] if m in months else "0.00",
            }
            for m in _next_months(today)
        ],
        "byRegion": rr.region_totals(db, f),
        "byBank": banks,
        "alerts": {"byKind": by_kind, "byLevel": by_level, "total": sum(by_kind.values())},
    }
