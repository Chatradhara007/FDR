"""SQL for alerts (Phase 04). Candidate selection is set-based; inserts are batched and deduplicated by
`dedupe_key` (D1), so a repeated run inserts nothing."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, exec_, many, maybe_one, one
from ..domain.canonical_json import js_json
from ..shared_constants import (
    AlertKind,
    AlertResolution,
    AlertStatus,
    InstrumentStatus,
    InstrumentType,
    Role,
    VerificationState,
)

LIVE_ALERT_STATUSES = ("OPEN", "ACKNOWLEDGED", "ESCALATED")
OPEN_ALERT_STATUSES = ("OPEN", "ACKNOWLEDGED")


class NewAlert(TypedDict):
    id: str
    instrument_id: str
    kind: AlertKind
    rule_key: str
    subject_id: str
    level: int
    root_alert_id: str
    recipient_role: Role
    recipient_user_id: str | None
    institution_id: str
    due_date: str
    message: str
    status: AlertStatus
    resolution: AlertResolution | None
    dedupe_key: str
    created_at: str
    resolved_at: str | None


class InsertedAlert(TypedDict):
    id: str
    instrumentId: str
    status: AlertStatus
    recipientRole: Role
    recipientUserId: str | None
    institutionId: str


def insert_alerts(db: Db, alerts: Sequence[NewAlert]) -> list[InsertedAlert]:
    """One INSERT for the whole batch; returns only the rows actually inserted (conflicts on dedupe_key are skipped)."""
    if not alerts:
        return []
    rows = many(
        db,
        """INSERT INTO alerts (id, instrument_id, kind, rule_key, subject_id, level, root_alert_id, recipient_role,
                            recipient_user_id, institution_id, due_date, message, status, resolution, dedupe_key,
                            created_at, resolved_at)
     SELECT r.id, r.instrument_id, r.kind, r.rule_key, r.subject_id, r.level, r.root_alert_id, r.recipient_role::user_role,
            r.recipient_user_id, r.institution_id, r.due_date, r.message, r.status, r.resolution, r.dedupe_key,
            r.created_at, r.resolved_at
       FROM jsonb_to_recordset($1::jsonb) AS r(
              id uuid, instrument_id uuid, kind text, rule_key text, subject_id text, level int, root_alert_id uuid,
              recipient_role text, recipient_user_id uuid, institution_id uuid, due_date date, message text,
              status text, resolution text, dedupe_key text, created_at timestamptz, resolved_at timestamptz)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id, instrument_id AS "instrumentId", status, recipient_role AS "recipientRole",
               recipient_user_id AS "recipientUserId", institution_id AS "institutionId\"""",
        [js_json(list(alerts))],
    )
    return cast(list[InsertedAlert], rows)


# ---- candidates (set-based) ----


class SweepCandidate(TypedDict):
    id: str
    status: InstrumentStatus
    maturityDate: str | None


def sweep_candidates(db: Db, as_of: str, window: int, grace: int) -> list[SweepCandidate]:
    """Instruments that at least one status rule moves on today, locked in id order."""
    rows = many(
        db,
        """SELECT i.id, i.status, i.maturity_date AS "maturityDate"
       FROM instruments i
      WHERE (i.status = 'ACTIVE' AND i.maturity_date - $1::date <= $2)
         OR (i.status = 'EXPIRING' AND i.maturity_date <= $1::date)
         OR (i.status = 'MATURED' AND $1::date > i.maturity_date + $3::int)
      ORDER BY i.id
        FOR UPDATE""",
        [as_of, window, grace],
    )
    return cast(list[SweepCandidate], rows)


def has_submitted_successor(db: Db, instrument_id: str) -> bool:
    """A successor that has left DRAFT (an untouched renewal draft does not prevent lapse)."""
    row = maybe_one(
        db,
        "SELECT 1 AS x FROM instruments WHERE parent_instrument_id = $1 AND status <> 'DRAFT' LIMIT 1",
        [instrument_id],
    )
    return row is not None


class AlertTarget(TypedDict):
    """The instrument an alert is about and who it is addressed to (D23)."""

    id: str
    institutionId: str
    assignedOfficerId: str | None


