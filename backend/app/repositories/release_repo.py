"""SQL for release requests, their conditions and the approval chain (Phase 06)."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from typing import TypedDict, cast

from ..db.pool import Db, exec_, many, maybe_one, one
from ..domain.canonical_json import js_json
from ..shared_constants import (
    InstrumentStatus,
    InstrumentType,
    ReleaseDecision,
    ReleaseLevelAction,
    ReleaseRequestStatus,
    Role,
)


class LevelSnapshot(TypedDict):
    """One level of a request's approval chain, frozen when the request is created (§6.4)."""

    level: int
    role: Role
    action: ReleaseLevelAction
    label: str


class ReleaseRequestRow(TypedDict):
    id: str
    instrumentId: str
    institutionId: str
    requestedBy: str
    requestedByName: str
    reason: str
    status: ReleaseRequestStatus
    requiredLevels: list[LevelSnapshot]
    currentLevel: int
    returnMessage: str | None
    refundReference: str | None
    requestedAt: datetime
    stageStartedAt: datetime
    closedAt: datetime | None


_REQUEST = """r.id, r.instrument_id AS "instrumentId", i.institution_id AS "institutionId", r.requested_by AS "requestedBy",
  u.name AS "requestedByName", r.reason, r.status, r.required_levels AS "requiredLevels",
  r.current_level AS "currentLevel", r.return_message AS "returnMessage", r.refund_reference AS "refundReference",
  r.requested_at AS "requestedAt", r.stage_started_at AS "stageStartedAt", r.closed_at AS "closedAt\""""

_REQUEST_FROM = """FROM release_requests r
  JOIN instruments i ON i.id = r.instrument_id
  JOIN users u ON u.id = r.requested_by"""

OPEN_SQL = "('PENDING_CONDITIONS','PENDING_APPROVAL','RETURNED')"


def insert_request(
    db: Db, instrument_id: str, requested_by: str, reason: str, levels: Sequence[LevelSnapshot], at: datetime
) -> str:
    row = one(
        db,
        """INSERT INTO release_requests (instrument_id, requested_by, reason, required_levels, requested_at,
                                       stage_started_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $5) RETURNING id""",
        [instrument_id, requested_by, reason, js_json(list(levels)), at],
    )
    return cast(str, row["id"])


def find_request(db: Db, request_id: str) -> ReleaseRequestRow | None:
    row = maybe_one(db, f"SELECT {_REQUEST} {_REQUEST_FROM} WHERE r.id = $1", [request_id])
    return cast(ReleaseRequestRow | None, row)


def request_ids_with_prefix(db: Db, prefix: str) -> list[str]:
    """Ids of every release request (any status) whose id starts with `prefix` (hex digits only)."""
    rows = many(
        db, "SELECT id FROM release_requests WHERE id::text LIKE $1 ORDER BY seq LIMIT 3", [prefix.lower() + "%"]
    )
    return [str(r["id"]) for r in rows]


def lock_request(db: Db, request_id: str) -> ReleaseRequestRow:
    row = one(
        db,
        f"SELECT {_REQUEST} {_REQUEST_FROM} WHERE r.id = $1 FOR UPDATE OF r",
        [request_id],
        "Release request not found",
    )
    return cast(ReleaseRequestRow, row)


def find_open_request(db: Db, instrument_id: str) -> ReleaseRequestRow | None:
    """The instrument's open request, if any (at most one: one_open_release_per_instrument)."""
    row = maybe_one(
        db, f"SELECT {_REQUEST} {_REQUEST_FROM} WHERE r.instrument_id = $1 AND r.status IN {OPEN_SQL}", [instrument_id]
    )
    return cast(ReleaseRequestRow | None, row)


def requests_for_instrument(db: Db, instrument_id: str) -> list[ReleaseRequestRow]:
    """Newest first."""
    rows = many(
        db,
        f"SELECT {_REQUEST} {_REQUEST_FROM} WHERE r.instrument_id = $1 ORDER BY r.seq DESC",
        [instrument_id],
    )
    return cast(list[ReleaseRequestRow], rows)


def update_request(
    db: Db,
    request_id: str,
    *,
    status: ReleaseRequestStatus,
    current_level: int,
    stage_started_at: datetime | None = None,
    closed_at: datetime | None = None,
    return_message: str | None = None,
    refund_reference: str | None = None,
) -> None:
    """Moves a request on. `None` keeps stage_started_at / return_message / refund_reference as they are."""
    exec_(
        db,
        """UPDATE release_requests SET status = $2, current_level = $3,
            stage_started_at = COALESCE($4, stage_started_at), closed_at = $5,
            return_message = COALESCE($6, return_message), refund_reference = COALESCE($7, refund_reference)
      WHERE id = $1""",
        [request_id, status, current_level, stage_started_at, closed_at, return_message, refund_reference],
    )


