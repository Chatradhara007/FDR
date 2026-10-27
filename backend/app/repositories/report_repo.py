"""Read-only SQL for the dashboard, My day, the institution registers, reports and improvement metrics (Phase 07).

Set-based queries only; `today` is always the app clock's business date passed in by the service.
"""

from __future__ import annotations

from typing import TypedDict, cast

from ..db.pool import Db, many, one
from ..shared_constants import (
    AlertKind,
    InstrumentStatus,
    InstrumentType,
    ReleaseRequestStatus,
    Role,
    VerificationState,
)

LIVE_SQL = "('ACTIVE','EXPIRING','MATURED','LAPSED','RELEASE_REQUESTED')"
OPEN_ALERT_SQL = "('OPEN','ACKNOWLEDGED')"


class InstrumentFilter(TypedDict, total=False):
    region: str | None
    type: InstrumentType | None
    bank: str | None
    institutionId: str | None


def filter_sql(f: InstrumentFilter, params: list[object]) -> str:
    """` AND …` conditions on instruments `i` / institutions `inst`; appends the parameters."""
    sql = ""
    for key, cond in (
        ("region", "inst.region = {}"),
        ("type", "i.type = {}::instrument_type"),
        ("bank", "i.issuing_bank = {}"),
        ("institutionId", "i.institution_id = {}::uuid"),
    ):
        value = f.get(key)
        if value:
            params.append(value)
            sql += " AND " + cond.format(f"${len(params)}")
    return sql


_FROM = "FROM instruments i JOIN institutions inst ON inst.id = i.institution_id"


# ---- dashboard ----


class StatusTotal(TypedDict):
    status: InstrumentStatus
    count: int
    amount: str


def status_totals(db: Db, f: InstrumentFilter) -> list[StatusTotal]:
    params: list[object] = []
    rows = many(
        db,
        f"""SELECT i.status, count(*)::int AS count, coalesce(sum(i.amount), 0)::text AS amount
       {_FROM} WHERE i.status <> 'DRAFT'{filter_sql(f, params)} GROUP BY i.status""",
        params,
    )
    return cast(list[StatusTotal], rows)


class VerificationTotal(TypedDict):
    state: VerificationState
    count: int
    amount: str
    override: int
    liveAmount: str


def verification_totals(db: Db, f: InstrumentFilter) -> list[VerificationTotal]:
    """Per verification state over non-draft instruments; `liveAmount` is the amount of live ones in that state."""
    params: list[object] = []
    rows = many(
        db,
        f"""SELECT i.verification_state AS state, count(*)::int AS count, coalesce(sum(i.amount), 0)::text AS amount,
            (count(*) FILTER (WHERE i.accepted_with_override))::int AS override,
            coalesce(sum(i.amount) FILTER (WHERE i.status IN {LIVE_SQL}), 0)::text AS "liveAmount"
       {_FROM} WHERE i.status <> 'DRAFT'{filter_sql(f, params)} GROUP BY i.verification_state""",
        params,
    )
    return cast(list[VerificationTotal], rows)


class Bucket(TypedDict):
    bucket: str
    count: int
    amount: str


def maturity_buckets(db: Db, f: InstrumentFilter, today: str) -> list[Bucket]:
    """Live instruments: overdue (MATURED/LAPSED) and 0–30 / 31–60 / 61–90 days to maturity."""
    params: list[object] = [today]
    rows = many(
        db,
        f"""SELECT b.bucket, count(*)::int AS count, coalesce(sum(b.amount), 0)::text AS amount FROM (
         SELECT i.amount, CASE
           WHEN i.status IN ('MATURED','LAPSED') OR i.maturity_date < $1::date THEN 'overdue'
           WHEN i.maturity_date - $1::date <= 30 THEN 'd0_30'
           WHEN i.maturity_date - $1::date <= 60 THEN 'd31_60'
           WHEN i.maturity_date - $1::date <= 90 THEN 'd61_90' END AS bucket
         {_FROM} WHERE i.status IN {LIVE_SQL}{filter_sql(f, params)}) b
       WHERE b.bucket IS NOT NULL GROUP BY b.bucket""",
        params,
    )
    return cast(list[Bucket], rows)