class InstrumentFacts(AlertTarget):
    """What alert messages need about an instrument."""

    type: InstrumentType
    referenceNo: str | None
    issuingBank: str | None
    amount: str | None
    maturityDate: str
    institutionName: str


_FACTS = """i.id, i.type, i.reference_no AS "referenceNo", i.issuing_bank AS "issuingBank", i.amount,
  i.maturity_date AS "maturityDate", i.institution_id AS "institutionId", inst.name AS "institutionName",
  i.assigned_officer_id AS "assignedOfficerId\""""


class ReminderCandidate(InstrumentFacts):
    daysLeft: int


def reminder_candidates(db: Db, as_of: str, max_offset: int) -> list[ReminderCandidate]:
    rows = many(
        db,
        f"""SELECT {_FACTS}, (i.maturity_date - $1::date) AS "daysLeft"
       FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
      WHERE i.status IN ('ACTIVE','EXPIRING') AND i.maturity_date - $1::date <= $2
      ORDER BY i.id""",
        [as_of, max_offset],
    )
    return cast(list[ReminderCandidate], rows)


def supersede_live(db: Db, instrument_id: str, rule_keys: list[str], at: datetime) -> list[str]:
    """D2: live reminders of looser offsets -> RESOLVED/SUPERSEDED. Returns their ids."""
    if not rule_keys:
        return []
    rows = many(
        db,
        """UPDATE alerts SET status = 'RESOLVED', resolution = 'SUPERSEDED', resolved_at = $3
      WHERE instrument_id = $1 AND kind = 'MATURITY_REMINDER' AND rule_key = ANY($2::text[])
        AND status IN ('OPEN','ACKNOWLEDGED','ESCALATED')
      RETURNING id""",
        [instrument_id, rule_keys, at],
    )
    return [r["id"] for r in rows]


class PendingVerificationCandidate(InstrumentFacts):
    submittedDate: str
    verificationState: VerificationState


def pending_verification_candidates(db: Db, as_of: str, after_days: int) -> list[PendingVerificationCandidate]:
    rows = many(
        db,
        f"""SELECT {_FACTS}, (i.submitted_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "submittedDate",
            i.verification_state AS "verificationState"
       FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
      WHERE i.status IN ('SUBMITTED','UNDER_SCRUTINY')
        AND i.verification_state IN ('UNVERIFIED','PENDING','UNAVAILABLE')
        AND i.submitted_at IS NOT NULL
        AND $1::date - (i.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= $2
      ORDER BY i.id""",
        [as_of, after_days],
    )
    return cast(list[PendingVerificationCandidate], rows)


class DiscrepancyCandidate(InstrumentFacts):
    discrepancyId: str
    fieldName: str
    reason: str
    openedDate: str


def open_discrepancy_candidates(db: Db, as_of: str, after_days: int) -> list[DiscrepancyCandidate]:
    rows = many(
        db,
        f"""SELECT {_FACTS}, d.id AS "discrepancyId", d.field_name AS "fieldName", d.reason,
            (d.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "openedDate"
       FROM discrepancies d
       JOIN instruments i ON i.id = d.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id
      WHERE d.status = 'OPEN' AND i.status NOT IN ('RENEWED','RELEASED')
        AND $1::date - (d.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2
      ORDER BY d.id""",
        [as_of, after_days],
    )
    return cast(list[DiscrepancyCandidate], rows)


class OverdueCandidate(InstrumentFacts):
    status: InstrumentStatus


def overdue_renewal_candidates(db: Db) -> list[OverdueCandidate]:
    rows = many(
        db,
        f"""SELECT {_FACTS}, i.status
       FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
      WHERE i.status IN ('MATURED','LAPSED')
        AND NOT EXISTS (SELECT 1 FROM instruments s WHERE s.parent_instrument_id = i.id AND s.status = 'ACTIVE')
      ORDER BY i.id""",
    )
    return cast(list[OverdueCandidate], rows)


