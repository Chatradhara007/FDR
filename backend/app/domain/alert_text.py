"""Human text for alerts and their simulated emails (same wording style as the UI's format.ts)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from ..shared_constants import ROLE_LABELS, InstrumentType, Role

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
TYPE_SHORT: dict[InstrumentType, str] = {"FDR": "FDR", "SECURITY_DEPOSIT": "Security deposit"}


def fmt_date(day: str) -> str:
    """'2027-03-31' -> '31 Mar 2027'."""
    d = date.fromisoformat(day)
    return f"{d.day} {_MONTHS[d.month - 1]} {d.year}"


def _trim(d: Decimal) -> str:
    s = f"{d.quantize(Decimal('0.01')):f}".rstrip("0").rstrip(".")
    return s


def _indian_grouping(rupees: int) -> str:
    s = str(rupees)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups) + "," + tail


def fmt_amount_short(amount: str | None) -> str:
    """'2500000.00' -> '₹25 L', '12500000.00' -> '₹1.25 Cr', '50000.00' -> '₹50,000'. Decimal only, never float."""
    if amount is None:
        return "amount not given"
    a = Decimal(amount)
    if a >= Decimal(10_000_000):
        return f"₹{_trim(a / Decimal(10_000_000))} Cr"
    if a >= Decimal(100_000):
        return f"₹{_trim(a / Decimal(100_000))} L"
    return f"₹{_indian_grouping(int(a))}"


def days_text(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


def describe(kind: InstrumentType, reference_no: str | None, amount: str | None, bank: str | None) -> str:
    """'FDR SBIN/FDR/2026/00731 (₹25 L, State Bank of India)'."""
    ref = reference_no or "(no reference)"
    return f"{TYPE_SHORT[kind]} {ref} ({fmt_amount_short(amount)}, {bank or 'bank not given'})"


def email_subject(prefix: str, text: str) -> str:
    return f"[AICTE FDR Portal] {prefix}: {text}"


def email_body(role: Role, message: str, level: int) -> str:
    escalated = (
        f"This item has been escalated to level {level} because it was not resolved in time.\n\n" if level > 1 else ""
    )
    return (
        f"Dear {ROLE_LABELS[role]},\n\n{message}\n\n{escalated}"
        "Open the alerts inbox in the AICTE FDR Portal to see the instrument and act on it.\n\n"
        "This is an automated message from the AICTE FDR Portal (simulated email — no message was sent)."
    )


def fmt_inr(amount: str) -> str:
    """'3500000.00' -> '₹35,00,000.00' (Indian grouping, two decimals; Decimal only)."""
    paise = paise_of(amount)
    return f"₹{_indian_grouping(paise // 100)}.{paise % 100:02d}"


def paise_of(amount: str) -> int:
    """Money compared as whole paise (CLAUDE.md rule 3), never as float."""
    return int((Decimal(amount) * 100).to_integral_value())
