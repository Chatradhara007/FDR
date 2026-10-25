"""The seven tracked fields whose trust tier is recorded per instrument (D8)."""

from __future__ import annotations

import re
from typing import Protocol

from ..shared_constants import TrackedField
from .normalize import norm_amount, norm_bool, norm_name, norm_ref


class TrackedValues(Protocol):
    def __getitem__(self, key: str, /) -> object: ...


def _text(v: object) -> str:
    return "" if v is None else str(v)


def tracked_value(field: TrackedField, v: TrackedValues) -> str:
    """Canonical string form stored in field_provenance.value (normalised so equal values compare equal)."""
    match field:
        case "reference_no":
            return norm_ref(_text(v["referenceNo"]))
        case "issuing_bank":
            return _text(v["issuingBank"])
        case "amount":
            amount = v["amount"]
            return "" if amount is None else norm_amount(str(amount))
        case "issue_date":
            return _text(v["issueDate"])
        case "maturity_date":
            return _text(v["maturityDate"])
        case "beneficiary_name":
            return re.sub(r"\s+", " ", _text(v["beneficiaryName"]).strip())
        case "lien_marked":
            return norm_bool(bool(v["lienMarked"]))


def same_tracked_value(field: TrackedField, a: str, b: str) -> bool:
    """Whether two stored values of a field mean the same thing (names ignore case and punctuation)."""
    if field == "beneficiary_name":
        return norm_name(a) == norm_name(b)
    if field == "reference_no":
        return norm_ref(a) == norm_ref(b)
    return a == b
