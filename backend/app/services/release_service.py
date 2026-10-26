"""Release, discharge and refund (Phase 06): requests, live conditions, the approval chain and its controls.

Nothing here approves a release by itself (CLAUDE.md rule 12): every step is a person's decision, and the system
only refuses decisions that an open problem makes unsafe. Auto conditions are evaluated every time they are read
(§6.2), never stored as met, so a problem found after a recommendation still blocks the decision.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Literal, NotRequired, TypedDict

from psycopg.errors import UniqueViolation

from ..db.pool import Conn, Db, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of, assert_can_see, scope_instruments_query
from ..domain.alert_text import paise_of
from ..domain.audit import Actor, record_event
from ..domain.errors import AppError, Conflict, Forbidden, InvalidState, NotFound, ValidationFailed
from ..domain.rules import load_approval_levels, load_release_conditions, load_rules
from ..domain.state_machine import transition
from ..jobs.evaluate import resolve_cleared, sweep_instrument
from ..repositories import release_repo
from ..repositories.discrepancy_repo import list_discrepancies
from ..repositories.document_repo import list_release_documents
from ..repositories.instrument_repo import InstrumentRow, find_successor, lock_instrument
from ..repositories.observation_repo import list_observations
from ..repositories.release_repo import (
    ApprovalRow,
    ConditionRow,
    LevelSnapshot,
    NewCondition,
    ReleaseFilters,
    ReleaseListItem,
    ReleaseRequestRow,
    find_condition,
    find_open_request,
    find_request,
    insert_approval,
    insert_conditions,
    insert_request,
    list_approvals,
    list_conditions,
    lock_request,
    requests_for_instrument,
    set_condition,
    update_request,
)
from ..schemas import ConditionUpdate, DecideInput, RecommendInput, ReleaseListQuery, ReleaseRequestCreate
from ..shared_constants import (
    FIELD_LABELS,
    RELEASABLE_STATUSES,
    RELEASE_DECISION_LABELS,
    RELEASE_DOC_TYPES,
    RELEASE_REQUEST_STATUS_LABELS,
    ROLE_LABELS,
    STATUS_LABELS,
    TERMINAL_STATUSES,
    VERIFICATION_STATE_LABELS,
    ReleaseDecision,
    TrackedField,
)
from .document_service import IncomingFile, UploadResponse, store_document
from .instrument_service import DocumentInfo, get_instrument

OPEN_STATUSES = ("PENDING_CONDITIONS", "PENDING_APPROVAL", "RETURNED")
WAITING_STATUSES = ("PENDING_CONDITIONS", "PENDING_APPROVAL")


class ConditionLink(TypedDict):
    """What a failing condition points at, so the UI can open the cause."""

    type: Literal["discrepancy", "observation", "verification", "documents"]
    id: NotRequired[str]
    field: NotRequired[str]


class ConditionState(TypedDict):
    id: str
    code: str
    description: str
    mandatory: bool
    auto: bool
    met: bool
    reason: str | None
    link: ConditionLink | None
    checkedByName: str | None
    checkedAt: datetime | None
    remarks: str | None
    # Compared with the latest recommendation (None before there is one): the approver sees what changed since.
    metAtRecommendation: bool | None
    changedSinceRecommendation: bool


class SnapshotCondition(TypedDict):
    code: str
    description: str
    mandatory: bool
    auto: bool
    met: bool
    reason: str | None


class ApprovalView(TypedDict):
    id: str
    level: int
    label: str
    role: str
    approverName: str
    approverDesignation: str | None
    decision: ReleaseDecision
    remarks: str | None
    conditionsSnapshot: object
    decidedAt: datetime


class CurrentLevel(TypedDict):
    level: int
    role: str
    action: str
    label: str


class ReleaseView(TypedDict):
    request: ReleaseRequestRow
    statusLabel: str
    currentLevelInfo: CurrentLevel | None
    instrument: Mapping[str, object]
    documents: list[DocumentInfo]
    conditions: list[ConditionState]
    blocked: bool
    blockers: list[str]
    approvals: list[ApprovalView]
    orderNumber: str | None
    canRecommend: bool
    canDecide: bool
    canApprove: bool
    actionBlockers: list[str]
    canEditConditions: bool
    canUploadDocuments: bool
    canResubmit: bool
    canCancel: bool


class ReleaseListResponse(TypedDict):
    items: list[ReleaseListItem]
    total: int
    page: int
    pageSize: int


class AlreadyDecided(Conflict):
    def __init__(self, message: str, details: object = None) -> None:
        super().__init__(message, details, "ALREADY_DECIDED")


class ReleaseBlocked(Conflict):
    """409 RELEASE_BLOCKED listing every failing mandatory condition."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__(
            "This release is blocked until every mandatory condition is met", {"reasons": reasons}, "RELEASE_BLOCKED"
        )


