""" "My day" (§7.3): the ranked worklist for the signed-in official, scored by the `risk_weights` rule."""

from __future__ import annotations

from typing import Literal, TypedDict

from ..db.pool import get_pool
from ..domain import clock, risk
from ..domain.access import AuthUser
from ..domain.alert_text import days_text, fmt_amount_short
from ..domain.rules import load_risk_weights, load_rules
from ..repositories.report_repo import ReleaseWork, WorkFacts, release_candidates, work_candidates
from ..schemas import RiskWeightsRule
from ..shared_constants import FIELD_LABELS

MAX_ITEMS = 50
SCRUTINY = ("SUBMITTED", "UNDER_SCRUTINY")
LEVEL_TEXT = {2: "Escalated to approver (L2)", 3: "Escalated to administrator (L3)"}


class WorkItem(TypedDict):
    kind: Literal["instrument", "release"]
    id: str
    instrumentId: str
    title: str
    institution: str
    referenceNo: str | None
    amount: str | None
    score: int
    components: risk.Components
    daysLeft: int | None
    reasons: list[str]
    nextAction: str
    link: str


class MyDay(TypedDict):
    asOf: str
    weights: dict[str, object]
    items: list[WorkItem]


def _labels(fields: list[str]) -> str:
    return ", ".join(FIELD_LABELS[f].lower() for f in fields if f in FIELD_LABELS)


def _title(ref: str | None, institution: str) -> str:
    return f"{ref or '(no reference)'} · {institution}"


def _common_reasons(
    amount: str | None, c: risk.Components, state: str, override: bool, discrepancies: list[str], level: int | None
) -> list[str]:
    out: list[str] = []
    if amount is not None and c["amount"] >= 0.1:
        out.append(f"{fmt_amount_short(amount)} at stake")
    if state == "MISMATCH" and discrepancies:
        out.append(f"Bank mismatch: {_labels(discrepancies)}")
    elif state == "MISMATCH":
        out.append("Bank mismatch")
    elif discrepancies:
        out.append(f"Open discrepancy: {_labels(discrepancies)}")
    if not override and state in ("UNVERIFIED", "PENDING", "UNAVAILABLE"):
        out.append({"UNVERIFIED": "Not yet verified with the bank", "PENDING": "Bank still processing",
                    "UNAVAILABLE": "Bank unavailable"}[state])  # fmt: skip
    if level and level >= 2:
        out.append(LEVEL_TEXT[min(level, 3)])
    return out


def _maturity_reason(days_left: int | None) -> str | None:
    if days_left is None:
        return None
    if days_left > 0:
        return f"Matures in {days_text(days_left)}"
    if days_left == 0:
        return "Matures today"
    return f"Matured {days_text(-days_left)} ago"


