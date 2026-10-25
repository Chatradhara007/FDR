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
    "FDR_COPY", "BANK_LETTER", "DEPOSIT_CONFIRMATION", "LIEN_LETTER", "RELEASE_LETTER", "COMPLIANCE_CERTIFICATE", "OTHER",
]  # fmt: skip
TrackedField = Literal[
    "reference_no", "issuing_bank", "amount", "issue_date", "maturity_date", "beneficiary_name", "lien_marked",
]  # fmt: skip


class RuleDefault(TypedDict):
    key: str
    name: str
    type: str
    config: object


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
ALLOWED: dict[InstrumentStatus, tuple[InstrumentStatus, ...]] = {
    k: tuple(v) for k, v in _data["allowedTransitions"].items()
}
LIVE_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["liveStatuses"])
TERMINAL_STATUSES: tuple[InstrumentStatus, ...] = tuple(_data["terminalStatuses"])
TRACKED_FIELDS: tuple[TrackedField, ...] = tuple(_data["trackedFields"])
FIELD_LABELS: dict[TrackedField, str] = _data["fieldLabels"]
TRACKED_FIELD_KEYS: dict[TrackedField, str] = _data["trackedFieldKeys"]
BANKS: tuple[str, ...] = tuple(_data["banks"])
RULE_DEFAULTS: tuple[RuleDefault, ...] = tuple(_data["ruleDefaults"])
EVENT_LABELS: dict[str, str] = _data["eventLabels"]
INSTITUTION_VISIBLE_ACTIONS: tuple[str, ...] = tuple(_data["institutionVisibleActions"])


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED.get(from_status, ())  # type: ignore[call-overload]


def event_label(action: str) -> str:
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
    ):
        if get_args(literal) != values:
            raise RuntimeError(f"{CONSTANTS_PATH} does not match the Literal types in shared_constants.py: {values}")


_check_literals()