def _ref(inst: Mapping[str, object]) -> str:
    return str(inst.get("referenceNo") or "This instrument")


# ---- chain and conditions ----


def required_levels(tx: Db, amount: str | None) -> list[LevelSnapshot]:
    """§6.4: the configured levels, plus the extra level when the amount is above the threshold (compared in paise)."""
    rule = load_approval_levels(tx)
    levels: list[LevelSnapshot] = [
        {"level": lv.level, "role": lv.role, "action": lv.action, "label": lv.label} for lv in rule.levels
    ]
    above = rule.extra_approval_above
    if rule.extra_level and above is not None and amount is not None and paise_of(amount) > paise_of(above):
        x = rule.extra_level
        levels.append({"level": len(levels) + 1, "role": x.role, "action": x.action, "label": x.label})
    return levels


def _auto_state(
    db: Db, code: str, inst: Mapping[str, object], request_id: str
) -> tuple[bool, str | None, ConditionLink | None]:
    instrument_id = str(inst["id"])
    if code == "NO_OPEN_DISCREPANCY":
        open_ = list_discrepancies(db, instrument_id, open_only=True)
        if not open_:
            return True, None, None
        d = open_[0]
        field: TrackedField = d["fieldName"]
        names = ", ".join(FIELD_LABELS.get(x["fieldName"], x["fieldName"]).lower() for x in open_)
        return False, f"Open discrepancy on {names}", {"type": "discrepancy", "id": d["id"], "field": field}
    if code == "NO_BLOCKING_OBSERVATION":
        blocking = [
            o for o in list_observations(db, instrument_id) if o["status"] == "OPEN" and o["severity"] == "BLOCKING"
        ]
        if not blocking:
            return True, None, None
        return False, f"Blocking observation: {blocking[0]['text']}", {"type": "observation", "id": blocking[0]["id"]}
    if code == "INSTRUMENT_VERIFIED":
        state = str(inst["verificationState"])
        if state == "CONFIRMED" or inst["acceptedWithOverride"]:
            return True, None, None
        label = VERIFICATION_STATE_LABELS.get(state, state)  # type: ignore[call-overload]
        return False, f"Not confirmed by the bank ({label}) and not accepted with an override", {"type": "verification"}
    if code == "REQUEST_DOCUMENTS_ATTACHED":
        if list_release_documents(db, request_id):
            return True, None, None
        return False, "No release document attached yet", {"type": "documents"}
    # A code with no automatic check (the rule model refuses these; kept safe for old rows).
    return False, "No automatic check exists for this condition", None


def evaluate_conditions(db: Db, req: ReleaseRequestRow, inst: Mapping[str, object]) -> list[ConditionState]:
    """`evaluateConditions` (§6.2): auto conditions live, manual ones as an officer recorded them."""
    recommended = _latest_recommendation(list_approvals(db, req["id"]))
    before = {c["code"]: c["met"] for c in _snapshot_of(recommended)} if recommended else {}
    out: list[ConditionState] = []
    for c in list_conditions(db, req["id"]):
        if c["auto"]:
            met, reason, link = _auto_state(db, c["code"], inst, req["id"])
        else:
            met, reason, link = c["met"], None if c["met"] else "Not yet confirmed by an officer", None
        was = before.get(c["code"]) if recommended else None
        out.append(
            {
                "id": c["id"], "code": c["code"], "description": c["description"], "mandatory": c["mandatory"],
                "auto": c["auto"], "met": met, "reason": reason, "link": link,
                "checkedByName": None if c["auto"] else c["checkedByName"],
                "checkedAt": None if c["auto"] else c["checkedAt"], "remarks": None if c["auto"] else c["remarks"],
                "metAtRecommendation": was, "changedSinceRecommendation": was is not None and was != met,
            }
        )  # fmt: skip
    return out