class MonthTotal(TypedDict):
    month: str
    count: int
    amount: str


def maturity_by_month(db: Db, f: InstrumentFilter, today: str) -> list[MonthTotal]:
    """Live instruments maturing in the 12 calendar months starting with today's month (from today on)."""
    params: list[object] = [today]
    rows = many(
        db,
        f"""SELECT to_char(date_trunc('month', i.maturity_date), 'YYYY-MM') AS month, count(*)::int AS count,
            coalesce(sum(i.amount), 0)::text AS amount
       {_FROM} WHERE i.status IN {LIVE_SQL} AND i.maturity_date >= $1::date
         AND i.maturity_date < (date_trunc('month', $1::date) + interval '12 months')::date{filter_sql(f, params)}
       GROUP BY 1""",
        params,
    )
    return cast(list[MonthTotal], rows)


AT_RISK_SQL = """(i.status IN ('EXPIRING','MATURED','LAPSED') OR i.verification_state = 'MISMATCH'
  OR EXISTS (SELECT 1 FROM discrepancies d WHERE d.instrument_id = i.id AND d.status = 'OPEN'))"""


class RegionTotal(TypedDict):
    region: str
    count: int
    amount: str
    atRisk: int


def region_totals(db: Db, f: InstrumentFilter) -> list[RegionTotal]:
    """Current instruments (not draft, renewed or released) per region."""
    params: list[object] = []
    rows = many(
        db,
        f"""SELECT inst.region, count(*)::int AS count, coalesce(sum(i.amount), 0)::text AS amount,
            (count(*) FILTER (WHERE {AT_RISK_SQL}))::int AS "atRisk"
       {_FROM} WHERE i.status NOT IN ('DRAFT','RENEWED','RELEASED'){filter_sql(f, params)}
       GROUP BY inst.region ORDER BY inst.region""",
        params,
    )
    return cast(list[RegionTotal], rows)


class BankTotal(TypedDict):
    bank: str
    count: int
    verified: int
    conclusive: int
    mismatches: int
    unavailable: int
    discrepancies: int


def bank_totals(db: Db, f: InstrumentFilter) -> list[BankTotal]:
    params: list[object] = []
    where = f"i.status <> 'DRAFT' AND i.issuing_bank IS NOT NULL{filter_sql(f, params)}"
    rows = many(
        db,
        f"""SELECT i.issuing_bank AS bank, count(*)::int AS count,
            (count(*) FILTER (WHERE i.verification_state = 'CONFIRMED'))::int AS verified,
            coalesce(sum(v.conclusive), 0)::int AS conclusive, coalesce(sum(v.mismatches), 0)::int AS mismatches,
            coalesce(sum(v.unavailable), 0)::int AS unavailable, coalesce(sum(dc.n), 0)::int AS discrepancies
       {_FROM}
       LEFT JOIN (SELECT instrument_id,
                         count(*) FILTER (WHERE result IN ('CONFIRMED','MISMATCH','NOT_FOUND')) AS conclusive,
                         count(*) FILTER (WHERE result IN ('MISMATCH','NOT_FOUND')) AS mismatches,
                         count(*) FILTER (WHERE result = 'UNAVAILABLE') AS unavailable
                    FROM verifications GROUP BY instrument_id) v ON v.instrument_id = i.id
       LEFT JOIN (SELECT instrument_id, count(*) AS n FROM discrepancies GROUP BY instrument_id) dc
              ON dc.instrument_id = i.id
      WHERE {where} GROUP BY i.issuing_bank ORDER BY i.issuing_bank""",
        params,
    )
    return cast(list[BankTotal], rows)


class AlertTotal(TypedDict):
    kind: AlertKind
    level: int
    count: int


