"""Completeness check (§3.8). Pure: callers load the rows (documents as their doc types) and rules; used by the review checklist, the
accept guard, and later the passport, release conditions and reports."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Literal, NotRequired, TypedDict

from ..repositories.discrepancy_repo import DiscrepancyRow
from ..repositories.observation_repo import ObservationRow
from ..repositories.provenance_repo import ProvenanceRow
from ..shared_constants import DOC_TYPE_LABELS, FIELD_LABELS, TRACKED_FIELDS, TRUST_TIERS, DocType, TrustTier

GapCode = Literal[
    "MISSING_DOCUMENT", "OPEN_DISCREPANCY", "BLOCKING_OBSERVATION", "LIEN_NOT_MARKED", "FIELD_NOT_BANK_CONFIRMED",
    "CONCERN_OBSERVATION",
]  # fmt: skip


class Gap(TypedDict):
    code: GapCode
    message: str
    severity: Literal["blocker", "warning"]
    ref: NotRequired[str]


class GapRules(TypedDict):
    requiredDocs: Sequence[DocType]
    lienRequired: bool


class GapInstrument(TypedDict):
    lienMarked: bool


def find_gaps(
    instrument: GapInstrument,
    fields: Iterable[ProvenanceRow],
    documents: Iterable[str],
    discrepancies: Iterable[DiscrepancyRow],
    observations: Iterable[ObservationRow],
    rules: GapRules,
) -> list[Gap]:
    """Blockers first, then warnings. A field not bank-confirmed is a warning: D4's override path covers it."""
    gaps: list[Gap] = []
    present = set(documents)
    for doc_type in rules["requiredDocs"]:
        if doc_type not in present:
            gaps.append(
                {"code": "MISSING_DOCUMENT", "message": f"Missing document: {DOC_TYPE_LABELS[doc_type]}",
                 "severity": "blocker", "ref": doc_type}
            )  # fmt: skip
    for d in discrepancies:
        if d["status"] == "OPEN":
            label = FIELD_LABELS[d["fieldName"]]
            gaps.append(
                {"code": "OPEN_DISCREPANCY", "message": f"Open discrepancy: {label} ({d['reason']})",
                 "severity": "blocker", "ref": d["id"]}
            )  # fmt: skip
    if rules["lienRequired"] and not instrument["lienMarked"]:
        gaps.append({"code": "LIEN_NOT_MARKED", "message": "Lien not marked in favour of AICTE", "severity": "blocker"})
    open_obs = [o for o in observations if o["status"] == "OPEN"]
    for o in open_obs:
        if o["severity"] == "BLOCKING":
            gaps.append(
                {"code": "BLOCKING_OBSERVATION", "message": f"Blocking observation: {o['text']}", "severity": "blocker",
                 "ref": o["id"]}
            )  # fmt: skip
    tiers: Mapping[str, TrustTier] = {f["fieldName"]: f["tier"] for f in fields}
    for field in TRACKED_FIELDS:
        if tiers.get(field) != "BANK_CONFIRMED":
            gaps.append(
                {"code": "FIELD_NOT_BANK_CONFIRMED", "message": f"Field not bank-confirmed: {FIELD_LABELS[field]}",
                 "severity": "warning", "ref": field}
            )  # fmt: skip
    for o in open_obs:
        if o["severity"] == "CONCERN":
            gaps.append(
                {"code": "CONCERN_OBSERVATION", "message": f"Open concern: {o['text']}", "severity": "warning",
                 "ref": o["id"]}
            )  # fmt: skip
    return gaps


def weakest_tier(fields: Iterable[ProvenanceRow]) -> TrustTier | None:
    """Lowest tier among the tracked fields (CLAIMED < DOCUMENT < BANK_CONFIRMED); None before submission."""
    tiers = [f["tier"] for f in fields]
    if not tiers:
        return None
    return min(tiers, key=TRUST_TIERS.index)
