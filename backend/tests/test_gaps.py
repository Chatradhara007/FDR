"""§3.8: find_gaps / weakest_tier are pure functions."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.domain.gaps import find_gaps, weakest_tier
from app.shared_constants import TRACKED_FIELDS

AT = datetime(2026, 10, 25, tzinfo=UTC)


def prov(tier: str = "BANK_CONFIRMED", **tiers: str) -> list[Any]:
    return [
        {"fieldName": f, "value": "v", "tier": tiers.get(f, tier), "source": None, "updatedAt": AT}
        for f in TRACKED_FIELDS
    ]


def disc(field: str, reason: str, status: str = "OPEN") -> Any:
    return {"id": f"d-{field}", "fieldName": field, "reason": reason, "status": status}


def obs(text: str, severity: str, status: str = "OPEN") -> Any:
    return {"id": f"o-{text}", "text": text, "severity": severity, "status": status}


FDR_RULES: Any = {"requiredDocs": ["FDR_COPY", "BANK_LETTER"], "lienRequired": True}


def test_a_complete_confirmed_instrument_has_no_gaps() -> None:
    assert find_gaps({"lienMarked": True}, prov(), ["FDR_COPY", "BANK_LETTER"], [], [], FDR_RULES) == []


def test_every_kind_of_gap_is_reported_blockers_first() -> None:
    gaps = find_gaps(
        {"lienMarked": False},
        prov(amount="CLAIMED"),
        ["FDR_COPY"],
        [disc("beneficiary_name", "Wrong beneficiary name"), disc("amount", "Amount mismatch", "RESOLVED")],
        [obs("Unsigned letter", "BLOCKING"), obs("Old stamp", "CONCERN"), obs("Done", "BLOCKING", "RESOLVED")],
        FDR_RULES,
    )
    assert [(g["severity"], g["message"]) for g in gaps] == [
        ("blocker", "Missing document: Bank letter"),
        ("blocker", "Open discrepancy: Beneficiary name (Wrong beneficiary name)"),
        ("blocker", "Lien not marked in favour of AICTE"),
        ("blocker", "Blocking observation: Unsigned letter"),
        ("warning", "Field not bank-confirmed: Amount"),
        ("warning", "Open concern: Old stamp"),
    ]
    assert gaps[0]["ref"] == "BANK_LETTER" and gaps[1]["ref"] == "d-beneficiary_name"


def test_lien_is_only_a_gap_where_the_rule_requires_it() -> None:
    rules: Any = {"requiredDocs": [], "lienRequired": False}
    assert find_gaps({"lienMarked": False}, prov(), [], [], [], rules) == []


def test_weakest_tier_is_the_lowest_field_tier() -> None:
    assert weakest_tier(prov()) == "BANK_CONFIRMED"
    assert weakest_tier(prov(amount="DOCUMENT")) == "DOCUMENT"
    assert weakest_tier(prov(amount="DOCUMENT", lien_marked="CLAIMED")) == "CLAIMED"
    assert weakest_tier([]) is None
