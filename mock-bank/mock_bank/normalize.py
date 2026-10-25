"""Normalisers the bank uses to compare submitted values with its records.

The mock bank stands in for an external system, so it keeps its own copy instead of importing the
portal's code; the rules match `backend/app/domain/normalize.py` (string based, no floats).
"""

from __future__ import annotations

import re

_AMOUNT = re.compile(r"^(\d+)(?:\.(\d*))?$")
_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)")
_DMY = re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$")


def norm_amount(value: object) -> str:
    """'₹ 25,00,000' -> '2500000.00'; anything unparseable is returned as trimmed text (it will not match)."""
    text = str(value) if isinstance(value, int | float) and not isinstance(value, bool) else value
    if not isinstance(text, str):
        return ""
    s = re.sub(r"[,\s]", "", re.sub(r"₹|rs\.?|inr", "", text, flags=re.IGNORECASE))
    m = _AMOUNT.match(s)
    if not m:
        return text.strip()
    rupees = m.group(1).lstrip("0") or "0"
    return f"{rupees}.{((m.group(2) or '') + '00')[:2]}"


def norm_date(value: object) -> str:
    s = str(value or "").strip()
    iso = _ISO.match(s)
    dmy = _DMY.match(s)
    if iso:
        return f"{int(iso.group(1)):04d}-{int(iso.group(2)):02d}-{int(iso.group(3)):02d}"
    if dmy:
        return f"{int(dmy.group(3)):04d}-{int(dmy.group(2)):02d}-{int(dmy.group(1)):02d}"
    return s


def norm_name(value: object) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[.,]", " ", str(value or "").upper())).strip()


def norm_ref(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "").upper())


def norm_bool(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return "true" if str(value or "").strip().lower() in ("true", "yes", "y", "1", "on") else "false"
