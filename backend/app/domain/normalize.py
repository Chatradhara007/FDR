"""Normalisers produce the canonical string form of tracked field values, so values typed by an
institution, read from a document and returned by a bank compare equal. All string-based: no floats.
"""

from __future__ import annotations

import calendar
import re

from .canonical_json import js_number

_AMOUNT = re.compile(r"^(\d+)(?:\.(\d*))?$")
_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)")
_DMY = re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$")


def norm_amount(value: str | int | float) -> str:
    """'₹ 25,00,000' -> '2500000.00'. Raises ValueError on anything that is not a non-negative decimal amount."""
    if isinstance(value, bool):
        raise ValueError(f"Not an amount: {value}")
    text = js_number(value) if isinstance(value, int | float) else value
    s = re.sub(r"[,\s]", "", re.sub(r"₹|rs\.?|inr", "", text, flags=re.IGNORECASE))
    m = _AMOUNT.match(s)
    if not m or not s.isascii():
        raise ValueError(f"Not an amount: {value}")
    rupees = m.group(1).lstrip("0") or "0"
    frac = m.group(2) or ""
    if len(frac) > 2 and re.search(r"[1-9]", frac[2:]):
        raise ValueError(f"Amount has more than 2 decimals: {value}")
    return f"{rupees}.{(frac + '00')[:2]}"


def _valid_date(y: int, m: int, d: int) -> bool:
    return 1 <= m <= 12 and 1 <= d <= calendar.monthrange(y, m)[1] if y >= 1 else False


def norm_date(value: str) -> str:
    """Accepts 'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY' (or an ISO timestamp) -> 'YYYY-MM-DD'."""
    s = value.strip()
    iso = _ISO.match(s)
    dmy = _DMY.match(s)
    if iso:
        y, m, d = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
    elif dmy:
        d, m, y = int(dmy.group(1)), int(dmy.group(2)), int(dmy.group(3))
    else:
        raise ValueError(f"Not a date: {value}")
    if not _valid_date(y, m, d):
        raise ValueError(f"Not a date: {value}")
    return f"{y:04d}-{m:02d}-{d:02d}"


def norm_name(value: str) -> str:
    """'Vasavi College of Engg., Hyd' -> 'VASAVI COLLEGE OF ENGG HYD'"""
    return re.sub(r"\s+", " ", re.sub(r"[.,]", " ", value.upper())).strip()


def norm_ref(value: str) -> str:
    """'sbi fd 0042 17' -> 'SBIFD004217'"""
    return re.sub(r"\s+", "", value.upper())


def norm_bool(value: bool | str | int | None) -> str:
    """True / 'yes' / 'Y' / '1' -> 'true'; False / 'no' / 'N' / '0' / '' -> 'false'."""
    if isinstance(value, bool):
        return "true" if value else "false"
    s = ("" if value is None else str(value)).strip().lower()
    if s in ("true", "yes", "y", "1", "on"):
        return "true"
    if s in ("false", "no", "n", "0", "off", ""):
        return "false"
    raise ValueError(f"Not a boolean: {value}")