def open_alert_totals(db: Db, f: InstrumentFilter) -> list[AlertTotal]:
    """Open (OPEN + ACKNOWLEDGED) alert copies addressed to AICTE roles (institution copies not counted)."""
    params: list[object] = []
    rows = many(
        db,
        f"""SELECT a.kind, a.level, count(*)::int AS count
       FROM alerts a JOIN instruments i ON i.id = a.instrument_id JOIN institutions inst ON inst.id = i.institution_id
      WHERE a.status IN {OPEN_ALERT_SQL} AND a.recipient_role <> 'institution'{filter_sql(f, params)}
      GROUP BY a.kind, a.level""",
        params,
    )
    return cast(list[AlertTotal], rows)


def open_discrepancy_count(db: Db, f: InstrumentFilter) -> int:
    params: list[object] = []
    row = one(
        db,
        f"""SELECT count(*)::int AS n FROM discrepancies d JOIN instruments i ON i.id = d.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id WHERE d.status = 'OPEN'{filter_sql(f, params)}""",
        params,
    )
    return int(row["n"])


def open_advisory_flag_count(db: Db, f: InstrumentFilter) -> int:
    """Open advisory flags on submitted instruments (officers' dashboard only; institutions never see flags)."""
    params: list[object] = []
    row = one(
        db,
        f"""SELECT count(*)::int AS n FROM advisory_flags a JOIN instruments i ON i.id = a.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id
      WHERE a.cleared_at IS NULL AND i.status <> 'DRAFT'{filter_sql(f, params)}""",
        params,
    )
    return int(row["n"])


# ---- My day ----


class WorkFacts(TypedDict):
    id: str
    referenceNo: str | None
    amount: str | None
    maturityDate: str | None
    status: InstrumentStatus
    verificationState: VerificationState
    acceptedWithOverride: bool
    assignedOfficerId: str | None
    institutionName: str
    daysLeft: int | None
    ageingDays: int | None
    discrepancyFields: list[str]
    worstOpenAlertLevel: int | None
    myAlertKinds: list[str]
    hasSuccessor: bool


def _my_alerts_sql(role: Role, user_param: str) -> str:
    """Open alerts the role works on: officer copies for me or the pool, the approver pool, or level 3 (admin)."""
    if role == "officer":
        return f"a.recipient_role = 'officer' AND (a.recipient_user_id IS NULL OR a.recipient_user_id = {user_param})"
    if role == "approver":
        return "a.recipient_role = 'approver'"
    return "a.level >= 3"


def work_candidates(db: Db, role: Role, user_id: str, today: str) -> list[WorkFacts]:
    """Instruments on this user's My day (§7.3) with everything the score and the reasons need."""
    params: list[object] = [today, user_id]
    mine = _my_alerts_sql(role, "$2::uuid")
    if role == "officer":
        pick = f"""(i.status = 'SUBMITTED' AND i.assigned_officer_id IS NULL)
          OR (i.status = 'UNDER_SCRUTINY' AND i.assigned_officer_id = $2::uuid)
          OR (i.status IN {LIVE_SQL} AND EXISTS (SELECT 1 FROM alerts a WHERE a.instrument_id = i.id
                AND a.status IN {OPEN_ALERT_SQL} AND {mine}))"""
    else:
        pick = (
            f"EXISTS (SELECT 1 FROM alerts a WHERE a.instrument_id = i.id AND a.status IN {OPEN_ALERT_SQL} AND {mine})"
        )
    rows = many(
        db,
        f"""SELECT i.id, i.reference_no AS "referenceNo", i.amount, i.maturity_date AS "maturityDate", i.status,
            i.verification_state AS "verificationState", i.accepted_with_override AS "acceptedWithOverride",
            i.assigned_officer_id AS "assignedOfficerId", inst.name AS "institutionName",
            (i.maturity_date - $1::date) AS "daysLeft",
            ($1::date - (i.submitted_at AT TIME ZONE 'Asia/Kolkata')::date) AS "ageingDays",
            coalesce((SELECT array_agg(d.field_name ORDER BY d.field_name) FROM discrepancies d
                       WHERE d.instrument_id = i.id AND d.status = 'OPEN'), '{{}}') AS "discrepancyFields",
            (SELECT max(a.level) FROM alerts a WHERE a.instrument_id = i.id AND a.status IN {OPEN_ALERT_SQL})
              AS "worstOpenAlertLevel",
            coalesce((SELECT array_agg(DISTINCT a.kind) FROM alerts a WHERE a.instrument_id = i.id
                       AND a.status IN {OPEN_ALERT_SQL} AND {mine}), '{{}}') AS "myAlertKinds",
            EXISTS (SELECT 1 FROM instruments c WHERE c.parent_instrument_id = i.id
                     AND c.status NOT IN ('RENEWED','RELEASED')) AS "hasSuccessor"
       {_FROM} WHERE {pick}""",
        params,
    )
    return cast(list[WorkFacts], rows)


