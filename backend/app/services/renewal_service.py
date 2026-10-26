"""Renewal and replacement (Phase 05 §5.2–5.4): start a renewal, check a replacement against what it replaces,
and activate the chain when the replacement is accepted. The parent is never edited — it keeps its values forever."""

from __future__ import annotations

from typing import cast

from psycopg.errors import UniqueViolation

from ..db.pool import Conn, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of, assert_can_see
from ..domain.alert_text import fmt_date, fmt_inr, paise_of
from ..domain.audit import SYSTEM_ACTOR, Actor, record_event
from ..domain.errors import Conflict
from ..domain.rules import load_renewal_checks
from ..domain.state_machine import transition
from ..jobs.evaluate import resolve_cleared
from ..repositories.instrument_repo import (
    InstrumentRow,
    NewInstrument,
    find_instrument_by_id,
    find_successor,
    insert_instrument,
    lock_instrument,
)
from ..repositories.observation_repo import insert_observation, observation_text_exists
from ..repositories.release_repo import find_open_request
from ..schemas import FieldIssue
from ..shared_constants import RELEASE_REQUEST_STATUS_LABELS, RENEWABLE_STATUSES, STATUS_LABELS
from .instrument_service import FIELD_KEYS, InstrumentDetail, get_instrument


def _ref(inst: InstrumentRow) -> str:
    return inst["referenceNo"] or "the earlier instrument"


def _not_renewable_reason(tx: Conn, parent: InstrumentRow) -> str | None:
    release = find_open_request(tx, parent["id"])
    if release is not None:
        # D6: renewal and release are mutually exclusive.
        return (
            f"{_ref(parent)} has an open release request ({RELEASE_REQUEST_STATUS_LABELS[release['status']].lower()}, "
            f"requested {fmt_date(clock.ist_date(release['requestedAt']))}); cancel it before starting a renewal"
        )
    if parent["status"] in RENEWABLE_STATUSES:
        return None
    return (
        f"{_ref(parent)} is {STATUS_LABELS[parent['status']]}; only expiring, matured or lapsed instruments can be "
        "renewed"
    )


def renew(user: AuthUser, parent_id: str) -> InstrumentDetail:
    """POST /instruments/:id/renew: a new DRAFT linked to the instrument it replaces (§5.2)."""
    with transaction() as tx:
        parent = lock_instrument(tx, parent_id)
        assert_can_see(user, parent["institutionId"])
        reason = _not_renewable_reason(tx, parent)
        if reason:
            raise Conflict(reason, {"status": parent["status"]}, "NOT_RENEWABLE")
        successor = find_successor(tx, parent_id)
        if successor:
            raise Conflict(
                f"{_ref(parent)} already has a replacement ({successor['referenceNo'] or 'a draft'}, "
                f"{STATUS_LABELS[successor['status']]}). Continue that one, or delete the draft to start again.",
                {"successorId": successor["id"], "status": successor["status"]},
                "ALREADY_RENEWING",
            )
        new: NewInstrument = {
            "institutionId": parent["institutionId"],
            "type": parent["type"],
            "issuingBank": parent["issuingBank"],
            "branch": parent["branch"],
            "beneficiaryName": parent["beneficiaryName"],
            "purpose": parent["purpose"],
            "amount": parent["amount"],
            "lienMarked": False,
            "parentInstrumentId": parent_id,
        }
        try:
            with tx.transaction():
                child = insert_instrument(tx, new, clock.now(tx))
        except UniqueViolation:
            raise Conflict(f"{_ref(parent)} already has a replacement", None, "ALREADY_RENEWING") from None
        actor = actor_of(user)
        record_event(tx, actor=actor, action="INSTRUMENT_CREATED", entity_type="instrument", entity_id=child["id"],
                     instrument_id=child["id"], after={k: child[k] for k in FIELD_KEYS})  # fmt: skip
        record_event(tx, actor=actor, action="RENEWAL_STARTED", entity_type="instrument", entity_id=child["id"],
                     instrument_id=child["id"], after={"parentId": parent_id, "parentReferenceNo": parent["referenceNo"]})  # fmt: skip
        record_event(tx, actor=actor, action="RENEWAL_STARTED", entity_type="instrument", entity_id=parent_id,
                     instrument_id=parent_id, after={"childId": child["id"]})  # fmt: skip
        child_id = child["id"]
    return get_instrument(user, child_id)


