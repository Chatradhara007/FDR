"""Domain constants from shared/constants.json (the single source shared with the frontend).

Loaded once at import. The Literal types below are checked against the JSON at import time, so a
mismatch fails at startup instead of drifting silently.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal, TypedDict, get_args

CONSTANTS_PATH = Path(
    os.environ.get("FDR_CONSTANTS_PATH", Path(__file__).resolve().parents[2] / "shared" / "constants.json")
)

Role = Literal["institution", "officer", "approver", "admin", "auditor"]
InstrumentType = Literal["FDR", "SECURITY_DEPOSIT"]
InstrumentStatus = Literal[
    "DRAFT", "SUBMITTED", "UNDER_SCRUTINY", "RETURNED", "ACTIVE", "EXPIRING",
    "MATURED", "RENEWED", "LAPSED", "RELEASE_REQUESTED", "RELEASED",
]  # fmt: skip
TrustTier = Literal["CLAIMED", "DOCUMENT", "BANK_CONFIRMED"]
VerificationState = Literal["UNVERIFIED", "PENDING", "CONFIRMED", "MISMATCH", "UNAVAILABLE"]
DocType = Literal[
    "FDR_COPY", "BANK_LETTER", "DEPOSIT_CONFIRMATION", "LIEN_LETTER", "RELEASE_LETTER", "COMPLIANCE_CERTIFICATE",
    "LIEN_REMOVAL_REQUEST", "OTHER",
]  # fmt: skip
VerificationResult = Literal["CONFIRMED", "MISMATCH", "NOT_FOUND", "PENDING", "UNAVAILABLE", "STALE"]
ObservationSeverity = Literal["INFO", "CONCERN", "BLOCKING"]
TrackedField = Literal[
    "reference_no", "issuing_bank", "amount", "issue_date", "maturity_date", "beneficiary_name", "lien_marked",
]  # fmt: skip

AlertKind = Literal[
    "MATURITY_REMINDER", "PENDING_VERIFICATION", "DISCREPANCY_OPEN", "OVERDUE_RENEWAL", "RELEASE_PENDING"
]
AlertStatus = Literal["OPEN", "ACKNOWLEDGED", "ESCALATED", "RESOLVED"]
AlertResolution = Literal["SYSTEM_CONDITION_CLEARED", "MANUAL", "SUPERSEDED"]
ReleaseRequestStatus = Literal[
    "PENDING_CONDITIONS", "PENDING_APPROVAL", "APPROVED", "REJECTED", "RETURNED", "CANCELLED"
]
ReleaseDecision = Literal["RECOMMEND", "APPROVE", "REJECT", "RETURN"]
ReleaseLevelAction = Literal["RECOMMEND", "DECIDE"]


class RuleDefault(TypedDict):
    key: str
    name: str
    type: str
    config: object


class DashboardStatusGroup(TypedDict):
    key: str
    label: str
    statuses: list[InstrumentStatus]


_data = json.loads(CONSTANTS_PATH.read_text(encoding="utf-8"))

ROLES: tuple[Role, ...] = tuple(_data["roles"])
ROLE_LABELS: dict[Role, str] = _data["roleLabels"]
INSTRUMENT_TYPES: tuple[InstrumentType, ...] = tuple(_data["instrumentTypes"])
INSTRUMENT_TYPE_LABELS: dict[InstrumentType, str] = _data["instrumentTypeLabels"]
INSTRUMENT_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["instrumentStatuses"])
STATUS_LABELS: dict[InstrumentStatus, str] = _data["statusLabels"]
TRUST_TIERS: tuple[TrustTier, ...] = tuple(_data["trustTiers"])
TRUST_TIER_LABELS: dict[TrustTier, str] = _data["trustTierLabels"]
VERIFICATION_STATES: tuple[VerificationState, ...] = tuple(_data["verificationStates"])
VERIFICATION_STATE_LABELS: dict[VerificationState, str] = _data["verificationStateLabels"]
DOC_TYPES: tuple[DocType, ...] = tuple(_data["docTypes"])
DOC_TYPE_LABELS: dict[DocType, str] = _data["docTypeLabels"]
RELEASE_DOC_TYPES: tuple[DocType, ...] = tuple(_data["releaseDocTypes"])
ALLOWED: dict[InstrumentStatus, tuple[InstrumentStatus, ...]] = {
    k: tuple(v) for k, v in _data["allowedTransitions"].items()
}
LIVE_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["liveStatuses"])
TERMINAL_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["terminalStatuses"])
RENEWABLE_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["renewableStatuses"])
RELEASABLE_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["releasableStatuses"])
VERIFIABLE_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["verifiableStatuses"])
VERIFICATION_RESULTS: tuple[VerificationResult, ...] = tuple(_data["verificationResults"])
VERIFICATION_RESULT_LABELS: dict[str, str] = _data["verificationResultLabels"]
OBSERVATION_SEVERITIES: tuple[ObservationSeverity, ...] = tuple(_data["observationSeverities"])
DISCREPANCY_REASONS: dict[TrackedField, str] = _data["discrepancyReasons"]
TRACKED_FIELDS: tuple[TrackedField, ...] = tuple(_data["trackedFields"])
FIELD_LABELS: dict[TrackedField, str] = _data["fieldLabels"]
TRACKED_FIELD_KEYS: dict[TrackedField, str] = _data["trackedFieldKeys"]
BANKS: tuple[str, ...] = tuple(_data["banks"])
RULE_DEFAULTS: tuple[RuleDefault, ...] = tuple(_data["ruleDefaults"])
ALERT_KINDS: tuple[AlertKind, ...] = tuple(_data["alertKinds"])
ALERT_KIND_LABELS: dict[AlertKind, str] = _data["alertKindLabels"]
ALERT_STATUSES: tuple[AlertStatus, ...] = tuple(_data["alertStatuses"])
ALERT_RESOLUTIONS: tuple[AlertResolution, ...] = tuple(_data["alertResolutions"])
RELEASE_REQUEST_STATUSES: tuple[ReleaseRequestStatus, ...] = tuple(_data["releaseRequestStatuses"])
RELEASE_REQUEST_STATUS_LABELS: dict[ReleaseRequestStatus, str] = _data["releaseRequestStatusLabels"]
OPEN_RELEASE_REQUEST_STATUSES: tuple[ReleaseRequestStatus, ...] = tuple(_data["openReleaseRequestStatuses"])
RELEASE_DECISIONS: tuple[ReleaseDecision, ...] = tuple(_data["releaseDecisions"])
RELEASE_DECISION_LABELS: dict[ReleaseDecision, str] = _data["releaseDecisionLabels"]
RELEASE_LEVEL_ACTIONS: tuple[ReleaseLevelAction, ...] = tuple(_data["releaseLevelActions"])
RELEASE_AUTO_CONDITIONS: tuple[str, ...] = tuple(_data["releaseAutoConditions"])
EVENT_LABELS: dict[str, str] = _data["eventLabels"]
INSTITUTION_VISIBLE_ACTIONS: tuple[str, ...] = tuple(_data["institutionVisibleActions"])
DASHBOARD_STATUS_GROUPS: tuple[DashboardStatusGroup, ...] = tuple(_data["dashboardStatusGroups"])
REPORT_PRESETS: dict[str, str] = _data["reportPresets"]
SIMULATED_LABEL: str = _data["simulatedLabel"]
SHOWCASE_SIMULATED_LABEL: str = _data["showcaseSimulatedLabel"]
SHOWCASE_EVENT_LABELS: dict[str, str] = _data["showcaseEventLabels"]
REMINDER_RECIPIENT_ROLES: tuple[Role, ...] = tuple(_data["reminderRecipientRoles"])
SIGN_IN_ACTIONS: tuple[str, ...] = tuple(_data["signInActions"])
RULE_NAMES: dict[str, str] = _data["ruleNames"]


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED.get(from_status, ())  # type: ignore[call-overload]


def event_label(action: str, showcase: bool = False) -> str:
    """The human label; in SHOWCASE_MODE a few seed-only actions read as product wording ("Initial data loaded")."""
    if showcase and action in SHOWCASE_EVENT_LABELS:
        return SHOWCASE_EVENT_LABELS[action]
    return EVENT_LABELS.get(action, action)


def _check_literals() -> None:
    for literal, values in (
        (Role, ROLES),
        (InstrumentType, INSTRUMENT_TYPES),
        (InstrumentStatus, INSTRUMENT_STATUSES),
        (TrustTier, TRUST_TIERS),
        (VerificationState, VERIFICATION_STATES),
        (DocType, DOC_TYPES),
        (TrackedField, TRACKED_FIELDS),
        (VerificationResult, VERIFICATION_RESULTS),
        (ObservationSeverity, OBSERVATION_SEVERITIES),
        (AlertKind, ALERT_KINDS),
        (AlertStatus, ALERT_STATUSES),
        (AlertResolution, ALERT_RESOLUTIONS),
        (ReleaseRequestStatus, RELEASE_REQUEST_STATUSES),
        (ReleaseDecision, RELEASE_DECISIONS),
        (ReleaseLevelAction, RELEASE_LEVEL_ACTIONS),
    ):
        if get_args(literal) != values:
            raise RuntimeError(f"{CONSTANTS_PATH} does not match the Literal types in shared_constants.py: {values}")


_check_literals()
