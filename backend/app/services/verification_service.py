"""Bank verification (§3.3). The bank is called outside any transaction (rule 9); the result is applied under
a row lock after re-checking that the instrument did not change meanwhile (D9)."""

from __future__ import annotations

from datetime import datetime
from typing import NotRequired, TypedDict

from ..db.pool import Conn, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of, assert_can_see
from ..domain.audit import record_event
from ..domain.errors import Conflict, InvalidState, NotFound
from ..domain.fields import tracked_value
from ..domain.normalize import norm_amount, norm_date
from ..repositories.discrepancy_repo import list_discrepancies, open_discrepancy, resolve_discrepancy
from ..repositories.instrument_repo import InstrumentRow, find_instrument_by_id, lock_instrument, set_verification_state
from ..repositories.provenance_repo import list_provenance, set_tier
from ..repositories.verification_repo import insert_verification
from ..shared_constants import (
    DISCREPANCY_REASONS,
    STATUS_LABELS,
    TRACKED_FIELDS,
    VERIFIABLE_STATUSES,
    TrackedField,
    VerificationResult,
    VerificationState,
)
from . import bank_client
from .advisory_service import refresh_flags
from .bank_client import BankPayload, BankResult
from .scrutiny_service import Review, get_review


class VerifyResponse(TypedDict):
    result: VerificationResult
    verificationId: str
    mismatchedFields: list[TrackedField]
    retryAfterSeconds: int | None
    reason: NotRequired[str]
    review: Review


STATE_FOR: dict[str, VerificationState] = {
    "CONFIRMED": "CONFIRMED",
    "MISMATCH": "MISMATCH",
    "NOT_FOUND": "MISMATCH",
    "PENDING": "PENDING",
    "UNAVAILABLE": "UNAVAILABLE",
}


def build_payload(inst: InstrumentRow) -> BankPayload:
    """The instrument's current values in canonical form (the same strings provenance stores)."""
    return {
        "reference_no": tracked_value("reference_no", inst),
        "bank": tracked_value("issuing_bank", inst),
        "amount": tracked_value("amount", inst),
        "issue_date": tracked_value("issue_date", inst),
        "maturity_date": tracked_value("maturity_date", inst),
        "beneficiary_name": tracked_value("beneficiary_name", inst),
        "lien_marked": tracked_value("lien_marked", inst),
    }


def _confirmed_value(field: TrackedField, value: str) -> str:
    """Defensive normalisation of the bank's value for discrepancy cards (§3.4)."""
    try:
        if field == "amount":
            return norm_amount(value)
        if field in ("issue_date", "maturity_date"):
            return norm_date(value)
    except ValueError:
        pass
    return value.strip()


def mismatched_fields(res: BankResult) -> list[TrackedField]:
    fields = res.get("fields") or {}
    return [f for f in TRACKED_FIELDS if f in fields and not fields[f]["match"]]


def _resolve_open(tx: Conn, user: AuthUser, inst_id: str, fields: set[str], response_id: str, at: datetime) -> None:
    note = f"Confirmed by bank response {response_id}"
    for d in list_discrepancies(tx, inst_id, open_only=True):
        if d["fieldName"] in fields:
            resolve_discrepancy(tx, d["id"], note, user.id, at)
            record_event(tx, actor=actor_of(user), action="DISCREPANCY_RESOLVED", entity_type="discrepancy",
                         entity_id=d["id"], instrument_id=inst_id, before={"status": "OPEN"},
                         after={"status": "RESOLVED", "note": note, "field": d["fieldName"], "automatic": True})  # fmt: skip


def _open(tx: Conn, user: AuthUser, inst_id: str, verification_id: str, field: TrackedField, claimed: str,
          confirmed: str | None, reason: str, at: datetime) -> None:  # fmt: skip
    discrepancy_id = open_discrepancy(tx, inst_id, verification_id, field, claimed, confirmed, reason, at)
    if discrepancy_id is None:
        return  # already open for this field (AC3)
    record_event(tx, actor=actor_of(user), action="DISCREPANCY_OPENED", entity_type="discrepancy",
                 entity_id=discrepancy_id, instrument_id=inst_id,
                 after={"field": field, "claimed": claimed, "confirmed": confirmed, "reason": reason,
                        "verificationId": verification_id})  # fmt: skip