# ---- conditions ----


class NewCondition(TypedDict):
    code: str
    description: str
    mandatory: bool
    auto: bool


class ConditionRow(TypedDict):
    id: str
    releaseRequestId: str
    position: int
    code: str
    description: str
    mandatory: bool
    auto: bool
    met: bool
    checkedBy: str | None
    checkedByName: str | None
    checkedAt: datetime | None
    remarks: str | None


_CONDITION = """c.id, c.release_request_id AS "releaseRequestId", c.position, c.code, c.description, c.mandatory, c.auto,
  c.met, c.checked_by AS "checkedBy", u.name AS "checkedByName", c.checked_at AS "checkedAt", c.remarks"""


def insert_conditions(db: Db, request_id: str, conditions: Sequence[NewCondition]) -> None:
    if not conditions:
        return
    exec_(
        db,
        """INSERT INTO release_conditions (release_request_id, position, code, description, mandatory, auto)
     SELECT $1, c.position, c.code, c.description, c.mandatory, c.auto
       FROM jsonb_to_recordset($2::jsonb) AS c(position int, code text, description text, mandatory boolean, auto boolean)""",
        [request_id, js_json([{**c, "position": n} for n, c in enumerate(conditions, 1)])],
    )


def list_conditions(db: Db, request_id: str) -> list[ConditionRow]:
    rows = many(
        db,
        f"""SELECT {_CONDITION} FROM release_conditions c LEFT JOIN users u ON u.id = c.checked_by
      WHERE c.release_request_id = $1 ORDER BY c.position""",
        [request_id],
    )
    return cast(list[ConditionRow], rows)


def find_condition(db: Db, condition_id: str) -> ConditionRow | None:
    row = maybe_one(
        db,
        f"SELECT {_CONDITION} FROM release_conditions c LEFT JOIN users u ON u.id = c.checked_by WHERE c.id = $1",
        [condition_id],
    )
    return cast(ConditionRow | None, row)


def set_condition(db: Db, condition_id: str, met: bool, remarks: str | None, by: str, at: datetime) -> None:
    exec_(
        db,
        "UPDATE release_conditions SET met = $2, remarks = $3, checked_by = $4, checked_at = $5 WHERE id = $1",
        [condition_id, met, remarks, by, at],
    )


# ---- approvals ----


class ApprovalRow(TypedDict):
    id: str
    releaseRequestId: str
    level: int
    role: Role
    approverId: str
    approverName: str
    approverDesignation: str | None
    decision: ReleaseDecision
    remarks: str
    conditionsSnapshot: object
    decidedAt: datetime


def insert_approval(
    db: Db,
    request_id: str,
    level: int,
    role: Role,
    approver_id: str,
    decision: ReleaseDecision,
    remarks: str,
    snapshot: object,
    at: datetime,
) -> str:
    row = one(
        db,
        """INSERT INTO release_approvals (release_request_id, level, role, approver_id, decision, remarks,
                                        conditions_snapshot, decided_at)
     VALUES ($1, $2, $3::user_role, $4, $5, $6, $7::jsonb, $8) RETURNING id""",
        [request_id, level, role, approver_id, decision, remarks, js_json(snapshot), at],
    )
    return cast(str, row["id"])


def list_approvals(db: Db, request_id: str) -> list[ApprovalRow]:
    """Oldest first: the chain as it happened, returns and resubmissions included."""
    rows = many(
        db,
        """SELECT a.id, a.release_request_id AS "releaseRequestId", a.level, a.role, a.approver_id AS "approverId",
            u.name AS "approverName", u.designation AS "approverDesignation", a.decision, a.remarks,
            a.conditions_snapshot AS "conditionsSnapshot", a.decided_at AS "decidedAt"
       FROM release_approvals a JOIN users u ON u.id = a.approver_id
      WHERE a.release_request_id = $1 ORDER BY a.seq""",
        [request_id],
    )
    return cast(list[ApprovalRow], rows)


# ---- lists ----