class ReleaseWork(TypedDict):
    requestId: str
    instrumentId: str
    status: ReleaseRequestStatus
    currentLevel: int
    waitingDays: int
    referenceNo: str | None
    amount: str | None
    verificationState: VerificationState
    acceptedWithOverride: bool
    institutionName: str
    daysLeft: int | None
    discrepancyFields: list[str]
    worstOpenAlertLevel: int | None


def release_candidates(db: Db, role: Role, user_id: str, today: str) -> list[ReleaseWork]:
    """Open requests whose current level is this role's turn. Officers: PENDING_CONDITIONS. Requests the user
    already acted on are left out (D27: they may not act at another level of the same request)."""
    params: list[object] = [today, role, user_id]
    status = (
        "r.status = 'PENDING_CONDITIONS'"
        if role == "officer"
        else "r.status IN ('PENDING_CONDITIONS','PENDING_APPROVAL')"
    )
    rows = many(
        db,
        f"""SELECT r.id AS "requestId", i.id AS "instrumentId", r.status, r.current_level AS "currentLevel",
            ($1::date - (r.stage_started_at AT TIME ZONE 'Asia/Kolkata')::date) AS "waitingDays",
            i.reference_no AS "referenceNo", i.amount, i.verification_state AS "verificationState",
            i.accepted_with_override AS "acceptedWithOverride", inst.name AS "institutionName",
            (i.maturity_date - $1::date) AS "daysLeft",
            coalesce((SELECT array_agg(d.field_name ORDER BY d.field_name) FROM discrepancies d
                       WHERE d.instrument_id = i.id AND d.status = 'OPEN'), '{{}}') AS "discrepancyFields",
            (SELECT max(a.level) FROM alerts a WHERE a.instrument_id = i.id AND a.status IN {OPEN_ALERT_SQL})
              AS "worstOpenAlertLevel"
       FROM release_requests r JOIN instruments i ON i.id = r.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id
      WHERE {status} AND (r.required_levels -> (r.current_level - 1) ->> 'role') = $2
        AND NOT EXISTS (SELECT 1 FROM release_approvals ap WHERE ap.release_request_id = r.id
                         AND ap.approver_id = $3::uuid)""",
        params,
    )
    return cast(list[ReleaseWork], rows)


# ---- institutions ----


class InstitutionListRow(TypedDict):
    id: str
    aicteId: str
    name: str
    region: str
    state: str
    contactEmail: str | None