class EscalationCandidate(TypedDict):
    id: str
    instrumentId: str
    kind: AlertKind
    ruleKey: str
    subjectId: str
    level: int
    status: AlertStatus
    rootAlertId: str
    recipientRole: Role
    institutionId: str
    dueDate: str
    rootMessage: str
    rootCreatedDate: str
    assignedOfficerId: str | None


def escalation_candidates(db: Db, kinds: list[str]) -> list[EscalationCandidate]:
    rows = many(
        db,
        """SELECT a.id, a.instrument_id AS "instrumentId", a.kind, a.rule_key AS "ruleKey", a.subject_id AS "subjectId",
            a.level, a.status, a.root_alert_id AS "rootAlertId", a.recipient_role AS "recipientRole",
            a.institution_id AS "institutionId", a.due_date AS "dueDate", r.message AS "rootMessage",
            (r.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "rootCreatedDate",
            i.assigned_officer_id AS "assignedOfficerId"
       FROM alerts a
       JOIN alerts r ON r.id = a.root_alert_id
       JOIN instruments i ON i.id = a.instrument_id
      WHERE a.status IN ('OPEN','ACKNOWLEDGED') AND a.kind = ANY($1::text[])
      ORDER BY a.created_at, a.id
        FOR UPDATE OF a""",
        [kinds],
    )
    return cast(list[EscalationCandidate], rows)


def mark_escalated(db: Db, alert_id: str) -> None:
    exec_(db, "UPDATE alerts SET status = 'ESCALATED' WHERE id = $1 AND status IN ('OPEN','ACKNOWLEDGED')", [alert_id])


class ResolvedAlert(TypedDict):
    id: str
    instrumentId: str
    kind: AlertKind
    level: int


def auto_resolve(db: Db, still_relevant_sql: str, at: datetime) -> list[ResolvedAlert]:
    """Closes every live alert (incl. ESCALATED links of a chain) whose condition no longer holds."""
    rows = many(
        db,
        f"""UPDATE alerts a SET status = 'RESOLVED', resolution = 'SYSTEM_CONDITION_CLEARED', resolved_at = $1
       FROM instruments i
      WHERE i.id = a.instrument_id AND a.status IN ('OPEN','ACKNOWLEDGED','ESCALATED')
        AND NOT ({still_relevant_sql})
      RETURNING a.id, a.instrument_id AS "instrumentId", a.kind, a.level""",
        [at],
    )
    return cast(list[ResolvedAlert], rows)


# ---- reading and user actions ----


class AlertItem(TypedDict):
    id: str
    instrumentId: str
    kind: AlertKind
    ruleKey: str
    subjectId: str
    level: int
    rootAlertId: str
    recipientRole: Role
    recipientUserId: str | None
    institutionId: str
    dueDate: str
    message: str
    status: AlertStatus
    resolution: AlertResolution | None
    resolutionNote: str | None
    createdAt: datetime
    acknowledgedAt: datetime | None
    resolvedAt: datetime | None
    rootCreatedAt: datetime
    ageDays: int
    instrumentReferenceNo: str | None
    instrumentType: InstrumentType
    instrumentStatus: InstrumentStatus
    issuingBank: str | None
    amount: str | None
    maturityDate: str | None
    institutionName: str


_ITEM = """a.id, a.instrument_id AS "instrumentId", a.kind, a.rule_key AS "ruleKey", a.subject_id AS "subjectId",
  a.level, a.root_alert_id AS "rootAlertId", a.recipient_role AS "recipientRole", a.recipient_user_id AS "recipientUserId",
  a.institution_id AS "institutionId", a.due_date AS "dueDate", a.message, a.status, a.resolution,
  a.resolution_note AS "resolutionNote", a.created_at AS "createdAt", a.acknowledged_at AS "acknowledgedAt",
  a.resolved_at AS "resolvedAt", r.created_at AS "rootCreatedAt",
  ($1::date - (r.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS "ageDays",
  i.reference_no AS "instrumentReferenceNo", i.type AS "instrumentType", i.status AS "instrumentStatus",
  i.issuing_bank AS "issuingBank", i.amount, i.maturity_date AS "maturityDate", inst.name AS "institutionName\""""