def blockers_of(conditions: list[ConditionState]) -> list[str]:
    return [f"{c['description']}: {c['reason']}" for c in conditions if c["mandatory"] and not c["met"]]


def snapshot(conditions: list[ConditionState]) -> list[SnapshotCondition]:
    return [
        {"code": c["code"], "description": c["description"], "mandatory": c["mandatory"], "auto": c["auto"],
         "met": c["met"], "reason": c["reason"]}
        for c in conditions
    ]  # fmt: skip


def _snapshot_of(a: ApprovalRow) -> list[SnapshotCondition]:
    raw = a["conditionsSnapshot"]
    return [c for c in raw if isinstance(c, dict)] if isinstance(raw, list) else []  # type: ignore[misc]


def _latest_recommendation(approvals: list[ApprovalRow]) -> ApprovalRow | None:
    return next((a for a in reversed(approvals) if a["decision"] == "RECOMMEND"), None)


def order_number(req: ReleaseRequestRow) -> str | None:
    """Release / Discharge Order number, derived from the request (no extra state)."""
    if req["status"] != "APPROVED" or req["closedAt"] is None:
        return None
    return f"AICTE/REL/{clock.ist_date(req['closedAt'])[:4]}/{req['id'][:8].upper()}"


# ---- whose turn ----


def _level(req: ReleaseRequestRow) -> LevelSnapshot | None:
    levels = req["requiredLevels"]
    n = req["currentLevel"]
    return levels[n - 1] if req["status"] in WAITING_STATUSES and 1 <= n <= len(levels) else None


def _sod_violation(user: AuthUser, req: ReleaseRequestRow, approvals: list[ApprovalRow]) -> str | None:
    """D27: one person acts at one level of a request only."""
    other = next((a for a in approvals if a["approverId"] == user.id and a["level"] != req["currentLevel"]), None)
    if other is None:
        return None
    return (
        f"You already acted on this request at level {other['level']} "
        f"({RELEASE_DECISION_LABELS[other['decision']].lower()}); a different person must act at level "
        f"{req['currentLevel']}"
    )


def _already_decided(req: ReleaseRequestRow, approvals: list[ApprovalRow]) -> AlreadyDecided:
    last = approvals[-1] if approvals else None
    if last is not None:
        msg = (
            f"This request was already decided by {last['approverName']} "
            f"({RELEASE_DECISION_LABELS[last['decision']]}, level {last['level']}). Reload to see where it stands."
        )
    else:
        msg = f"This request is {RELEASE_REQUEST_STATUS_LABELS[req['status']].lower()}. Reload to see where it stands."
    return AlreadyDecided(msg, {"status": req["status"], "currentLevel": req["currentLevel"]})


def _assert_turn(
    user: AuthUser, req: ReleaseRequestRow, approvals: list[ApprovalRow], expected_level: int
) -> LevelSnapshot:
    """The request is waiting at the level the client saw, it is this role's level, and D27 holds."""
    level = _level(req)
    if level is None or expected_level != req["currentLevel"]:
        raise _already_decided(req, approvals)
    if level["role"] != user.role:
        raise Forbidden(f"Level {level['level']} ({level['label']}) is for the {ROLE_LABELS[level['role']].lower()}")
    sod = _sod_violation(user, req, approvals)
    if sod:
        raise AppError("SEPARATION_OF_DUTIES", sod, {"currentLevel": req["currentLevel"]}, 403)
    return level


# ---- reading ----


def _approval_views(approvals: list[ApprovalRow], req: ReleaseRequestRow, internal: bool) -> list[ApprovalView]:
    labels = {lv["level"]: lv["label"] for lv in req["requiredLevels"]}
    return [
        {
            "id": a["id"], "level": a["level"], "label": labels.get(a["level"], f"Level {a['level']}"), "role": a["role"],
            "approverName": a["approverName"], "approverDesignation": a["approverDesignation"], "decision": a["decision"],
            # D24: institutions see the remarks addressed to them (returns and rejections), not internal notes.
            "remarks": a["remarks"] if internal or a["decision"] in ("RETURN", "REJECT") else None,
            "conditionsSnapshot": a["conditionsSnapshot"] if internal else None,
            "decidedAt": a["decidedAt"],
        }
        for a in approvals
    ]  # fmt: skip


