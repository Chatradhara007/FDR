from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Literal, TypedDict, cast

from ..db.pool import Db, many
from ..shared_constants import InstrumentStatus, VerificationState
from .alert_repo import open_alert_stats_sql

AssignedFilter = Literal["me", "unassigned", "all"]


class QueueFilters(TypedDict):
    region: str | None
    bank: str | None
    verificationState: VerificationState | None
    assigned: AssignedFilter
    officerId: str
    page: int
    pageSize: int


class QueueItem(TypedDict):
    id: str
    referenceNo: str | None
    issuingBank: str | None
    amount: str | None
    maturityDate: str | None
    verificationState: VerificationState
    status: InstrumentStatus
    assignedOfficerId: str | None
    assignedOfficerName: str | None
    institution: str
    region: str
    openDiscrepancies: int
    submittedAt: datetime | None
    ageingDays: int | None
    worstOpenAlertLevel: int | None
    openAlertCount: int


def scrutiny_queue(
    db: Db, f: QueueFilters, today: str, alert_scope: Callable[[list[object]], str]
) -> tuple[list[QueueItem], int]:
    """§3.7: SUBMITTED / UNDER_SCRUTINY instruments, oldest submission first. Ageing is days from the
    IST submission date to the app clock's `today`."""
    params: list[object] = [
        today, f["region"], f["bank"], f["verificationState"], f["assigned"], f["officerId"], f["pageSize"],
        (f["page"] - 1) * f["pageSize"],
    ]  # fmt: skip
    alert_stats = open_alert_stats_sql(alert_scope(params))
    rows = many(
        db,
        f"""SELECT i.id, i.reference_no AS "referenceNo", i.issuing_bank AS "issuingBank", i.amount,
            i.maturity_date AS "maturityDate", i.verification_state AS "verificationState", i.status,
            i.assigned_officer_id AS "assignedOfficerId", u.name AS "assignedOfficerName",
            inst.name AS institution, inst.region,
            (SELECT count(*) FROM discrepancies d WHERE d.instrument_id = i.id AND d.status = 'OPEN')::int
              AS "openDiscrepancies",
            i.submitted_at AS "submittedAt",
            ($1::date - (i.submitted_at AT TIME ZONE 'Asia/Kolkata')::date) AS "ageingDays",
            {alert_stats},
            count(*) OVER () AS total
       FROM instruments i
       JOIN institutions inst ON inst.id = i.institution_id
       LEFT JOIN users u ON u.id = i.assigned_officer_id
      WHERE i.status IN ('SUBMITTED','UNDER_SCRUTINY')
        AND ($2::text IS NULL OR inst.region = $2)
        AND ($3::text IS NULL OR i.issuing_bank = $3)
        AND ($4::verification_state IS NULL OR i.verification_state = $4)
        AND ($5 = 'all' OR ($5 = 'me' AND i.assigned_officer_id = $6::uuid)
             OR ($5 = 'unassigned' AND i.assigned_officer_id IS NULL))
      ORDER BY i.submitted_at ASC, i.id
      LIMIT $7 OFFSET $8""",
        params,
    )
    total = int(rows[0]["total"]) if rows else 0
    return [cast(QueueItem, {k: v for k, v in r.items() if k != "total"}) for r in rows], total