_FROM = """FROM alerts a
  JOIN alerts r ON r.id = a.root_alert_id
  JOIN instruments i ON i.id = a.instrument_id
  JOIN institutions inst ON inst.id = a.institution_id"""


class AlertFilters(TypedDict):
    statuses: list[AlertStatus] | None
    kind: AlertKind | None
    instrumentId: str | None
    mineUserId: str | None
    level: int | None
    page: int
    pageSize: int


def list_alerts(
    db: Db, f: AlertFilters, today: str, scope: Callable[[list[object]], str]
) -> tuple[list[AlertItem], int]:
    params: list[object] = [today]
    where = [f"true{scope(params)}"]

    def add(sql: Callable[[str], str], value: object) -> None:
        params.append(value)
        where.append(sql(f"${len(params)}"))

    if f["statuses"]:
        add(lambda p: f"a.status = ANY({p}::text[])", f["statuses"])
    if f["kind"]:
        add(lambda p: f"a.kind = {p}", f["kind"])
    if f["instrumentId"]:
        add(lambda p: f"a.instrument_id = {p}", f["instrumentId"])
    if f["mineUserId"]:
        add(lambda p: f"a.recipient_user_id = {p}", f["mineUserId"])
    if f["level"]:
        add(lambda p: f"a.level = {p}", f["level"])
    params.extend([f["pageSize"], (f["page"] - 1) * f["pageSize"]])
    rows = many(
        db,
        f"""SELECT {_ITEM}, count(*) OVER () AS total {_FROM}
      WHERE {" AND ".join(where)}
      ORDER BY a.level DESC, a.due_date ASC, a.created_at DESC, a.id
      LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        params,
    )
    total = int(rows[0]["total"]) if rows else 0
    return [cast(AlertItem, {k: v for k, v in r.items() if k != "total"}) for r in rows], total


def find_alert(db: Db, alert_id: str, today: str, scope: Callable[[list[object]], str]) -> AlertItem | None:
    params: list[object] = [today, alert_id]
    row = maybe_one(db, f"SELECT {_ITEM} {_FROM} WHERE a.id = $2{scope(params)}", params)
    return cast(AlertItem | None, row)


def lock_alert(db: Db, alert_id: str) -> AlertStatus:
    return cast(AlertStatus, one(db, "SELECT status FROM alerts WHERE id = $1 FOR UPDATE", [alert_id])["status"])


def acknowledge_alert(db: Db, alert_id: str, by: str, at: datetime) -> None:
    exec_(
        db,
        "UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_at = $3, acknowledged_by = $2 WHERE id = $1",
        [alert_id, by, at],
    )


def resolve_alert_manually(db: Db, alert_id: str, by: str, note: str, at: datetime) -> None:
    exec_(
        db,
        """UPDATE alerts SET status = 'RESOLVED', resolution = 'MANUAL', resolution_note = $3, resolved_at = $4,
            resolved_by = $2
      WHERE id = $1""",
        [alert_id, by, note, at],
    )


class AlertSummaryRow(TypedDict):
    kind: AlertKind
    level: int
    n: int


def alert_summary(db: Db, scope: Callable[[list[object]], str]) -> list[AlertSummaryRow]:
    params: list[object] = []
    rows = many(
        db,
        f"""SELECT a.kind, a.level, count(*)::int AS n FROM alerts a
      WHERE a.status IN ('OPEN','ACKNOWLEDGED'){scope(params)}
      GROUP BY a.kind, a.level ORDER BY a.kind, a.level""",
        params,
    )
    return cast(list[AlertSummaryRow], rows)


def open_alert_stats_sql(scope_sql: str, instrument_alias: str = "i") -> str:
    """Select-list expressions `worstOpenAlertLevel`, `openAlertCount` for instrument lists; `scope_sql` comes
    from scope_alert_stats_query (its parameters already appended)."""
    base = f"FROM alerts a WHERE a.instrument_id = {instrument_alias}.id AND a.status IN ('OPEN','ACKNOWLEDGED'){scope_sql}"
    return f"""(SELECT max(a.level) {base}) AS "worstOpenAlertLevel",
            (SELECT count(*)::int {base}) AS "openAlertCount\""""