def apply_result(tx: Conn, inst: InstrumentRow, verification_id: str, res: BankResult, user: AuthUser) -> None:
    """Updates tiers, discrepancies and verification_state. Never changes the lifecycle status."""
    at = clock.now(tx)
    inst_id = inst["id"]
    result = res["result"]
    source = f"bank:{res.get('response_id', verification_id)}"
    tiers = {p["fieldName"]: p["tier"] for p in list_provenance(tx, inst_id)}
    if result in ("CONFIRMED", "MISMATCH"):
        bank_fields = res.get("fields") or {}
        mismatched = set(mismatched_fields(res))
        closed_note = res.get("note")
        if closed_note and "reference_no" not in mismatched:
            # Every value matches a deposit the bank has closed: the reference itself is the problem.
            mismatched.add("reference_no")
        confirmed = [f for f in TRACKED_FIELDS if f in bank_fields and f not in mismatched]
        for f in confirmed:
            if f in tiers:
                set_tier(tx, inst_id, f, "BANK_CONFIRMED", source, at)
        _resolve_open(tx, user, inst_id, set(confirmed), res.get("response_id", verification_id), at)
        for f in TRACKED_FIELDS:
            if f not in mismatched:
                continue
            if tiers.get(f) == "BANK_CONFIRMED":
                # The earlier bank confirmation is contradicted by this response: it no longer proves the value.
                set_tier(tx, inst_id, f, "CLAIMED", "institution", at)
            bank_value = bank_fields[f]["confirmed"] if f in bank_fields else None
            reason = (
                closed_note
                if closed_note and f == "reference_no" and f not in mismatched_fields(res)
                else DISCREPANCY_REASONS[f]
            )
            _open(tx, user, inst_id, verification_id, f, tracked_value(f, inst),
                  None if bank_value is None else _confirmed_value(f, bank_value), reason, at)  # fmt: skip
    elif result == "NOT_FOUND":
        _open(tx, user, inst_id, verification_id, "reference_no", tracked_value("reference_no", inst), None,
              "No record at bank", at)  # fmt: skip
    set_verification_state(tx, inst_id, STATE_FOR[result], at)


def request_verification(user: AuthUser, instrument_id: str) -> VerifyResponse:
    db = get_pool()
    inst = find_instrument_by_id(db, instrument_id)  # read, no lock
    if inst is None:
        raise NotFound("Instrument not found")
    assert_can_see(user, inst["institutionId"])
    if inst["status"] not in VERIFIABLE_STATUSES:
        raise InvalidState(
            f"Bank verification is not possible while the instrument is {STATUS_LABELS[inst['status']]}",
            {"status": inst["status"]},
        )
    payload = build_payload(inst)
    requested_at = clock.now(db)
    res = bank_client.verify_with_bank(payload, timeout_ms=5000)  # network, no transaction

    stale = False
    with transaction() as tx:
        locked = lock_instrument(tx, instrument_id)
        stale = locked["status"] != inst["status"] or locked["version"] != inst["version"]  # D9
        result: VerificationResult = "STALE" if stale else res["result"]
        verification_id = insert_verification(
            tx,
            {
                "instrumentId": instrument_id,
                "source": f"mock-bank:{payload['bank']}",
                "requestPayload": payload,
                "responsePayload": res,
                "result": result,
                "requestedBy": user.id,
                "requestedAt": requested_at,
                "respondedAt": clock.now(tx),
            },
        )
        actor = actor_of(user)
        record_event(tx, actor=actor, action="VERIFICATION_REQUESTED", entity_type="verification",
                     entity_id=verification_id, instrument_id=instrument_id,
                     after={"requestedAt": requested_at, "bank": payload["bank"], "referenceNo": payload["reference_no"]})  # fmt: skip
        mismatched = [] if stale else mismatched_fields(res)
        record_event(tx, actor=actor, action="VERIFICATION_RESULT", entity_type="verification",
                     entity_id=verification_id, instrument_id=instrument_id,
                     after={"result": result, "bankResult": res["result"], "mismatchedFields": mismatched,
                            "responseId": res.get("response_id")})  # fmt: skip
        if not stale:
            apply_result(tx, locked, verification_id, res, user)
            refresh_flags(tx, instrument_id, actor)  # advisory only
    if stale:
        # Raised after commit so the STALE verification stays on record.
        raise Conflict("The instrument changed during verification. Verify again.", None, "INSTRUMENT_CHANGED")

    out: VerifyResponse = {
        "result": res["result"],
        "verificationId": verification_id,
        "mismatchedFields": mismatched,
        "retryAfterSeconds": res.get("retry_after_seconds") if res["result"] == "PENDING" else None,
        "review": get_review(user, instrument_id),
    }
    if "reason" in res:
        out["reason"] = res["reason"]
    return out
