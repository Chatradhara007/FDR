from __future__ import annotations

from ..db.pool import transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of, assert_can_see
from ..domain.audit import record_event
from ..domain.errors import InvalidTransition, ValidationFailed
from ..domain.fields import same_tracked_value, tracked_value
from ..domain.state_machine import transition
from ..repositories.document_repo import list_live_documents
from ..repositories.instrument_repo import lock_instrument, set_submission_meta
from ..repositories.provenance_repo import list_provenance, upsert_provenance
from ..schemas import submission_issues
from ..shared_constants import STATUS_LABELS, TRACKED_FIELDS, VerificationState
from .instrument_service import (
    InstrumentDetail,
    assert_no_duplicate_ref,
    doc_rules,
    get_instrument,
    is_editable,
    missing_docs,
)
from .renewal_service import check_replacement, parent_of, raise_replacement_concerns


def submit_instrument(user: AuthUser, instrument_id: str) -> InstrumentDetail:
    """POST /instruments/:id/submit (2.5): DRAFT/RETURNED -> SUBMITTED with D5 provenance."""
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        assert_can_see(user, inst["institutionId"])
        if not is_editable(inst["status"]):
            raise InvalidTransition(
                inst["status"],
                "SUBMITTED",
                f"This instrument is {STATUS_LABELS[inst['status']]} and cannot be submitted again",
            )

        now = clock.now(tx)
        today = clock.ist_date(now)
        rules = doc_rules(tx)
        fields = submission_issues(inst, today)
        parent = parent_of(tx, inst)
        if parent:
            # §5.3: a replacement must mature after what it replaces (listed with every other failing field).
            seen = {i["field"] for i in fields}
            fields += [i for i in check_replacement(tx, inst, parent) if i["field"] not in seen]
        missing = missing_docs(
            rules["requiredDocs"][inst["type"]], [d["docType"] for d in list_live_documents(tx, instrument_id)]
        )
        if fields or missing:
            raise ValidationFailed({"fields": fields, "missingDocuments": missing}, "The submission is incomplete")
        assert_no_duplicate_ref(tx, inst["id"], inst["issuingBank"], inst["referenceNo"], inst["parentInstrumentId"])

        # D5: only fields whose value changed go back to CLAIMED; unchanged fields keep their tier.
        existing = {p["fieldName"]: p for p in list_provenance(tx, instrument_id)}
        changed = False
        submitted: dict[str, object] = {}
        for field in TRACKED_FIELDS:
            value = tracked_value(field, inst)
            submitted[field] = value
            prev = existing.get(field)
            if prev and same_tracked_value(field, prev["value"], value):
                continue
            changed = True
            upsert_provenance(tx, instrument_id, field, value, "CLAIMED", "institution", now)
        first_submission = inst["submittedAt"] is None
        verification_state: VerificationState = (
            "UNVERIFIED" if first_submission or changed else inst["verificationState"]
        )
        set_submission_meta(tx, instrument_id, now, verification_state)
        transition(tx, {"id": instrument_id, "status": inst["status"]}, "SUBMITTED", actor_of(user))
        if parent:
            raise_replacement_concerns(tx, inst, parent)
        record_event(
            tx,
            actor=actor_of(user),
            action="INSTRUMENT_SUBMITTED",
            entity_type="instrument",
            entity_id=instrument_id,
            instrument_id=instrument_id,
            after={
                **submitted,
                "branch": inst["branch"],
                "purpose": inst["purpose"],
                "verificationState": verification_state,
                "resubmission": not first_submission,
            },
        )
    return get_instrument(user, instrument_id)