def _instrument_item(f: WorkFacts, w: RiskWeightsRule, grace_days: int) -> WorkItem:
    in_scrutiny = f["status"] in SCRUTINY
    urgency = (
        risk.waiting_urgency(f["ageingDays"])
        if in_scrutiny
        else risk.maturity_urgency(f["daysLeft"], w.urgency_horizon_days)
    )
    c = risk.components(
        amount=f["amount"], urgency=urgency, state=f["verificationState"], override=f["acceptedWithOverride"],
        open_discrepancies=len(f["discrepancyFields"]), worst_alert_level=f["worstOpenAlertLevel"], weights=w,
    )  # fmt: skip
    reasons = _common_reasons(
        f["amount"], c, f["verificationState"], f["acceptedWithOverride"], f["discrepancyFields"],
        f["worstOpenAlertLevel"],
    )  # fmt: skip
    if in_scrutiny:
        age = f["ageingDays"] or 0
        reasons.insert(1, f"Waiting {days_text(age)} for verification")
    else:
        m = _maturity_reason(f["daysLeft"])
        if m and (f["daysLeft"] or 0) <= w.urgency_horizon_days:
            reasons.insert(1, m)

    first = f["discrepancyFields"][0] if f["discrepancyFields"] else None
    if first is not None:
        action = f"Resolve discrepancy on {FIELD_LABELS[first].lower()}"  # type: ignore[index]
    elif f["status"] == "SUBMITTED":
        action = "Claim and verify with bank"
    elif f["status"] == "UNDER_SCRUTINY":
        action = "Accept or return" if f["verificationState"] == "CONFIRMED" else "Verify with bank"
    elif f["status"] in ("EXPIRING", "MATURED", "LAPSED") and f["hasSuccessor"]:
        action = "Follow up the replacement in progress"
    elif f["status"] == "LAPSED":
        action = f"Chase renewal — lapsed {days_text(-(f['daysLeft'] or 0) - grace_days)} ago"
    elif f["status"] == "MATURED":
        action = f"Chase renewal — lapses in {days_text(max(0, (f['daysLeft'] or 0) + grace_days))}"
    elif f["status"] == "EXPIRING":
        action = f"Chase renewal — matures in {days_text(max(0, f['daysLeft'] or 0))}"
    elif f["verificationState"] != "CONFIRMED" and not f["acceptedWithOverride"]:
        action = "Re-verify with bank"
    else:
        action = "Review open alerts"
    return {
        "kind": "instrument", "id": f["id"], "instrumentId": f["id"],
        "title": _title(f["referenceNo"], f["institutionName"]), "institution": f["institutionName"],
        "referenceNo": f["referenceNo"], "amount": f["amount"], "score": risk.score(c, w), "components": c,
        "daysLeft": f["daysLeft"], "reasons": reasons, "nextAction": action,
        "link": f"/officer/review/{f['id']}" if in_scrutiny else f"/instruments/{f['id']}",
    }  # fmt: skip


def _release_item(r: ReleaseWork, w: RiskWeightsRule, role: str) -> WorkItem:
    c = risk.components(
        amount=r["amount"], urgency=risk.waiting_urgency(r["waitingDays"]), state=r["verificationState"],
        override=r["acceptedWithOverride"], open_discrepancies=len(r["discrepancyFields"]),
        worst_alert_level=r["worstOpenAlertLevel"], weights=w,
    )  # fmt: skip
    reasons = _common_reasons(
        r["amount"], c, r["verificationState"], r["acceptedWithOverride"], r["discrepancyFields"],
        r["worstOpenAlertLevel"],
    )  # fmt: skip
    reasons.insert(1, f"Release request waiting {days_text(r['waitingDays'])}")
    officer = role == "officer"
    return {
        "kind": "release", "id": r["requestId"], "instrumentId": r["instrumentId"],
        "title": _title(r["referenceNo"], r["institutionName"]), "institution": r["institutionName"],
        "referenceNo": r["referenceNo"], "amount": r["amount"], "score": risk.score(c, w), "components": c,
        "daysLeft": r["daysLeft"], "reasons": reasons,
        "nextAction": "Recommend or return release request" if officer else "Decide release request",
        "link": f"/{'officer' if officer else 'approver'}/releases/{r['requestId']}",
    }  # fmt: skip


def _order(item: WorkItem) -> tuple[int, int, str]:
    """Highest score first; ties by days left (soonest first, unknown last), then id for a stable order."""
    days = item["daysLeft"]
    return (-item["score"], days if days is not None else 10**6, item["id"])


def my_day(user: AuthUser) -> MyDay:
    db = get_pool()
    today = clock.today(db)
    weights = load_risk_weights(db)
    grace = load_rules(db).grace_days
    items = [_instrument_item(f, weights, grace) for f in work_candidates(db, user.role, user.id, today)]
    if user.role in ("officer", "approver"):
        items += [_release_item(r, weights, user.role) for r in release_candidates(db, user.role, user.id, today)]
    items.sort(key=_order)
    return {"asOf": today, "weights": weights.model_dump(by_alias=True), "items": items[:MAX_ITEMS]}