def _closed_conditions(db: Db, req: ReleaseRequestRow, approvals: list[ApprovalRow]) -> list[ConditionState] | None:
    """A closed request shows the conditions as they stood at its last decision."""
    if req["status"] in OPEN_STATUSES or not approvals:
        return None
    snap = {c["code"]: c for c in _snapshot_of(approvals[-1])}
    rows: list[ConditionRow] = list_conditions(db, req["id"])
    out: list[ConditionState] = []
    for c in rows:
        s = snap.get(c["code"])
        met = bool(s["met"]) if s else c["met"]
        out.append(
            {
                "id": c["id"], "code": c["code"], "description": c["description"], "mandatory": c["mandatory"],
                "auto": c["auto"], "met": met, "reason": s["reason"] if s else None, "link": None,
                "checkedByName": None if c["auto"] else c["checkedByName"],
                "checkedAt": None if c["auto"] else c["checkedAt"], "remarks": None if c["auto"] else c["remarks"],
                "metAtRecommendation": None, "changedSinceRecommendation": False,
            }
        )  # fmt: skip
    return out


def build_view(db: Db, user: AuthUser, req: ReleaseRequestRow) -> ReleaseView:
    internal = user.role != "institution"
    detail = get_instrument(user, req["instrumentId"], db)
    if not internal:
        detail = {**detail, "overrideNote": None}
    approvals = list_approvals(db, req["id"])
    conditions = _closed_conditions(db, req, approvals) or evaluate_conditions(db, req, detail)
    blockers = blockers_of(conditions) if req["status"] in OPEN_STATUSES else []
    level = _level(req)

    can_recommend = can_decide = False
    action_blockers: list[str] = []
    if level is not None and level["role"] == user.role:
        sod = _sod_violation(user, req, approvals)
        if sod:
            action_blockers.append(sod)
        else:
            can_recommend = level["action"] == "RECOMMEND"
            can_decide = True  # DECIDE levels decide; a RECOMMEND level may still return or reject
            action_blockers.extend(blockers)
    is_owner = user.role == "institution"
    return {
        "request": req,
        "statusLabel": RELEASE_REQUEST_STATUS_LABELS[req["status"]],
        "currentLevelInfo": dict(level) if level else None,  # type: ignore[typeddict-item]
        "instrument": detail,
        "documents": [
            {k: v for k, v in d.items() if k != "storagePath"}  # type: ignore[misc]
            for d in list_release_documents(db, req["id"])
        ],
        "conditions": conditions,
        "blocked": bool(blockers),
        "blockers": blockers,
        "approvals": _approval_views(approvals, req, internal),
        "orderNumber": order_number(req),
        "canRecommend": can_recommend and not blockers,
        "canDecide": can_decide,
        "canApprove": can_decide and level is not None and level["action"] == "DECIDE" and not blockers,
        "actionBlockers": action_blockers,
        "canEditConditions": user.role == "officer" and req["status"] == "PENDING_CONDITIONS",
        "canUploadDocuments": is_owner and req["status"] in ("PENDING_CONDITIONS", "RETURNED"),
        "canResubmit": is_owner and req["status"] == "RETURNED",
        "canCancel": is_owner and req["status"] in ("PENDING_CONDITIONS", "RETURNED"),
    }


def _visible_request(db: Db, user: AuthUser, request_id: str) -> ReleaseRequestRow:
    req = find_request(db, request_id)
    if req is None:
        raise NotFound("Release request not found")
    assert_can_see(user, req["institutionId"], "Release request")
    return req


def get_request(user: AuthUser, request_id: str) -> ReleaseView:
    db = get_pool()
    return build_view(db, user, _visible_request(db, user, request_id))


def views_for_instrument(db: Db, user: AuthUser, instrument_id: str) -> list[ReleaseView]:
    """The passport's Release tab (newest first). The caller has already checked access to the instrument."""
    return [build_view(db, user, r) for r in requests_for_instrument(db, instrument_id)]


def list_requests(user: AuthUser, q: ReleaseListQuery) -> ReleaseListResponse:
    db = get_pool()
    filters: ReleaseFilters = {
        "statuses": q.status,
        "awaitingRole": user.role if q.awaiting_me else None,
        "instrumentId": q.instrument_id,
        "page": q.page,
        "pageSize": q.page_size,
    }
    items, total = release_repo.list_requests(db, filters, clock.today(db), lambda p: scope_instruments_query(user, p))
    return {"items": items, "total": total, "page": q.page, "pageSize": q.page_size}


