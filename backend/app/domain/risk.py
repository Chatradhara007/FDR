"""My day risk score (§7.3, D26). Pure: components in 0..1, weights from the `risk_weights` rule."""

from __future__ import annotations

from decimal import Decimal
from typing import TypedDict

from ..schemas import RiskWeightsRule
from ..shared_constants import VerificationState

VERIFICATION_RISK: dict[VerificationState, float] = {
    "CONFIRMED": 0.0,
    "PENDING": 0.6,
    "UNVERIFIED": 0.7,
    "UNAVAILABLE": 0.8,
    "MISMATCH": 1.0,
}


class Components(TypedDict):
    amount: float
    urgency: float
    verification: float
    discrepancy: float
    escalation: float


def amount_component(amount: str | None, cap: str) -> float:
    """min(1, amount / amountCap), in Decimal (money is never a float until the ratio)."""
    if amount is None:
        return 0.0
    return float(min(Decimal(1), Decimal(amount) / Decimal(cap)))


def maturity_urgency(days_left: int | None, horizon_days: int) -> float:
    if days_left is None:
        return 0.0
    if days_left <= 0:
        return 1.0
    return max(0.0, 1 - days_left / horizon_days)


def waiting_urgency(days: int | None) -> float:
    """Items in scrutiny (and release requests): min(1, ageingDays / 10)."""
    return 0.0 if days is None else min(1.0, max(0, days) / 10)


def verification_component(state: VerificationState, accepted_with_override: bool) -> float:
    return 0.0 if accepted_with_override else VERIFICATION_RISK[state]


def components(
    *,
    amount: str | None,
    urgency: float,
    state: VerificationState,
    override: bool,
    open_discrepancies: int,
    worst_alert_level: int | None,
    weights: RiskWeightsRule,
) -> Components:
    return {
        "amount": amount_component(amount, weights.amount_cap),
        "urgency": urgency,
        "verification": verification_component(state, override),
        "discrepancy": 1.0 if open_discrepancies > 0 else 0.0,
        "escalation": min(1.0, (worst_alert_level or 0) / 3),
    }


def score(c: Components, w: RiskWeightsRule) -> int:
    """round(100 × Σ weight × component)."""
    total = (
        w.amount * c["amount"]
        + w.urgency * c["urgency"]
        + w.verification * c["verification"]
        + w.discrepancy * c["discrepancy"]
        + w.escalation * c["escalation"]
    )
    return round(100 * total)