class ReleaseListItem(TypedDict):
    id: str
    instrumentId: str
    status: ReleaseRequestStatus
    currentLevel: int
    requiredLevels: list[LevelSnapshot]
    reason: str
    requestedAt: datetime
    stageStartedAt: datetime
    closedAt: datetime | None
    ageDays: int
    referenceNo: str | None
    instrumentType: InstrumentType
    instrumentStatus: InstrumentStatus
    issuingBank: str | None
    amount: str | None
    maturityDate: str | None
    institutionId: str
    institutionName: str


class ReleaseFilters(TypedDict):
    statuses: list[ReleaseRequestStatus] | None
    awaitingRole: Role | None
    instrumentId: str | None
    page: int
    pageSize: int


def list_requests(
    db: Db, f: ReleaseFilters, today: str, scope: Callable[[list[object]], str]
) -> tuple[list[ReleaseListItem], int]:
    """`scope` is the instrument access filter (alias i); `awaitingRole` keeps requests whose current level is that
    role's turn. Oldest waiting first."""
    params: list[object] = [today]
    where = [f"true{scope(params)}"]

    def add(sql: Callable[[str], str], value: object) -> None:
        params.append(value)
        where.append(sql(f"${len(params)}"))

    if f["statuses"]:
        add(lambda p: f"r.status = ANY({p}::text[])", f["statuses"])
    if f["awaitingRole"]:
        add(
            lambda p: (
                "r.status IN ('PENDING_CONDITIONS','PENDING_APPROVAL') AND "
                f"(r.required_levels -> (r.current_level - 1) ->> 'role') = {p}"
            ),
            f["awaitingRole"],
        )
    if f["instrumentId"]:
        add(lambda p: f"r.instrument_id = {p}", f["instrumentId"])
    params.extend([f["pageSize"], (f["page"] - 1) * f["pageSize"]])
    rows = many(
        db,
        f"""SELECT r.id, r.instrument_id AS "instrumentId", r.status, r.current_level AS "currentLevel",
            r.required_levels AS "requiredLevels", r.reason, r.requested_at AS "requestedAt",
            r.stage_started_at AS "stageStartedAt", r.closed_at AS "closedAt",
            ($1::date - (r.stage_started_at AT TIME ZONE 'Asia/Kolkata')::date) AS "ageDays",
            i.reference_no AS "referenceNo", i.type AS "instrumentType", i.status AS "instrumentStatus",
            i.issuing_bank AS "issuingBank", i.amount, i.maturity_date AS "maturityDate",
            i.institution_id AS "institutionId", inst.name AS "institutionName", count(*) OVER () AS total
       FROM release_requests r
       JOIN instruments i ON i.id = r.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id
      WHERE {" AND ".join(where)}
      ORDER BY (r.status IN {OPEN_SQL}) DESC, r.stage_started_at, r.seq
      LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        params,
    )
    total = int(rows[0]["total"]) if rows else 0
    return [cast(ReleaseListItem, {k: v for k, v in r.items() if k != "total"}) for r in rows], total


# ---- evaluation job (Phase 04 RELEASE_PENDING) ----


class ReleasePendingCandidate(TypedDict):
    requestId: str
    id: str  # the instrument (AlertTarget)
    institutionId: str
    assignedOfficerId: str | None
    type: InstrumentType
    referenceNo: str | None
    issuingBank: str | None
    amount: str | None
    institutionName: str
    status: ReleaseRequestStatus
    currentLevel: int
    level: LevelSnapshot
    stageDate: str


def release_pending_candidates(db: Db, as_of: str, after_days: int) -> list[ReleasePendingCandidate]:
    """Requests waiting at their current level for `after_days` days or more."""
    rows = many(
        db,
        """SELECT r.id AS "requestId", i.id, i.institution_id AS "institutionId",
            i.assigned_officer_id AS "assignedOfficerId", i.type, i.reference_no AS "referenceNo",
            i.issuing_bank AS "issuingBank", i.amount, inst.name AS "institutionName", r.status,
            r.current_level AS "currentLevel", r.required_levels -> (r.current_level - 1) AS level,
            (r.stage_started_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "stageDate"
       FROM release_requests r
       JOIN instruments i ON i.id = r.instrument_id
       JOIN institutions inst ON inst.id = i.institution_id
      WHERE r.status IN ('PENDING_CONDITIONS','PENDING_APPROVAL')
        AND $1::date - (r.stage_started_at AT TIME ZONE 'Asia/Kolkata')::date >= $2
      ORDER BY r.id""",
        [as_of, after_days],
    )
    return cast(list[ReleasePendingCandidate], rows)