# ---- actions ----


def _event(tx: Conn, actor: Actor, action: str, req_id: str, instrument_id: str, after: object,
           before: object = None) -> None:  # fmt: skip
    record_event(tx, actor=actor, action=action, entity_type="release_request", entity_id=req_id,
                 instrument_id=instrument_id, before=before, after=after)  # fmt: skip


def not_releasable_reason(tx: Db, inst: InstrumentRow) -> str | None:
    """Why a release request cannot be made now (§6.3 step 1, D6), or None."""
    ref = _ref(inst)
    if inst["status"] == "RENEWED":
        return f"{ref} has been renewed; only its live replacement can be released"
    if inst["status"] not in RELEASABLE_STATUSES:
        return (
            f"{ref} is {STATUS_LABELS[inst['status']]}; only active, expiring, matured or lapsed instruments can be "
            "released"
        )
    successor = find_successor(tx, inst["id"])
    if successor and successor["status"] not in TERMINAL_STATUSES:
        # D6: renewal and release are mutually exclusive.
        what = successor["referenceNo"] or "a draft"
        return (
            f"{ref} has a replacement in progress ({what}, {STATUS_LABELS[successor['status']]}). Finish the renewal, "
            "or delete the replacement draft, before requesting release."
        )
    return None


def create_request(user: AuthUser, instrument_id: str, data: ReleaseRequestCreate) -> ReleaseView:
    """POST /instruments/:id/release-requests (institution, own)."""
    actor = actor_of(user)
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        assert_can_see(user, inst["institutionId"])
        existing = find_open_request(tx, instrument_id)
        if existing:
            raise Conflict(
                f"{_ref(inst)} already has an open release request "
                f"({RELEASE_REQUEST_STATUS_LABELS[existing['status']].lower()})",
                {"releaseRequestId": existing["id"]},
                "RELEASE_ALREADY_REQUESTED",
            )
        reason = not_releasable_reason(tx, inst)
        if reason:
            raise Conflict(reason, {"status": inst["status"]}, "NOT_RELEASABLE")
        levels = required_levels(tx, inst["amount"])
        conditions: list[NewCondition] = [
            {"code": c.code, "description": c.description, "mandatory": c.mandatory, "auto": c.auto}
            for c in load_release_conditions(tx).conditions
        ]
        try:
            with tx.transaction():
                req_id = insert_request(tx, instrument_id, user.id, data.reason, levels, clock.now(tx))
        except UniqueViolation:
            raise Conflict(
                f"{_ref(inst)} already has an open release request", None, "RELEASE_ALREADY_REQUESTED"
            ) from None
        insert_conditions(tx, req_id, conditions)
        transition(tx, {"id": instrument_id, "status": inst["status"]}, "RELEASE_REQUESTED", actor,
                   {"releaseRequestId": req_id})  # fmt: skip
        _event(tx, actor, "RELEASE_REQUESTED", req_id, instrument_id,
               {"reason": data.reason, "statusBeforeRelease": inst["status"], "requiredLevels": levels})  # fmt: skip
        resolve_cleared(tx, instrument_id)
    return get_request(user, req_id)


def upload_release_document(
    user: AuthUser, request_id: str, raw_doc_type: object, file: IncomingFile | None
) -> UploadResponse:
    """POST /release-requests/:id/documents: same upload rules as Phase 2, release doc types only, while the request
    is with the institution (PENDING_CONDITIONS or RETURNED)."""

    def visible() -> str:
        return _visible_request(get_pool(), user, request_id)["instrumentId"]

    def lock(tx: Conn) -> None:
        req = lock_request(tx, request_id)
        if req["status"] not in ("PENDING_CONDITIONS", "RETURNED"):
            raise InvalidState(
                f"Documents can be added while conditions are being checked or the request is returned; it is "
                f"{RELEASE_REQUEST_STATUS_LABELS[req['status']].lower()}",
                {"status": req["status"]},
            )

    return store_document(user, raw_doc_type, file, RELEASE_DOC_TYPES, visible, lock, request_id)


