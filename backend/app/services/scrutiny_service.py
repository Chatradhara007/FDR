"""Officer scrutiny (§3.5–3.7): queue, claim, document checks, observations, returns, discrepancies, accept."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TypedDict

from ..db.pool import Conn, Db, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of
from ..domain.audit import record_event
from ..domain.errors import AcceptBlocked, InvalidState, NotFound, ValidationFailed
from ..domain.fields import tracked_value
from ..domain.gaps import Gap, find_gaps
from ..domain.state_machine import transition
from ..repositories.discrepancy_repo import DiscrepancyRow, list_discrepancies, lock_discrepancy, resolve_discrepancy
from ..repositories.document_repo import find_live_document, list_live_documents
from ..repositories.instrument_repo import InstrumentRow, lock_instrument, set_acceptance, set_assigned_officer
from ..repositories.observation_repo import (
    ObservationRow,
    insert_observation,
    list_observations,
    lock_observation,
    resolve_observation,
)
from ..repositories.provenance_repo import list_provenance, set_tier
from ..repositories.return_repo import insert_return
from ..repositories.scrutiny_repo import QueueFilters, QueueItem, scrutiny_queue
from ..repositories.user_repo import find_user_by_id
from ..repositories.verification_repo import VerificationRow, list_verifications
from ..schemas import AcceptInput, DocumentCheckInput, ObservationCreate, QueueQuery
from ..shared_constants import (
    STATUS_LABELS,
    TRACKED_FIELDS,
    VERIFICATION_STATE_LABELS,
    TrackedField,
    TrustTier,
)
from .instrument_service import InstrumentDetail, doc_rules, get_instrument


class ReviewField(TypedDict):
    fieldName: TrackedField
    value: str
    tier: TrustTier
    source: str | None
    updatedAt: object


class Review(TypedDict):
    instrument: InstrumentDetail
    assignedOfficerName: str | None
    fields: list[ReviewField]
    verifications: list[VerificationRow]
    discrepancies: list[DiscrepancyRow]
    observations: list[ObservationRow]
    gaps: list[Gap]
    canAccept: bool
    canAcceptWithOverride: bool
    acceptBlockers: list[str]


class QueueResponse(TypedDict):
    items: list[QueueItem]
    total: int
    page: int
    pageSize: int


class DocumentCheckResult(TypedDict):
    unchanged: bool
    review: Review


def _gaps(db: Db, inst: InstrumentRow, documents: Sequence[str]) -> list[Gap]:
    rules = doc_rules(db)
    return find_gaps(
        {"lienMarked": inst["lienMarked"]},
        list_provenance(db, inst["id"]),
        documents,
        list_discrepancies(db, inst["id"], open_only=True),
        list_observations(db, inst["id"]),
        {"requiredDocs": rules["requiredDocs"][inst["type"]], "lienRequired": rules["lienRequired"][inst["type"]]},
    )


def _verification_blocker(inst: InstrumentRow) -> str | None:
    if inst["verificationState"] == "CONFIRMED":
        return None
    return (
        f"Not confirmed by the bank ({VERIFICATION_STATE_LABELS[inst['verificationState']]}): "
        "accepting needs an override note"
    )


def accept_blockers(db: Db, inst: InstrumentRow, documents: Sequence[str]) -> tuple[list[str], str | None]:
    """D4: (blockers an override cannot lift, the verification blocker an override note lifts)."""
    hard = [g["message"] for g in _gaps(db, inst, documents) if g["severity"] == "blocker"]
    if inst["status"] != "UNDER_SCRUTINY":
        hard.insert(0, f"Only instruments under scrutiny can be accepted (this one is {STATUS_LABELS[inst['status']]})")
    return hard, _verification_blocker(inst)


def get_review(user: AuthUser, instrument_id: str, db: Db | None = None) -> Review:
    """Everything the review page needs in one call (§3.6)."""
    db = db or get_pool()
    detail = get_instrument(user, instrument_id, db)
    prov = {p["fieldName"]: p for p in detail["provenance"]}
    fields: list[ReviewField] = []
    for f in TRACKED_FIELDS:
        p = prov.get(f)
        fields.append(
            {"fieldName": f, "value": p["value"], "tier": p["tier"], "source": p["source"], "updatedAt": p["updatedAt"]}
            if p
            else {
                "fieldName": f,
                "value": tracked_value(f, detail),
                "tier": "CLAIMED",
                "source": None,
                "updatedAt": None,
            }
        )
    documents = [d["docType"] for d in detail["documents"]]
    gaps = _gaps(db, detail, documents)
    hard, verification = accept_blockers(db, detail, documents)
    officer = None
    if detail["assignedOfficerId"]:
        u = find_user_by_id(db, detail["assignedOfficerId"])
        officer = u["name"] if u else None
    return {
        "instrument": detail,
        "assignedOfficerName": officer,
        "fields": fields,
        "verifications": list_verifications(db, instrument_id),
        "discrepancies": list_discrepancies(db, instrument_id),
        "observations": list_observations(db, instrument_id),
        "gaps": gaps,
        "canAccept": not hard and verification is None,
        "canAcceptWithOverride": not hard and verification is not None,
        "acceptBlockers": [*hard, *([verification] if verification else [])],
    }


def queue(user: AuthUser, q: QueueQuery) -> QueueResponse:
    db = get_pool()
    filters: QueueFilters = {
        "region": q.region,
        "bank": q.bank,
        "verificationState": q.verification_state,
        "assigned": q.assigned,
        "officerId": user.id,
        "page": q.page,
        "pageSize": q.page_size,
    }
    items, total = scrutiny_queue(db, filters, clock.today(db))
    return {"items": items, "total": total, "page": q.page, "pageSize": q.page_size}


def _event(tx: Conn, user: AuthUser, action: str, entity_type: str, entity_id: str, instrument_id: str,
           after: object, before: object = None) -> None:  # fmt: skip
    record_event(
        tx,
        actor=actor_of(user),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        instrument_id=instrument_id,
        before=before,
        after=after,
    )


def claim(user: AuthUser, instrument_id: str) -> Review:
    """SUBMITTED -> UNDER_SCRUTINY; the officer becomes the assigned officer."""
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        set_assigned_officer(tx, instrument_id, user.id, clock.now(tx))
        transition(tx, {"id": instrument_id, "status": inst["status"]}, "UNDER_SCRUTINY", actor_of(user))
        _event(tx, user, "INSTRUMENT_CLAIMED", "instrument", instrument_id, instrument_id,
               {"assignedOfficerId": user.id}, {"assignedOfficerId": inst["assignedOfficerId"]})  # fmt: skip
    return get_review(user, instrument_id)


def check_document(user: AuthUser, instrument_id: str, field: str, data: DocumentCheckInput) -> DocumentCheckResult:
    """§3.5: CLAIMED -> DOCUMENT against an attached document; never lowers a higher tier."""
    if field not in TRACKED_FIELDS:
        raise NotFound("Field not found")
    tracked: TrackedField = field
    unchanged = False
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        if inst["status"] != "UNDER_SCRUTINY":
            raise InvalidState(
                f"Document checks are recorded during scrutiny; this instrument is {STATUS_LABELS[inst['status']]}",
                {"status": inst["status"]},
            )
        doc = find_live_document(tx, instrument_id, data.document_id)
        if doc is None:
            raise ValidationFailed(
                [{"field": "documentId", "message": "That document is not attached to this instrument"}]
            )
        prov = {p["fieldName"]: p for p in list_provenance(tx, instrument_id)}.get(tracked)
        if prov is None:
            raise InvalidState("This field has no submitted value yet")
        if prov["tier"] == "CLAIMED":
            set_tier(tx, instrument_id, tracked, "DOCUMENT", f"document:{doc['id']}", clock.now(tx))
            _event(tx, user, "FIELD_DOCUMENT_CHECKED", "instrument", instrument_id, instrument_id,
                   {"field": tracked, "tier": "DOCUMENT", "documentId": doc["id"], "docType": doc["docType"],
                    "note": data.note}, {"field": tracked, "tier": "CLAIMED"})  # fmt: skip
        else:
            unchanged = True
    return {"unchanged": unchanged, "review": get_review(user, instrument_id)}


def add_observation(user: AuthUser, instrument_id: str, data: ObservationCreate) -> Review:
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        if inst["status"] == "DRAFT":
            raise InvalidState("Drafts cannot carry observations")
        o = insert_observation(
            tx, instrument_id, user.id, data.text, data.severity, data.visible_to_institution, clock.now(tx)
        )
        _event(tx, user, "OBSERVATION_ADDED", "observation", o["id"], instrument_id,
               {"text": o["text"], "severity": o["severity"], "visibleToInstitution": o["visibleToInstitution"]})  # fmt: skip
    return get_review(user, instrument_id)


def resolve_observation_with_note(user: AuthUser, observation_id: str, note: str) -> Review:
    """D3."""
    with transaction() as tx:
        o = lock_observation(tx, observation_id)
        if o["status"] != "OPEN":
            raise InvalidState("This observation is already resolved")
        resolve_observation(tx, observation_id, note, user.id, clock.now(tx))
        _event(tx, user, "OBSERVATION_RESOLVED", "observation", observation_id, o["instrumentId"],
               {"status": "RESOLVED", "note": note}, {"status": "OPEN"})  # fmt: skip
    return get_review(user, o["instrumentId"])


def return_instrument(user: AuthUser, instrument_id: str, reason: str) -> Review:
    """-> RETURNED with a mandatory reason the institution sees."""
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        transition(tx, {"id": instrument_id, "status": inst["status"]}, "RETURNED", actor_of(user), {"reason": reason})
        return_id = insert_return(tx, instrument_id, user.id, reason, clock.now(tx))
        _event(tx, user, "INSTRUMENT_RETURNED", "instrument", instrument_id, instrument_id,
               {"reason": reason, "returnId": return_id})  # fmt: skip
    return get_review(user, instrument_id)


def resolve_discrepancy_with_note(user: AuthUser, discrepancy_id: str, note: str) -> Review:
    """Resolving does not confirm the instrument (D4): verification_state is left as it is."""
    with transaction() as tx:
        d = lock_discrepancy(tx, discrepancy_id)
        if d["status"] != "OPEN":
            raise InvalidState("This discrepancy is already resolved")
        resolve_discrepancy(tx, discrepancy_id, note, user.id, clock.now(tx))
        _event(tx, user, "DISCREPANCY_RESOLVED", "discrepancy", discrepancy_id, d["instrumentId"],
               {"status": "RESOLVED", "note": note, "field": d["fieldName"]}, {"status": "OPEN"})  # fmt: skip
    return get_review(user, d["instrumentId"])


def after_accept(tx: Conn, inst: InstrumentRow) -> None:
    """Hook: Phase 4 adds the targeted sweep (D20), Phase 5 renewal activation."""


def accept(user: AuthUser, instrument_id: str, data: AcceptInput) -> Review:
    """D4 accept guard; every blocker is listed (409 ACCEPT_BLOCKED). The officer decides; nothing auto-accepts."""
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        documents = [d["docType"] for d in list_live_documents(tx, instrument_id)]
        hard, verification = accept_blockers(tx, inst, documents)
        reasons = [*hard, *([verification] if verification and not data.override_note else [])]
        if reasons:
            raise AcceptBlocked(reasons)
        override_note = data.override_note if verification else None
        set_acceptance(tx, instrument_id, user.id, override_note, clock.now(tx))
        transition(tx, {"id": instrument_id, "status": inst["status"]}, "ACTIVE", actor_of(user))
        _event(tx, user, "INSTRUMENT_ACCEPTED", "instrument", instrument_id, instrument_id,
               {"verificationState": inst["verificationState"], "acceptedWithOverride": override_note is not None})  # fmt: skip
        if override_note:
            _event(tx, user, "ACCEPTED_WITH_OVERRIDE", "instrument", instrument_id, instrument_id,
                   {"overrideNote": override_note, "verificationState": inst["verificationState"]})  # fmt: skip
        after_accept(tx, lock_instrument(tx, instrument_id))
    return get_review(user, instrument_id)
