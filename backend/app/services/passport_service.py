"""The instrument passport (Phase 05 §5.6): everything one instrument's page needs, in one request, filtered by
role (D24): institutions see their own record without internal notes, raw bank payloads or access logs."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Literal, TypedDict

from ..db.pool import get_pool
from ..domain import clock
from ..domain.access import AuthUser, scope_alerts_query
from ..domain.event_labels import icon_for, label_for
from ..domain.gaps import Gap, find_gaps
from ..repositories.alert_repo import AlertItem, list_alerts
from ..repositories.discrepancy_repo import DiscrepancyRow, list_discrepancies
from ..repositories.event_repo import events_for_instrument
from ..repositories.instrument_repo import ChainRow, instrument_chain
from ..repositories.observation_repo import ObservationRow
from ..repositories.return_repo import ReturnRow
from ..repositories.verification_repo import VerificationRow, list_verifications
from ..shared_constants import INSTITUTION_VISIBLE_ACTIONS, InstrumentStatus, TrustTier, VerificationResult
from .instrument_service import DocumentInfo, InstrumentDetail, ReviewField, doc_rules, field_rows, get_instrument
from .release_service import ReleaseView, views_for_instrument
from .renewal_service import coverage_gap_days

GapKind = Literal["gap", "overlap", "continuous", "unknown"]


class ChainLink(TypedDict):
    id: str
    referenceNo: str | None
    issuingBank: str | None
    amount: str | None
    issueDate: str | None
    maturityDate: str | None
    status: InstrumentStatus
    depth: int
    isCurrent: bool
    # Between the previous link's maturity and this link's issue (None on the first link).
    gapDaysFromPrevious: int | None
    gapKind: GapKind | None


class PassportVerification(TypedDict, total=False):
    id: str
    result: VerificationResult
    requestedAt: datetime
    respondedAt: datetime | None
    requestedByName: str | None
    fieldMatches: dict[str, bool]
    source: str
    requestPayload: object
    responsePayload: object


class TimelineEvent(TypedDict):
    id: int
    action: str
    label: str
    icon: str
    actor: str
    at: datetime
    before: object
    after: object


class PassportSummary(TypedDict):
    daysToMaturity: int | None
    weakestTier: TrustTier | None
    openProblems: list[Gap]
    acceptedWithOverride: bool
    overrideNote: str | None
    openAlertCount: int
    worstOpenAlertLevel: int | None


class Passport(TypedDict):
    instrument: InstrumentDetail
    fields: list[ReviewField]
    weakestTier: TrustTier | None
    chain: list[ChainLink]
    documents: list[DocumentInfo]
    verifications: list[PassportVerification]
    discrepancies: list[DiscrepancyRow]
    observations: list[ObservationRow]
    returns: list[ReturnRow]
    alerts: list[AlertItem]
    releaseRequests: list[ReleaseView]
    summary: PassportSummary
    timeline: list[TimelineEvent]


def _gap_kind(days: int | None) -> GapKind:
    if days is None:
        return "unknown"
    return "gap" if days > 0 else "overlap" if days < 0 else "continuous"


def chain_links(rows: list[ChainRow], current_id: str) -> list[ChainLink]:
    links: list[ChainLink] = []
    for prev, row in zip([None, *rows[:-1]], rows, strict=True):
        gap = coverage_gap_days(prev, row) if prev else None
        links.append(
            {
                "id": row["id"], "referenceNo": row["referenceNo"], "issuingBank": row["issuingBank"],
                "amount": row["amount"], "issueDate": row["issueDate"], "maturityDate": row["maturityDate"],
                "status": row["status"], "depth": row["depth"], "isCurrent": row["id"] == current_id,
                "gapDaysFromPrevious": gap, "gapKind": _gap_kind(gap) if prev else None,
            }
        )  # fmt: skip
    return links


def _field_matches(payload: object) -> dict[str, bool]:
    fields = payload.get("fields") if isinstance(payload, Mapping) else None
    if not isinstance(fields, Mapping):
        return {}
    return {f: bool(v.get("match")) for f, v in fields.items() if isinstance(v, Mapping)}


def _verification(v: VerificationRow, internal: bool) -> PassportVerification:
    out: PassportVerification = {
        "id": v["id"], "result": v["result"], "requestedAt": v["requestedAt"], "respondedAt": v["respondedAt"],
        "fieldMatches": _field_matches(v["responsePayload"]),
    }  # fmt: skip
    if internal:  # D24: only AICTE roles see who asked and the raw request / response
        out["requestedByName"] = v["requestedByName"]
        out["source"] = v["source"]
        out["requestPayload"] = v["requestPayload"]
        out["responsePayload"] = v["responsePayload"]
    return out


def get_passport(user: AuthUser, instrument_id: str) -> Passport:
    db = get_pool()
    detail = get_instrument(user, instrument_id, db)  # 404 for another institution's record
    internal = user.role != "institution"
    if not internal:
        detail = {**detail, "overrideNote": None}  # the officer's override reasoning is internal (D24)
    today = clock.today(db)

    scope = (lambda p: "") if internal else (lambda p: scope_alerts_query(user, p))
    alerts, _ = list_alerts(
        db,
        {"statuses": None, "kind": None, "instrumentId": instrument_id, "mineUserId": None, "level": None,
         "page": 1, "pageSize": 100},
        today,
        scope,
    )  # fmt: skip
    open_alerts = [a for a in alerts if a["status"] in ("OPEN", "ACKNOWLEDGED")]

    discrepancies = list_discrepancies(db, instrument_id) if internal else []
    rules = doc_rules(db)
    problems = find_gaps(
        {"lienMarked": detail["lienMarked"]},
        detail["provenance"],
        [d["docType"] for d in detail["documents"]],
        [d for d in discrepancies if d["status"] == "OPEN"],
        detail["observations"],  # already filtered to visible ones for institutions
        {"requiredDocs": rules["requiredDocs"][detail["type"]], "lienRequired": rules["lienRequired"][detail["type"]]},
    ) if detail["status"] != "DRAFT" else []  # fmt: skip

    events = events_for_instrument(db, instrument_id, None if internal else list(INSTITUTION_VISIBLE_ACTIONS))
    timeline: list[TimelineEvent] = [
        {
            "id": e["id"], "action": e["action"],
            "label": label_for(e["action"], e["before_json"], e["after_json"], e["actor_label"]),
            "icon": icon_for(e["action"]), "actor": e["actor_label"], "at": e["created_at"],
            "before": e["before_json"], "after": e["after_json"],
        }
        for e in events
    ]  # fmt: skip

    return {
        "instrument": detail,
        "fields": field_rows(detail),
        "weakestTier": detail["weakestTier"],
        "chain": chain_links(instrument_chain(db, instrument_id), instrument_id),
        "documents": detail["documents"],
        "verifications": [_verification(v, internal) for v in list_verifications(db, instrument_id)],
        "discrepancies": discrepancies,
        "observations": detail["observations"],
        "returns": detail["returns"],
        "alerts": alerts,
        "releaseRequests": views_for_instrument(db, user, instrument_id),
        "summary": {
            "daysToMaturity": detail["daysToMaturity"],
            "weakestTier": detail["weakestTier"],
            "openProblems": problems,
            "acceptedWithOverride": detail["acceptedWithOverride"],
            "overrideNote": detail["overrideNote"] if internal else None,
            "openAlertCount": len(open_alerts),
            "worstOpenAlertLevel": max((a["level"] for a in open_alerts), default=None),
        },
        "timeline": timeline,
    }