def update_condition(user: AuthUser, condition_id: str, data: ConditionUpdate) -> ReleaseView:
    """PATCH /release-conditions/:id (officer, manual conditions, while conditions are being checked)."""
    with transaction() as tx:
        cond = find_condition(tx, condition_id)
        if cond is None:
            raise NotFound("Release condition not found")
        req = lock_request(tx, cond["releaseRequestId"])
        lock_instrument(tx, req["instrumentId"])
        if cond["auto"]:
            raise InvalidState("This condition is checked automatically every time it is read")
        if req["status"] != "PENDING_CONDITIONS":
            raise InvalidState(
                f"Conditions are checked before the recommendation; this request is "
                f"{RELEASE_REQUEST_STATUS_LABELS[req['status']].lower()}",
                {"status": req["status"]},
            )
        set_condition(tx, condition_id, data.met, data.remarks, user.id, clock.now(tx))
        record_event(tx, actor=actor_of(user), action="RELEASE_CONDITION_CHECKED", entity_type="release_condition",
                     entity_id=condition_id, instrument_id=req["instrumentId"],
                     before={"met": cond["met"], "remarks": cond["remarks"]},
                     after={"code": cond["code"], "description": cond["description"], "met": data.met,
                            "remarks": data.remarks, "releaseRequestId": req["id"]})  # fmt: skip
        req_id = req["id"]
    return get_request(user, req_id)


def recommend(user: AuthUser, request_id: str, data: RecommendInput) -> ReleaseView:
    """Records the RECOMMEND of the current level; refused (409 RELEASE_BLOCKED) unless every mandatory condition is
    met. The request moves to its next level."""
    actor = actor_of(user)
    with transaction() as tx:
        req = lock_request(tx, request_id)
        inst = lock_instrument(tx, req["instrumentId"])
        approvals = list_approvals(tx, request_id)
        level = _assert_turn(user, req, approvals, data.level)
        if level["action"] != "RECOMMEND":
            raise InvalidState(f"Level {level['level']} decides: approve, return or reject the request")
        conditions = evaluate_conditions(tx, req, inst)
        blockers = blockers_of(conditions)
        if blockers:
            raise ReleaseBlocked(blockers)
        now = clock.now(tx)
        snap = snapshot(conditions)
        insert_approval(tx, request_id, level["level"], user.role, user.id, "RECOMMEND", data.remarks, snap, now)
        update_request(
            tx, request_id, status="PENDING_APPROVAL", current_level=level["level"] + 1, stage_started_at=now
        )
        _event(tx, actor, "RELEASE_RECOMMENDED", request_id, inst["id"],
               {"level": level["level"], "remarks": data.remarks, "conditions": snap}, {"status": req["status"]})  # fmt: skip
        resolve_cleared(tx, inst["id"])
    return get_request(user, request_id)


def _restore(tx: Conn, inst: InstrumentRow, actor: Actor, request_id: str) -> None:
    """RELEASE_REQUESTED -> the status it had before, then the targeted sweep (D20) moves it on if time passed."""
    back = inst["statusBeforeRelease"] or "ACTIVE"
    transition(tx, {"id": inst["id"], "status": inst["status"]}, back, actor, {"releaseRequestId": request_id})
    sweep_instrument(tx, {"id": inst["id"], "status": back, "maturityDate": inst["maturityDate"]}, clock.today(tx),
                     load_rules(tx))  # fmt: skip