def list_institutions(
    db: Db, region: str | None, state: str | None, q: str | None, page: int, page_size: int
) -> tuple[list[InstitutionListRow], int]:
    params: list[object] = [region, state, None if q is None else f"%{q}%", page_size, (page - 1) * page_size]
    rows = many(
        db,
        """SELECT inst.id, inst.aicte_id AS "aicteId", inst.name, inst.region, inst.state,
            inst.contact_email AS "contactEmail", count(*) OVER () AS total
       FROM institutions inst
      WHERE ($1::text IS NULL OR inst.region = $1) AND ($2::text IS NULL OR inst.state = $2)
        AND ($3::text IS NULL OR inst.name ILIKE $3 OR inst.aicte_id ILIKE $3)
      ORDER BY inst.name LIMIT $4 OFFSET $5""",
        params,
    )
    total = int(rows[0]["total"]) if rows else 0
    return [cast(InstitutionListRow, {k: v for k, v in r.items() if k != "total"}) for r in rows], total


class InstitutionStatusTotal(TypedDict):
    institutionId: str
    status: InstrumentStatus
    count: int
    amount: str


def institution_status_totals(db: Db, institution_ids: list[str]) -> list[InstitutionStatusTotal]:
    rows = many(
        db,
        """SELECT i.institution_id AS "institutionId", i.status, count(*)::int AS count,
            coalesce(sum(i.amount), 0)::text AS amount
       FROM instruments i WHERE i.institution_id = ANY($1::uuid[]) AND i.status <> 'DRAFT'
      GROUP BY i.institution_id, i.status""",
        [institution_ids],
    )
    return cast(list[InstitutionStatusTotal], rows)


class InstitutionProblems(TypedDict):
    institutionId: str
    openDiscrepancies: int
    openAlerts: int


def institution_problems(db: Db, institution_ids: list[str]) -> list[InstitutionProblems]:
    rows = many(
        db,
        f"""SELECT inst.id AS "institutionId",
            (SELECT count(*) FROM discrepancies d JOIN instruments i ON i.id = d.instrument_id
              WHERE i.institution_id = inst.id AND d.status = 'OPEN')::int AS "openDiscrepancies",
            (SELECT count(*) FROM alerts a WHERE a.institution_id = inst.id AND a.status IN {OPEN_ALERT_SQL}
                AND a.recipient_role <> 'institution')::int AS "openAlerts"
       FROM institutions inst WHERE inst.id = ANY($1::uuid[])""",
        [institution_ids],
    )
    return cast(list[InstitutionProblems], rows)


# ---- reports ----


def pending_verification_rows(db: Db, f: InstrumentFilter, today: str) -> list[dict[str, object]]:
    params: list[object] = [today]
    return many(
        db,
        f"""SELECT i.id, i.reference_no AS "referenceNo", inst.name AS "institutionName", inst.region,
            i.issuing_bank AS "issuingBank", i.amount, i.status, i.verification_state AS "verificationState",
            (i.submitted_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "submittedOn",
            ($1::date - (i.submitted_at AT TIME ZONE 'Asia/Kolkata')::date) AS "ageingDays",
            (SELECT v.result FROM verifications v WHERE v.instrument_id = i.id
              ORDER BY v.requested_at DESC LIMIT 1) AS "lastResult"
       {_FROM} WHERE i.verification_state <> 'CONFIRMED'
         AND i.status IN ('SUBMITTED','UNDER_SCRUTINY','ACTIVE','EXPIRING','MATURED','LAPSED','RELEASE_REQUESTED')
         {filter_sql(f, params)}
       ORDER BY "ageingDays" DESC NULLS LAST, i.reference_no""",
        params,
    )


def discrepancy_rows(db: Db, f: InstrumentFilter, today: str, open_only: bool) -> list[dict[str, object]]:
    params: list[object] = [today, open_only]
    return many(
        db,
        f"""SELECT d.id, i.id AS "instrumentId", i.reference_no AS "referenceNo", inst.name AS "institutionName",
            i.issuing_bank AS "issuingBank", d.field_name AS "fieldName", d.claimed_value AS "claimedValue",
            d.confirmed_value AS "confirmedValue", d.reason, d.status,
            (d.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "openedOn",
            (coalesce((d.resolved_at AT TIME ZONE 'Asia/Kolkata')::date, $1::date)
              - (d.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS "ageDays",
            (d.resolved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "resolvedOn"
       FROM discrepancies d JOIN instruments i ON i.id = d.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id
      WHERE (NOT $2::boolean OR d.status = 'OPEN'){filter_sql(f, params)}
      ORDER BY d.created_at, d.id""",
        params,
    )


