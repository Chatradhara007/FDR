"""The evaluation job (Phase 04 §4.2): status sweeps, maturity reminders, process alerts, escalation (D11) and
auto-resolution, in that order, in one transaction. Behaves the same for a real day passing and a clock jump.

Every alert insert is deduplicated by `dedupe_key` (D1) and only rows actually inserted are counted, so a second run
on the same date changes nothing.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import TypedDict

from ..db.pool import Conn, exec_
from ..domain import clock
from ..domain.alert_text import days_text, describe, email_body, email_subject, fmt_date
from ..domain.audit import NIL_UUID, SYSTEM_ACTOR, record_event
from ..domain.canonical_json import iso_ms
from ..domain.rules import Rules, load_rules
from ..domain.state_machine import transition
from ..repositories.alert_repo import (
    AlertTarget,
    InsertedAlert,
    NewAlert,
    SweepCandidate,
    auto_resolve,
    escalation_candidates,
    has_submitted_successor,
    insert_alerts,
    mark_escalated,
    open_discrepancy_candidates,
    overdue_renewal_candidates,
    pending_verification_candidates,
    reminder_candidates,
    supersede_live,
    sweep_candidates,
)
from ..repositories.outbox_repo import NewOutboxMessage, insert_outbox
from ..shared_constants import (
    ALERT_KIND_LABELS,
    FIELD_LABELS,
    ROLE_LABELS,
    AlertKind,
    AlertResolution,
    AlertStatus,
    InstrumentStatus,
    Role,
    TrackedField,
)

JOB_LOCK = 42


class Summary(TypedDict):
    asOf: str
    statusChanges: int
    alertsCreated: int
    escalations: int
    resolved: int
    superseded: int


# ---- Step 1: status sweeps (D20: also used for one instrument after accept / restore) ----


def _next_status(
    tx: Conn, inst_id: str, status: InstrumentStatus, maturity: str, as_of: str, rules: Rules
) -> InstrumentStatus | None:
    days_left = clock.days_between(as_of, maturity)
    if status == "ACTIVE" and days_left <= rules.expiring_window:
        return "EXPIRING"
    if status == "EXPIRING" and days_left <= 0:
        return "MATURED"
    if status == "MATURED" and as_of > clock.add_days(maturity, rules.grace_days):
        return None if has_submitted_successor(tx, inst_id) else "LAPSED"
    return None


def sweep_instrument(tx: Conn, inst: SweepCandidate, as_of: str, rules: Rules) -> int:
    """Applies the status rules one after another (ACTIVE -> EXPIRING -> MATURED -> LAPSED can cascade in one call).
    The caller holds the row lock. Returns the number of transitions."""
    if inst["maturityDate"] is None:
        return 0
    status = inst["status"]
    changes = 0
    while (to := _next_status(tx, inst["id"], status, inst["maturityDate"], as_of, rules)) is not None:
        transition(tx, {"id": inst["id"], "status": status}, to, SYSTEM_ACTOR, {"asOf": as_of})
        status = to
        changes += 1
    return changes


def sweep_statuses(tx: Conn, as_of: str, rules: Rules) -> int:
    return sum(
        sweep_instrument(tx, c, as_of, rules)
        for c in sweep_candidates(tx, as_of, rules.expiring_window, rules.grace_days)
    )


# ---- alert building ----


@dataclass
class _Batch:
    """Alerts to insert in one statement; outbox rows are written only for live alerts actually inserted."""

    now: datetime
    alerts: list[NewAlert]
    emails: dict[str, tuple[str, str]]  # alert id -> (subject, body)

    def add(
        self,
        target: AlertTarget,
        kind: AlertKind,
        rule_key: str,
        recipient: Role,
        due_date: str,
        message: str,
        subject: str,
        *,
        subject_id: str = "-",
        level: int = 1,
        root_alert_id: str | None = None,
        resolution: AlertResolution | None = None,
    ) -> None:
        alert_id = str(uuid.uuid4())
        status: AlertStatus = "RESOLVED" if resolution else "OPEN"
        self.alerts.append(
            {
                "id": alert_id,
                "instrument_id": target["id"],
                "kind": kind,
                "rule_key": rule_key,
                "subject_id": subject_id,
                "level": level,
                "root_alert_id": root_alert_id or alert_id,
                "recipient_role": recipient,
                # D23: officer alerts go to the assigned officer, else the pool; other roles go to their pool.
                "recipient_user_id": target["assignedOfficerId"] if recipient == "officer" else None,
                "institution_id": target["institutionId"],
                "due_date": due_date,
                "message": message,
                "status": status,
                "resolution": resolution,
                "dedupe_key": "|".join([target["id"], kind, rule_key, subject_id, due_date, str(level), recipient]),
                "created_at": iso_ms(self.now),
                "resolved_at": iso_ms(self.now) if resolution else None,
            }
        )
        if resolution is None:
            self.emails[alert_id] = (subject, email_body(recipient, message, level))

    def flush(self, tx: Conn) -> list[InsertedAlert]:
        inserted = insert_alerts(tx, self.alerts)
        insert_outbox(
            tx,
            [
                NewOutboxMessage(
                    alert_id=a["id"],
                    to_role=a["recipientRole"],
                    to_user_id=a["recipientUserId"],
                    to_institution_id=a["institutionId"] if a["recipientRole"] == "institution" else None,
                    subject=self.emails[a["id"]][0],
                    body=self.emails[a["id"]][1],
                    created_at=iso_ms(self.now),
                )
                for a in inserted
                if a["id"] in self.emails
            ],
        )
        self.alerts, self.emails = [], {}
        return inserted


def _batch(tx: Conn) -> _Batch:
    return _Batch(clock.now(tx), [], {})


def _resolved_event(
    tx: Conn, alert_id: str, instrument_id: str, resolution: AlertResolution, before: AlertStatus | None = None
) -> None:
    record_event(
        tx,
        actor=SYSTEM_ACTOR,
        action="ALERT_RESOLVED",
        entity_type="alert",
        entity_id=alert_id,
        instrument_id=instrument_id,
        before={"status": before} if before else None,
        after={"status": "RESOLVED", "resolution": resolution},
    )


# ---- Step 2: maturity reminders (D2) ----


def maturity_reminders(tx: Conn, as_of: str, rules: Rules) -> tuple[int, int]:
    """Returns (live reminders created, reminders superseded)."""
    offsets = sorted(rules.reminder.offsets, key=lambda o: o.days)  # tightest first
    batch = _batch(tx)
    superseded = 0
    for c in reminder_candidates(tx, as_of, max(o.days for o in offsets)):
        crossed = [o for o in offsets if c["daysLeft"] <= o.days]
        if not crossed:
            continue
        tightest = crossed[0]
        what = describe(c["type"], c["referenceNo"], c["amount"], c["issuingBank"])
        message = (
            f"{what} matures on {fmt_date(c['maturityDate'])} — {days_text(c['daysLeft'])} left. "
            "Arrange renewal or release."
        )
        subject = email_subject("Reminder", f"{what.split(' (')[0]} matures in {days_text(c['daysLeft'])}")
        for role in tightest.recipients:
            batch.add(c, "MATURITY_REMINDER", f"maturity:{tightest.days}", role, c["maturityDate"], message, subject)
        looser = [o for o in offsets if o.days > tightest.days]
        for alert_id in supersede_live(tx, c["id"], [f"maturity:{o.days}" for o in looser], batch.now):
            _resolved_event(tx, alert_id, c["id"], "SUPERSEDED")
            superseded += 1
        for o in looser:
            for role in o.recipients:
                batch.add(c, "MATURITY_REMINDER", f"maturity:{o.days}", role, c["maturityDate"],
                          f"{what} — {o.days}-day reminder, superseded by a closer one.", subject,
                          resolution="SUPERSEDED")  # fmt: skip
    inserted = batch.flush(tx)
    created = sum(1 for a in inserted if a["status"] != "RESOLVED")
    return created, superseded + (len(inserted) - created)


# ---- Step 3: process alerts (one creator per kind) ----


def _pending_verification(tx: Conn, as_of: str, rules: Rules, batch: _Batch) -> None:
    r = rules.pending_verification
    for c in pending_verification_candidates(tx, as_of, r.after_days):
        age = clock.days_between(c["submittedDate"], as_of)
        what = describe(c["type"], c["referenceNo"], c["amount"], c["issuingBank"])
        message = (
            f"{what} from {c['institutionName']} has waited {days_text(age)} for bank verification "
            f"(submitted {fmt_date(c['submittedDate'])})."
        )
        subject = email_subject("Action needed", f"verification pending for {c['referenceNo'] or 'an instrument'}")
        due = clock.add_days(c["submittedDate"], r.after_days)
        for role in r.recipients:
            batch.add(c, "PENDING_VERIFICATION", "pending_verification", role, due, message, subject)


def _discrepancy_open(tx: Conn, as_of: str, rules: Rules, batch: _Batch) -> None:
    r = rules.discrepancy_open
    for c in open_discrepancy_candidates(tx, as_of, r.after_days):
        field: TrackedField = c["fieldName"]  # type: ignore[assignment]
        what = describe(c["type"], c["referenceNo"], c["amount"], c["issuingBank"])
        message = (
            f"Discrepancy on {FIELD_LABELS.get(field, c['fieldName']).lower()} for {what} has been open since "
            f"{fmt_date(c['openedDate'])}: {c['reason']}."
        )
        subject = email_subject("Action needed", f"open discrepancy on {c['referenceNo'] or 'an instrument'}")
        due = clock.add_days(c["openedDate"], r.after_days)
        for role in r.recipients:
            batch.add(c, "DISCREPANCY_OPEN", "discrepancy_open", role, due, message, subject,
                      subject_id=c["discrepancyId"])  # fmt: skip


def _overdue_renewal(tx: Conn, as_of: str, rules: Rules, batch: _Batch) -> None:
    r = rules.overdue_renewal
    for c in overdue_renewal_candidates(tx):
        what = describe(c["type"], c["referenceNo"], c["amount"], c["issuingBank"])
        grace_end = clock.add_days(c["maturityDate"], r.grace_days)
        if c["status"] == "LAPSED":
            message = (
                f"{what} lapsed: it matured on {fmt_date(c['maturityDate'])} and was not renewed by the end of the "
                f"grace period ({fmt_date(grace_end)})."
            )
            subject = email_subject("Overdue", f"{c['referenceNo'] or 'an instrument'} has lapsed without renewal")
        else:
            message = (
                f"{what} matured on {fmt_date(c['maturityDate'])} and is not renewed; grace ends {fmt_date(grace_end)}."
            )
            subject = email_subject(
                "Overdue", f"{c['referenceNo'] or 'an instrument'} matured — renew by {fmt_date(grace_end)}"
            )
        for role in r.recipients:
            batch.add(c, "OVERDUE_RENEWAL", "overdue_renewal", role, grace_end, message, subject)


def _release_pending(tx: Conn, as_of: str, rules: Rules, batch: _Batch) -> None:
    """Phase 6 fills this in (release requests do not exist yet)."""


Creator = Callable[[Conn, str, Rules, _Batch], None]

# Kind handlers: how each kind's alerts are created, and the SQL condition under which a live alert still applies
# (alias `a` = alerts, `i` = its instrument). Alerts on RELEASED / RENEWED instruments never apply.
KIND_HANDLERS: dict[AlertKind, tuple[Creator, str]] = {
    "MATURITY_REMINDER": (lambda *_: None, "i.status IN ('ACTIVE','EXPIRING','RELEASE_REQUESTED')"),
    "PENDING_VERIFICATION": (
        _pending_verification,
        "i.status IN ('SUBMITTED','UNDER_SCRUTINY') AND i.verification_state <> 'CONFIRMED'",
    ),
    "DISCREPANCY_OPEN": (
        _discrepancy_open,
        "EXISTS (SELECT 1 FROM discrepancies d WHERE d.id::text = a.subject_id AND d.status = 'OPEN')",
    ),
    "OVERDUE_RENEWAL": (_overdue_renewal, "i.status IN ('MATURED','LAPSED')"),
    "RELEASE_PENDING": (_release_pending, "true"),
}


def process_alerts(tx: Conn, as_of: str, rules: Rules) -> int:
    batch = _batch(tx)
    for create, _ in KIND_HANDLERS.values():
        create(tx, as_of, rules, batch)
    return len(batch.flush(tx))


# ---- Step 4: escalation (D11) ----


def escalate(tx: Conn, as_of: str, rules: Rules) -> int:
    ladder = {lv.level: lv for lv in rules.escalation.levels}
    escalations = 0
    for a in escalation_candidates(tx, list(rules.escalation.kinds)):
        current = ladder.get(a["level"])
        # Only the copy addressed to the ladder's role at this level climbs (institution copies never escalate).
        if current is None or current.role != a["recipientRole"]:
            continue
        age = clock.days_between(a["rootCreatedDate"], as_of)
        alert_id, level, status = a["id"], a["level"], a["status"]
        target: AlertTarget = {
            "id": a["instrumentId"], "institutionId": a["institutionId"], "assignedOfficerId": a["assignedOfficerId"],
        }  # fmt: skip
        while (nxt := ladder.get(level + 1)) is not None and age >= nxt.after_days:
            batch = _batch(tx)
            label = ROLE_LABELS[nxt.role].lower()
            message = f"Escalated to {label} (L{nxt.level}) — not resolved for {days_text(age)}. {a['rootMessage']}"
            subject = email_subject(
                f"Escalation L{nxt.level}", f"{ALERT_KIND_LABELS[a['kind']]} not resolved for {days_text(age)}"
            )
            batch.add(target, a["kind"], a["ruleKey"], nxt.role, a["dueDate"], message, subject,
                      subject_id=a["subjectId"], level=nxt.level, root_alert_id=a["rootAlertId"])  # fmt: skip
            new_id = batch.alerts[0]["id"]
            inserted = batch.flush(tx)
            mark_escalated(tx, alert_id)
            if inserted:
                escalations += 1
                record_event(
                    tx,
                    actor=SYSTEM_ACTOR,
                    action="ALERT_ESCALATED",
                    entity_type="alert",
                    entity_id=alert_id,
                    instrument_id=a["instrumentId"],
                    before={"status": status, "level": level},
                    after={"status": "ESCALATED", "escalatedTo": new_id, "level": nxt.level, "role": nxt.role},
                )
                alert_id, status = new_id, "OPEN"
            else:
                break  # the next level already exists: the chain is already there
            level = nxt.level
    return escalations


# ---- Step 5: auto-resolution ----


def still_relevant_sql() -> str:
    cases = " ".join(f"WHEN '{kind}' THEN ({sql})" for kind, (_, sql) in KIND_HANDLERS.items())
    return f"i.status NOT IN ('RELEASED','RENEWED') AND (CASE a.kind {cases} ELSE true END)"


def resolve_cleared(tx: Conn) -> int:
    resolved = auto_resolve(tx, still_relevant_sql(), clock.now(tx))
    for r in resolved:
        _resolved_event(tx, r["id"], r["instrumentId"], "SYSTEM_CONDITION_CLEARED")
    return len(resolved)


# ---- the job ----


def evaluate(tx: Conn, as_of: str) -> Summary:
    """One run. The caller owns the transaction. JOB_EVALUATED is logged only when something changed."""
    exec_(tx, "SELECT pg_advisory_xact_lock($1)", [JOB_LOCK])
    rules = load_rules(tx)
    s: Summary = {
        "asOf": as_of,
        "statusChanges": 0,
        "alertsCreated": 0,
        "escalations": 0,
        "resolved": 0,
        "superseded": 0,
    }
    s["statusChanges"] += sweep_statuses(tx, as_of, rules)
    created, superseded = maturity_reminders(tx, as_of, rules)
    s["alertsCreated"] += created
    s["superseded"] += superseded
    s["alertsCreated"] += process_alerts(tx, as_of, rules)
    s["escalations"] += escalate(tx, as_of, rules)
    s["resolved"] += resolve_cleared(tx)
    if any(v for k, v in s.items() if k != "asOf"):
        record_event(tx, actor=SYSTEM_ACTOR, action="JOB_EVALUATED", entity_type="job", entity_id=NIL_UUID, after=s)
    return s