def parent_of(tx: Conn, child: InstrumentRow) -> InstrumentRow | None:
    return find_instrument_by_id(tx, child["parentInstrumentId"]) if child["parentInstrumentId"] else None


def check_replacement(tx: Conn, child: InstrumentRow, parent: InstrumentRow) -> list[FieldIssue]:
    """§5.3 hard rule (submit and accept): a replacement must mature after the instrument it replaces."""
    rules = load_renewal_checks(tx)
    c, p = child["maturityDate"], parent["maturityDate"]
    if rules.require_later_maturity and c and p and c <= p:
        return [{
            "field": "maturityDate",
            "message": f"Replacement must mature after the instrument it replaces ({fmt_date(p)})",
        }]  # fmt: skip
    return []


def coverage_gap_days(prev: InstrumentRow, nxt: InstrumentRow) -> int | None:
    """Positive = gap, negative = overlap, None while a date is unknown (§5.5)."""
    if not prev["maturityDate"] or not nxt["issueDate"]:
        return None
    return clock.days_between(prev["maturityDate"], nxt["issueDate"])


def replacement_concerns(tx: Conn, child: InstrumentRow, parent: InstrumentRow) -> list[str]:
    """§5.3 soft rules: texts of the CONCERN observations a replacement should carry (officers decide)."""
    rules = load_renewal_checks(tx)
    texts: list[str] = []
    gap = coverage_gap_days(parent, child)
    if gap is not None and gap > rules.flag_coverage_gap_days:
        texts.append(
            f"Coverage gap of {gap} day{'s' if gap != 1 else ''} between maturity of {_ref(parent)} "
            f"({fmt_date(cast(str, parent['maturityDate']))}) and issue of {_ref(child)} "
            f"({fmt_date(cast(str, child['issueDate']))})"
        )
    lower = child["amount"] and parent["amount"] and paise_of(child["amount"]) < paise_of(parent["amount"])
    if rules.flag_lower_amount and lower:
        texts.append(
            f"Replacement amount {fmt_inr(cast(str, child['amount']))} is lower than the "
            f"{fmt_inr(cast(str, parent['amount']))} of {_ref(parent)} it replaces"
        )
    return texts


def raise_replacement_concerns(tx: Conn, child: InstrumentRow, parent: InstrumentRow) -> None:
    """System observations (author null, CONCERN, visible to the institution); the same text is never repeated."""
    for text in replacement_concerns(tx, child, parent):
        if observation_text_exists(tx, child["id"], text):
            continue
        o = insert_observation(tx, child["id"], None, text, "CONCERN", True, clock.now(tx))
        record_event(tx, actor=SYSTEM_ACTOR, action="OBSERVATION_ADDED", entity_type="observation", entity_id=o["id"],
                     instrument_id=child["id"],
                     after={"text": text, "severity": "CONCERN", "visibleToInstitution": True, "system": True})  # fmt: skip


def activate_renewal(tx: Conn, child: InstrumentRow, actor: Actor) -> None:
    """§5.4, inside the accept transaction after the replacement became ACTIVE. Any failure rolls the accept back."""
    if not child["parentInstrumentId"]:
        return
    parent = lock_instrument(tx, child["parentInstrumentId"])
    if parent["status"] not in RENEWABLE_STATUSES:
        raise Conflict(
            f"{_ref(parent)}, which this instrument replaces, is {STATUS_LABELS[parent['status']]} and can no "
            "longer be renewed. Nothing was changed.",
            {"parentId": parent["id"], "parentStatus": parent["status"]},
            "PARENT_NOT_RENEWABLE",
        )
    transition(tx, {"id": parent["id"], "status": parent["status"]}, "RENEWED", actor, {"renewedBy": child["id"]})
    record_event(tx, actor=actor, action="RENEWED_BY", entity_type="instrument", entity_id=parent["id"],
                 instrument_id=parent["id"], after={"childId": child["id"], "referenceNo": child["referenceNo"]})  # fmt: skip
    record_event(tx, actor=actor, action="RENEWS", entity_type="instrument", entity_id=child["id"],
                 instrument_id=child["id"], after={"parentId": parent["id"], "referenceNo": parent["referenceNo"]})  # fmt: skip
    # The parent's reminders and overdue-renewal alerts close now, so screens are right before the next job run.
    resolve_cleared(tx, parent["id"])