def lapsed_rows(db: Db, f: InstrumentFilter, today: str) -> list[dict[str, object]]:
    params: list[object] = [today]
    return many(
        db,
        f"""SELECT i.id, i.reference_no AS "referenceNo", inst.name AS "institutionName", inst.region,
            i.issuing_bank AS "issuingBank", i.amount, i.maturity_date AS "maturityDate", i.status,
            ($1::date - i.maturity_date) AS "daysOverdue",
            (SELECT c.status::text FROM instruments c WHERE c.parent_instrument_id = i.id) AS "replacementStatus"
       {_FROM} WHERE i.status IN ('MATURED','LAPSED'){filter_sql(f, params)}
       ORDER BY i.maturity_date, i.reference_no""",
        params,
    )


def release_rows(db: Db, f: InstrumentFilter, date_from: str | None, date_to: str | None) -> list[dict[str, object]]:
    params: list[object] = [date_from, date_to]
    return many(
        db,
        f"""SELECT r.id, i.id AS "instrumentId", i.reference_no AS "referenceNo", inst.name AS "institutionName",
            i.issuing_bank AS "issuingBank", i.amount, r.status, r.current_level AS "currentLevel",
            jsonb_array_length(r.required_levels) AS "levels",
            (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "requestedOn",
            (r.closed_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "closedOn",
            coalesce((SELECT string_agg('L' || ap.level || ' ' || u.name || ': ' || ap.decision, '; ' ORDER BY ap.seq)
                        FROM release_approvals ap JOIN users u ON u.id = ap.approver_id
                       WHERE ap.release_request_id = r.id), '') AS approvals,
            r.refund_reference AS "refundReference"
       FROM release_requests r JOIN instruments i ON i.id = r.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id
      WHERE ($1::date IS NULL OR (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date)
        AND ($2::date IS NULL OR (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date){filter_sql(f, params)}
      ORDER BY r.requested_at, r.seq""",
        params,
    )


# ---- improvement metrics ----


def submission_to_verification_hours(db: Db) -> list[float]:
    """Per instrument: hours from its first INSTRUMENT_SUBMITTED to the first conclusive VERIFICATION_RESULT after it."""
    rows = many(
        db,
        """SELECT extract(epoch FROM (v.at - s.at)) / 3600.0 AS hours FROM
         (SELECT instrument_id, min(created_at) AS at FROM events WHERE action = 'INSTRUMENT_SUBMITTED'
           GROUP BY instrument_id) s
         JOIN LATERAL (SELECT min(e.created_at) AS at FROM events e
                        WHERE e.instrument_id = s.instrument_id AND e.action = 'VERIFICATION_RESULT'
                          AND e.after_json ->> 'result' IN ('CONFIRMED','MISMATCH','NOT_FOUND')
                          AND e.created_at >= s.at) v ON v.at IS NOT NULL""",
    )
    return [float(r["hours"]) for r in rows]


class MaturedReminder(TypedDict):
    matured: int
    caught: int


def matured_with_early_reminder(db: Db, days_before: int) -> MaturedReminder:
    """Instruments that reached MATURED (event), and how many had a maturity reminder created ≥ N days before."""
    row = one(
        db,
        """SELECT count(*)::int AS matured,
            (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM alerts a WHERE a.instrument_id = i.id
               AND a.kind = 'MATURITY_REMINDER'
               AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date <= i.maturity_date - $1::int)))::int AS caught
       FROM instruments i
      WHERE EXISTS (SELECT 1 FROM events e WHERE e.instrument_id = i.id AND e.action = 'STATUS_MATURED')""",
        [days_before],
    )
    return cast(MaturedReminder, row)


