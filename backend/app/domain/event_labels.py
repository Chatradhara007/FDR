"""Human labels and icon keys for timeline events. The base text always comes from the one label map
(`shared/constants.json` -> eventLabels); a few actions add detail taken from the event's own data."""

from __future__ import annotations

from collections.abc import Mapping

from ..config import config
from ..shared_constants import (
    DOC_TYPE_LABELS,
    FIELD_LABELS,
    ROLE_LABELS,
    VERIFICATION_RESULT_LABELS,
    event_label,
)


def _data(v: object) -> Mapping[str, object]:
    return v if isinstance(v, dict) else {}


def label_for(action: str, before: object, after: object, actor: str) -> str:
    base = event_label(action, config.showcase_mode)
    a = _data(after)
    if action == "VERIFICATION_RESULT":
        raw = a.get("mismatchedFields")
        fields = [f for f in raw if isinstance(f, str)] if isinstance(raw, list) else []
        mismatched = [FIELD_LABELS.get(f, f).lower() for f in fields]  # type: ignore[call-overload]
        if a.get("result") == "MISMATCH" and mismatched:
            return f"Bank verification: mismatch on {', '.join(mismatched)}"
        result = a.get("result")
        if isinstance(result, str) and result in VERIFICATION_RESULT_LABELS:
            return f"Bank verification: {VERIFICATION_RESULT_LABELS[result].lower()}"
        return base
    if action in ("RENEWED_BY", "RENEWS") and a.get("referenceNo"):
        return f"{'Replaced by' if action == 'RENEWED_BY' else 'Replaces'} {a['referenceNo']}"
    role = a.get("role")
    if action == "ALERT_ESCALATED" and isinstance(role, str) and role in ROLE_LABELS:
        return f"Escalated to {ROLE_LABELS[role].lower()}"
    if action == "DOCUMENT_ACCESSED":
        return f"Document viewed by {actor}"
    if action == "DOCUMENT_UPLOADED" and a.get("releaseRequestId"):
        doc_type = a.get("docType")
        what = DOC_TYPE_LABELS.get(doc_type, "document") if isinstance(doc_type, str) else "document"  # type: ignore[call-overload]
        return f"Release document uploaded: {what.lower()}"
    if action == "RELEASE_CONDITION_CHECKED" and isinstance(a.get("description"), str):
        return f"Release condition {'met' if a.get('met') else 'marked not met'}: {a['description']}"
    if action == "RELEASE_LEVEL_APPROVED" and a.get("level"):
        return f"Release approved at level {a['level']}" + (f" ({a['label']})" if a.get("label") else "")
    if action == "RELEASE_RETURNED" or action == "RELEASE_REJECTED":
        level = a.get("level")
        return f"{base} at level {level}" if level else base
    if action.startswith("STATUS_") and a.get("releaseRequestId") and action not in RELEASE_STATUS_ACTIONS:
        return f"{base} (release request closed)"  # restored after a rejected or cancelled request
    return base


RELEASE_STATUS_ACTIONS = ("STATUS_RELEASE_REQUESTED", "STATUS_RELEASED")


# Icon key per action (prefix match, first wins); the UI maps each key to one icon.
_ICONS: tuple[tuple[str, str], ...] = (
    ("STATUS_", "status"),
    ("RENEW", "renewal"),
    ("RELEASE_", "release"),
    ("DOCUMENT_ACCESSED", "view"),
    ("DOCUMENT_", "document"),
    ("FIELD_DOCUMENT_CHECKED", "document"),
    ("VERIFICATION_", "bank"),
    ("DISCREPANCY_", "discrepancy"),
    ("OBSERVATION_", "observation"),
    ("ALERT_", "alert"),
    ("INSTRUMENT_RETURNED", "return"),
    ("INSTRUMENT_ACCEPTED", "accept"),
    ("ACCEPTED_WITH_OVERRIDE", "accept"),
    ("INSTRUMENT_", "edit"),
    ("CLOCK_", "clock"),
    ("JOB_", "clock"),
)


def icon_for(action: str) -> str:
    return next((icon for prefix, icon in _ICONS if action.startswith(prefix)), "event")
