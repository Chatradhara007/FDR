"""Advisory text cross-check of an uploaded PDF (pure: bytes in, findings out; no DB, no clock).

The text of a text-based PDF is searched for the reference number, amount and dates; what it says is compared with
what the institution claimed. Everything here is advisory: it never changes a trust tier, a status or a verification
state. Any failure to read a file (broken, encrypted, huge, too many pages, a scan with no text) is reported as
UNREADABLE with a reason code, never raised.
"""

from __future__ import annotations

import io
import logging
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal, TypedDict

from pypdf import PdfReader

from .normalize import norm_amount, norm_date, norm_ref

logging.getLogger("pypdf").setLevel(logging.CRITICAL)  # damaged files are expected input here

MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 20
MAX_TEXT_CHARS = 200_000
MAX_CANDIDATES = 50
MIN_TEXT_CHARS = 20  # fewer characters than this: a scan or an image-only PDF

UnreadableReason = Literal["BROKEN", "ENCRYPTED", "TOO_LARGE", "TOO_MANY_PAGES", "NO_TEXT", "IMAGE"]
CheckResult = Literal["MATCH", "DIFFERENT", "NOT_FOUND"]

# Producers that mean an image or graphics editor touched the file (a soft signal, never proof).
IMAGE_EDITORS = (
    "photoshop", "gimp", "pixelmator", "paint.net", "photopea", "pixlr", "affinity", "corel", "canva", "illustrator",
    "inkscape", "krita", "snapseed",
)  # fmt: skip
MODIFIED_AFTER_SECONDS = 60  # editors that re-save within a minute of creating a file are not a signal

_DATE = (
    r"(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}"
    r"|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})"
)
_MONEY = r"(?:rs\.?|inr|₹)?\s*"
_LABELLED = {
    "referenceNo": re.compile(
        r"(?:deposit|fdr|fd|receipt|reference|a/c)\s*(?:no\.?|number|num)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-. ]{3,40}?)(?=\s{2,}|\n|$)",
        re.IGNORECASE,
    ),
    "amount": re.compile(
        rf"(?:deposit\s+amount|principal|amount)\s*[:\-]?\s*{_MONEY}(\d[\d,]*(?:\.\d{{1,2}})?)", re.IGNORECASE
    ),
    "issueDate": re.compile(
        rf"(?:date\s+of\s+(?:issue|deposit)|issue\s+date|issued\s+on|value\s+date)\s*[:\-]?\s*{_DATE}", re.IGNORECASE
    ),
    "maturityDate": re.compile(
        rf"(?:date\s+of\s+maturity|maturity\s+date|matures\s+on|due\s+date)\s*[:\-]?\s*{_DATE}", re.IGNORECASE
    ),
}
_REF_TOKEN = re.compile(r"[A-Z0-9][A-Z0-9/\-]{5,30}")
_MONEY_ANY = re.compile(rf"{_MONEY}(\d{{1,3}}(?:,\d{{2,3}})+(?:\.\d{{1,2}})?|\d{{5,}}(?:\.\d{{1,2}})?)", re.IGNORECASE)
_DATE_ANY = re.compile(_DATE)
_MONTHS = {m: i for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], start=1)}  # fmt: skip


class Extracted(TypedDict):
    labelled: dict[str, str]  # field -> value printed next to its label (normalised)
    references: list[str]
    amounts: list[str]
    dates: list[str]


class MetadataSignal(TypedDict):
    reasons: list[str]  # MODIFIED_AFTER_CREATED, IMAGE_EDITOR
    producer: str | None
    creator: str | None
    created: str | None
    modified: str | None


class Analysis(TypedDict):
    status: Literal["READ", "UNREADABLE"]
    reason: UnreadableReason | None
    extracted: Extracted
    metadata: MetadataSignal | None


def _empty() -> Extracted:
    return {"labelled": {}, "references": [], "amounts": [], "dates": []}


def unreadable(reason: UnreadableReason, metadata: MetadataSignal | None = None) -> Analysis:
    return {"status": "UNREADABLE", "reason": reason, "extracted": _empty(), "metadata": metadata}


def _date(text: str) -> str | None:
    """Any date shape found in documents -> 'YYYY-MM-DD', or None when it is not a real date."""
    s = text.strip().rstrip(",")
    m = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})", s)
    try:
        if m:
            month = _MONTHS.get(m.group(2)[:3].upper())
            if month is None:
                return None
            return norm_date(f"{m.group(1)}/{month}/{m.group(3)}")
        return norm_date(s)
    except ValueError:
        return None


def _amount(text: str) -> str | None:
    try:
        return norm_amount(text)
    except ValueError:
        return None