def overdue_detection_days(db: Db) -> list[int]:
    """Per instrument with an OVERDUE_RENEWAL alert: days from maturity to the first such alert."""
    rows = many(
        db,
        """SELECT (min(a.created_at AT TIME ZONE 'Asia/Kolkata')::date - i.maturity_date) AS days
       FROM alerts a JOIN instruments i ON i.id = a.instrument_id
      WHERE a.kind = 'OVERDUE_RENEWAL' GROUP BY i.id, i.maturity_date""",
    )
    return [int(r["days"]) for r in rows]


def bank_discrepancy_count(db: Db) -> int:
    """Discrepancies raised from a bank response (they carry the verification)."""
    return int(one(db, "SELECT count(*)::int AS n FROM discrepancies WHERE verification_id IS NOT NULL")["n"])


class GapInputs(TypedDict):
    instruments: list[dict[str, object]]
    provenance: list[dict[str, object]]
    documents: list[dict[str, object]]
    discrepancies: list[dict[str, object]]
    observations: list[dict[str, object]]


def live_gap_inputs(db: Db) -> GapInputs:
    """Everything find_gaps needs for every live instrument, in five queries (no per-instrument round trips)."""
    live = f"SELECT id FROM instruments WHERE status IN {LIVE_SQL}"
    return {
        "instruments": many(
            db, f'SELECT i.id, i.type, i.lien_marked AS "lienMarked" FROM instruments i WHERE i.status IN {LIVE_SQL}'
        ),
        "provenance": many(
            db,
            f"""SELECT instrument_id AS "instrumentId", field_name AS "fieldName", tier
                   FROM field_provenance WHERE instrument_id IN ({live})""",
        ),
        "documents": many(
            db,
            f"""SELECT instrument_id AS "instrumentId", doc_type AS "docType" FROM documents
                   WHERE deleted_at IS NULL AND release_request_id IS NULL AND instrument_id IN ({live})""",
        ),
        "discrepancies": many(
            db,
            f"""SELECT id, instrument_id AS "instrumentId", field_name AS "fieldName", reason, status
                   FROM discrepancies WHERE status = 'OPEN' AND instrument_id IN ({live})""",
        ),
        "observations": many(
            db,
            f"""SELECT id, instrument_id AS "instrumentId", text, severity, status
                   FROM observations WHERE status = 'OPEN' AND instrument_id IN ({live})""",
        ),
    }


def pending_item_count(db: Db) -> int:
    """Pending work the dashboard shows: instruments in scrutiny or returned, plus open release requests."""
    row = one(
        db,
        """SELECT (SELECT count(*) FROM instruments WHERE status IN ('SUBMITTED','UNDER_SCRUTINY','RETURNED'))
              + (SELECT count(*) FROM release_requests
                  WHERE status IN ('PENDING_CONDITIONS','PENDING_APPROVAL','RETURNED')) AS n""",
    )
    return int(row["n"])


class InstitutionAlert(TypedDict):
    id: str
    instrumentId: str
    referenceNo: str | None
    kind: AlertKind
    level: int
    recipientRole: Role
    dueDate: str
    message: str
    status: str


def institution_open_alerts(
    db: Db, institution_id: str, scope_sql: str, params: list[object]
) -> list[InstitutionAlert]:
    """Open alerts of one institution's instruments; `scope_sql` (D23) already appended its parameters."""
    params.append(institution_id)
    rows = many(
        db,
        f"""SELECT a.id, a.instrument_id AS "instrumentId", i.reference_no AS "referenceNo", a.kind, a.level,
            a.recipient_role AS "recipientRole", a.due_date AS "dueDate", a.message, a.status
       FROM alerts a JOIN instruments i ON i.id = a.instrument_id
      WHERE a.status IN {OPEN_ALERT_SQL}{scope_sql} AND a.institution_id = ${len(params)}::uuid
      ORDER BY a.level DESC, a.due_date, a.id""",
        params,
    )
    return cast(list[InstitutionAlert], rows)
