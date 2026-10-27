"""Suspicious-pattern checks (advisory only; they never block anything). Pure functions: the service gathers rows."""

from __future__ import annotations

import re
from collections.abc import Sequence
from difflib import SequenceMatcher


def norm_person(value: str) -> str:
    """'Member Secretary, A.I.C.T.E.' -> 'MEMBER SECRETARY AICTE' (case, punctuation and spacing ignored)."""
    letters = re.sub(r"[.'’]", "", value.upper())  # "A.I.C.T.E." is "AICTE"
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", letters)).strip()


def near_miss_name(name: str, expected: Sequence[str], min_similarity: float) -> str | None:
    """The expected name `name` is close to but not equal to, or None (equal to one of them, or not close to any)."""
    mine = norm_person(name)
    wanted = [(e, norm_person(e)) for e in expected]
    if not mine or any(mine == w for _, w in wanted):
        return None
    best_name, best = max(((e, SequenceMatcher(None, mine, w).ratio()) for e, w in wanted), key=lambda t: t[1])
    return best_name if best >= min_similarity else None


def paise(amount: str) -> int:
    """'2500000.00' -> 250000000 (money is compared as integers, never floats)."""
    rupees, _, frac = amount.partition(".")
    return int(rupees) * 100 + int((frac + "00")[:2])


def median_paise(values: Sequence[int]) -> int:
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) // 2


def exceeds_multiple(amount: int, median: int, multiple: int) -> bool:
    return amount > median * multiple


def inr(amount: str) -> str:
    """'2500000.00' -> '₹25,00,000' (Indian grouping; paise only when not zero)."""
    rupees, _, frac = amount.partition(".")
    head, tail = rupees[:-3], rupees[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    frac = (frac + "00")[:2]
    return "₹" + ",".join([*groups, tail]) + ("" if frac == "00" else f".{frac}")