def extract_values(text: str) -> Extracted:
    labelled: dict[str, str] = {}
    for key, pattern in _LABELLED.items():
        m = pattern.search(text)
        if not m:
            continue
        raw = m.group(1).strip()
        value = _amount(raw) if key == "amount" else raw.upper() if key == "referenceNo" else _date(raw)
        if value:
            labelled[key] = value
    upper = text.upper()
    refs = [t for t in dict.fromkeys(_REF_TOKEN.findall(upper)) if any(c.isdigit() for c in t)]
    amounts = [a for a in dict.fromkeys(_amount(m) for m in _MONEY_ANY.findall(text)) if a]
    dates = [d for d in dict.fromkeys(_date(m) for m in _DATE_ANY.findall(text)) if d]
    return {
        "labelled": labelled,
        "references": refs[:MAX_CANDIDATES],
        "amounts": amounts[:MAX_CANDIDATES],
        "dates": dates[:MAX_CANDIDATES],
    }


def _as_utc(d: datetime) -> datetime:
    return d.astimezone(UTC) if d.tzinfo else d.replace(tzinfo=UTC)


def _iso(d: datetime | None) -> str | None:
    return _as_utc(d).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def metadata_signal(reader: PdfReader) -> MetadataSignal | None:
    """Modified after created, or an image editor as producer/creator. None when there is nothing to note."""
    try:
        meta = reader.metadata
        if meta is None:
            return None
        producer, creator = _text(meta.producer), _text(meta.creator)
        created = _safe_date(lambda: meta.creation_date)
        modified = _safe_date(lambda: meta.modification_date)
    except Exception:
        return None
    reasons: list[str] = []
    if created and modified and (_as_utc(modified) - _as_utc(created)).total_seconds() > MODIFIED_AFTER_SECONDS:
        reasons.append("MODIFIED_AFTER_CREATED")
    tools = f"{producer or ''} {creator or ''}".lower()
    if any(name in tools for name in IMAGE_EDITORS):
        reasons.append("IMAGE_EDITOR")
    if not reasons:
        return None
    return {"reasons": reasons, "producer": producer, "creator": creator, "created": _iso(created),
            "modified": _iso(modified)}  # fmt: skip


def _text(v: object) -> str | None:
    return str(v)[:120] if isinstance(v, str) and v.strip() else None


def _safe_date(get: Callable[[], object]) -> datetime | None:
    try:
        v = get()
    except Exception:
        return None
    return v if isinstance(v, datetime) else None


def analyse(data: bytes) -> Analysis:
    """Reads a PDF defensively. Never raises."""
    try:
        if len(data) > MAX_BYTES:
            return unreadable("TOO_LARGE")
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            return unreadable("ENCRYPTED")
        meta = metadata_signal(reader)
        if len(reader.pages) > MAX_PAGES:
            return unreadable("TOO_MANY_PAGES", meta)
        parts: list[str] = []
        total = 0
        for page in reader.pages:
            chunk = page.extract_text() or ""
            parts.append(chunk)
            total += len(chunk)
            if total > MAX_TEXT_CHARS:
                break
        text = "\n".join(parts)[:MAX_TEXT_CHARS]
        if len(text.strip()) < MIN_TEXT_CHARS:
            return unreadable("NO_TEXT", meta)
        return {"status": "READ", "reason": None, "extracted": extract_values(text), "metadata": meta}
    except Exception:
        return unreadable("BROKEN")


CheckField = Literal["reference_no", "amount", "issue_date", "maturity_date"]


class Check(TypedDict):
    field: CheckField
    claimed: str
    found: str | None  # what the text prints next to the field's label
    result: CheckResult


class Claimed(TypedDict):
    referenceNo: str | None
    amount: str | None
    issueDate: str | None
    maturityDate: str | None


def compare(extracted: Extracted, claimed: Claimed) -> list[Check]:
    """ "Document text says X, claimed Y" per field. A value claimed and present anywhere in the text is a match."""
    lab = extracted["labelled"]
    checks: list[Check] = []

    def add(field: CheckField, claimed_value: str | None, found: str | None, present: bool) -> None:
        if not claimed_value:
            return
        result: CheckResult = "MATCH" if present else "DIFFERENT" if found else "NOT_FOUND"
        checks.append({"field": field, "claimed": claimed_value, "found": found, "result": result})

    ref = claimed["referenceNo"]
    if ref:
        wanted = norm_ref(ref)
        seen = {norm_ref(r) for r in extracted["references"]}
        if "referenceNo" in lab:
            seen.add(norm_ref(lab["referenceNo"]))
        add("reference_no", ref, lab.get("referenceNo"), wanted in seen)
    add("amount", claimed["amount"], lab.get("amount"),
        bool(claimed["amount"]) and (claimed["amount"] in extracted["amounts"] or lab.get("amount") == claimed["amount"]))  # fmt: skip
    add("issue_date", claimed["issueDate"], lab.get("issueDate"),
        bool(claimed["issueDate"]) and (claimed["issueDate"] in extracted["dates"] or lab.get("issueDate") == claimed["issueDate"]))  # fmt: skip
    add("maturity_date", claimed["maturityDate"], lab.get("maturityDate"),
        bool(claimed["maturityDate"]) and (claimed["maturityDate"] in extracted["dates"] or lab.get("maturityDate") == claimed["maturityDate"]))  # fmt: skip
    return checks