def decide(user: AuthUser, request_id: str, data: DecideInput) -> ReleaseView:
    """APPROVE / REJECT / RETURN at the current level. Auto conditions are recomputed first; a failing mandatory
    condition refuses APPROVE (409 RELEASE_BLOCKED) — return and reject stay possible."""
    actor = actor_of(user)
    with transaction() as tx:
        req = lock_request(tx, request_id)
        inst = lock_instrument(tx, req["instrumentId"])
        approvals = list_approvals(tx, request_id)
        level = _assert_turn(user, req, approvals, data.level)
        if data.decision == "APPROVE" and level["action"] != "DECIDE":
            raise ValidationFailed(
                [{"field": "decision", "message": "This level recommends: use Recommend once the conditions are met"}]
            )
        conditions = evaluate_conditions(tx, req, inst)
        if data.decision == "APPROVE":
            blockers = blockers_of(conditions)
            if blockers:
                raise ReleaseBlocked(blockers)
        now = clock.now(tx)
        snap = snapshot(conditions)
        n = level["level"]
        insert_approval(tx, request_id, n, user.role, user.id, data.decision, data.remarks, snap, now)
        before = {"status": req["status"], "currentLevel": n}

        if data.decision == "APPROVE" and n < len(req["requiredLevels"]):
            update_request(tx, request_id, status="PENDING_APPROVAL", current_level=n + 1, stage_started_at=now)
            _event(tx, actor, "RELEASE_LEVEL_APPROVED", request_id, inst["id"],
                   {"level": n, "label": level["label"], "remarks": data.remarks, "nextLevel": n + 1}, before)  # fmt: skip
        elif data.decision == "APPROVE":
            update_request(tx, request_id, status="APPROVED", current_level=n, closed_at=now,
                           refund_reference=data.refund_reference)  # fmt: skip
            transition(
                tx, {"id": inst["id"], "status": inst["status"]}, "RELEASED", actor, {"releaseRequestId": request_id}
            )
            chain = [
                {"level": a["level"], "role": a["role"], "by": a["approverName"], "decision": a["decision"],
                 "remarks": a["remarks"], "at": a["decidedAt"]}
                for a in list_approvals(tx, request_id)
            ]  # fmt: skip
            closed = find_request(tx, request_id)
            assert closed is not None
            _event(tx, actor, "RELEASE_APPROVED", request_id, inst["id"],
                   {"conditions": snap, "approvals": chain, "refundReference": data.refund_reference,
                    "orderNumber": order_number(closed), "requiredLevels": req["requiredLevels"]}, before)  # fmt: skip
        elif data.decision == "REJECT":
            update_request(tx, request_id, status="REJECTED", current_level=n, closed_at=now)
            _event(tx, actor, "RELEASE_REJECTED", request_id, inst["id"], {"level": n, "remarks": data.remarks}, before)
            _restore(tx, inst, actor, request_id)
        else:
            update_request(tx, request_id, status="RETURNED", current_level=n, return_message=data.remarks)
            _event(tx, actor, "RELEASE_RETURNED", request_id, inst["id"], {"level": n, "message": data.remarks}, before)
        # Released: every open alert closes; otherwise the request's own RELEASE_PENDING alerts follow its level.
        resolve_cleared(tx, inst["id"])
    return get_request(user, request_id)


def _own_request_locked(tx: Conn, user: AuthUser, request_id: str) -> ReleaseRequestRow:
    req = lock_request(tx, request_id)
    assert_can_see(user, req["institutionId"], "Release request")
    return req


def resubmit(user: AuthUser, request_id: str, note: str) -> ReleaseView:
    """D21: RETURNED -> PENDING_CONDITIONS at level 1; the history stays in release_approvals and events."""
    with transaction() as tx:
        req = _own_request_locked(tx, user, request_id)
        if req["status"] != "RETURNED":
            raise InvalidState(
                f"Only a returned request can be resubmitted; this one is "
                f"{RELEASE_REQUEST_STATUS_LABELS[req['status']].lower()}",
                {"status": req["status"]},
            )
        update_request(tx, request_id, status="PENDING_CONDITIONS", current_level=1, stage_started_at=clock.now(tx))
        _event(tx, actor_of(user), "RELEASE_RESUBMITTED", request_id, req["instrumentId"], {"note": note},
               {"status": "RETURNED", "returnMessage": req["returnMessage"]})  # fmt: skip
    return get_request(user, request_id)


def cancel(user: AuthUser, request_id: str) -> ReleaseView:
    """D14: the institution withdraws a request with the institution or not yet recommended; the instrument goes back
    to its earlier status and the targeted sweep runs."""
    actor = actor_of(user)
    with transaction() as tx:
        req = _own_request_locked(tx, user, request_id)
        if req["status"] not in ("PENDING_CONDITIONS", "RETURNED"):
            raise InvalidState(
                f"A request can be cancelled before it is recommended or while it is returned; this one is "
                f"{RELEASE_REQUEST_STATUS_LABELS[req['status']].lower()}",
                {"status": req["status"]},
            )
        inst = lock_instrument(tx, req["instrumentId"])
        update_request(tx, request_id, status="CANCELLED", current_level=req["currentLevel"], closed_at=clock.now(tx))
        _event(tx, actor, "RELEASE_CANCELLED", request_id, inst["id"], {"status": "CANCELLED"},
               {"status": req["status"]})  # fmt: skip
        _restore(tx, inst, actor, request_id)
        resolve_cleared(tx, inst["id"])
    return get_request(user, request_id)
