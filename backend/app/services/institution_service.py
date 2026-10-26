"""Institution-wise view (§7.4): the register of institutions and one institution's profile."""

from __future__ import annotations

from decimal import Decimal
from typing import TypedDict

from ..db.pool import Db, get_pool
from ..domain import clock
from ..domain.access import AuthUser, assert_can_see, scope_alert_stats_query, scope_alerts_query
from ..domain.errors import NotFound
from ..repositories import report_repo as rr
from ..repositories.institution_repo import find_institution_by_id
from ..repositories.instrument_repo import ListFilters, ListItem, list_instruments
from ..repositories.release_repo import ReleaseListItem, list_requests
from ..schemas import InstitutionListQuery
from ..shared_constants import LIVE_STATUSES, InstrumentStatus

ALL_ROWS = 100_000


class StatusCell(TypedDict):
    count: int
    amount: str


class OpenProblems(TypedDict):
    openDiscrepancies: int
    overdue: int
    returned: int
    openAlerts: int
    total: int


class InstitutionSummary(rr.InstitutionListRow):
    byStatus: dict[InstrumentStatus, StatusCell]
    liveCount: int
    liveAmount: str
    openProblems: OpenProblems


class InstitutionListResponse(TypedDict):
    items: list[InstitutionSummary]
    total: int
    page: int
    pageSize: int


class InstitutionProfile(TypedDict):
    institution: InstitutionSummary
    asOf: str
    instruments: list[ListItem]
    alerts: list[rr.InstitutionAlert]
    releaseRequests: list[ReleaseListItem]


def summarise(db: Db, rows: list[rr.InstitutionListRow]) -> list[InstitutionSummary]:
    ids = [r["id"] for r in rows]
    by_inst: dict[str, dict[InstrumentStatus, StatusCell]] = {i: {} for i in ids}
    for t in rr.institution_status_totals(db, ids):
        by_inst[t["institutionId"]][t["status"]] = {"count": t["count"], "amount": t["amount"]}
    problems = {p["institutionId"]: p for p in rr.institution_problems(db, ids)}
    out: list[InstitutionSummary] = []
    for r in rows:
        cells = by_inst[r["id"]]
        live = [cells[s] for s in LIVE_STATUSES if s in cells]
        p = problems[r["id"]]
        overdue = sum(cells[s]["count"] for s in ("MATURED", "LAPSED") if s in cells)
        returned = cells["RETURNED"]["count"] if "RETURNED" in cells else 0
        out.append({
            **r,
            "byStatus": cells,
            "liveCount": sum(c["count"] for c in live),
            "liveAmount": f"{sum((Decimal(c['amount']) for c in live), Decimal(0)):.2f}",
            "openProblems": {
                "openDiscrepancies": p["openDiscrepancies"], "overdue": overdue, "returned": returned,
                "openAlerts": p["openAlerts"], "total": p["openDiscrepancies"] + overdue + returned + p["openAlerts"],
            },
        })  # fmt: skip
    return out


def list_institutions(q: InstitutionListQuery) -> InstitutionListResponse:
    db = get_pool()
    rows, total = rr.list_institutions(db, q.region, q.state, q.q, q.page, q.page_size)
    return {"items": summarise(db, rows), "total": total, "page": q.page, "pageSize": q.page_size}


def all_institution_summaries(db: Db, region: str | None) -> list[InstitutionSummary]:
    rows, _ = rr.list_institutions(db, region, None, None, 1, ALL_ROWS)
    return summarise(db, rows)


def get_profile(user: AuthUser, institution_id: str) -> InstitutionProfile:
    """Internal roles see any institution; institution users only their own (404 otherwise, rule 8)."""
    db = get_pool()
    assert_can_see(user, institution_id, "Institution")
    inst = find_institution_by_id(db, institution_id)
    if inst is None:
        raise NotFound("Institution not found")
    today = clock.today(db)
    row: rr.InstitutionListRow = {
        "id": inst["id"], "aicteId": inst["aicte_id"], "name": inst["name"], "region": inst["region"],
        "state": inst["state"], "contactEmail": inst["contact_email"],
    }  # fmt: skip
    filters: ListFilters = {
        "status": None, "type": None, "bank": None, "region": None, "institutionId": institution_id, "q": None,
        "maturityFrom": None, "maturityTo": None, "sort": "maturityDate", "page": 1, "pageSize": ALL_ROWS,
    }  # fmt: skip
    instruments, _ = list_instruments(db, filters, today, lambda p: "", lambda p: scope_alert_stats_query(user, p))
    params: list[object] = []
    alerts = rr.institution_open_alerts(db, institution_id, scope_alerts_query(user, params), params)

    def own(params: list[object]) -> str:
        params.append(institution_id)
        return f" AND i.institution_id = ${len(params)}::uuid"

    requests, _ = list_requests(
        db, {"statuses": None, "awaitingRole": None, "instrumentId": None, "page": 1, "pageSize": ALL_ROWS}, today, own
    )
    return {
        "institution": summarise(db, [row])[0],
        "asOf": today,
        "instruments": instruments,
        "alerts": alerts,
        "releaseRequests": requests,
    }
