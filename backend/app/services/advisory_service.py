"""Advisory signals for officers: suspicious-pattern flags and the PDF text cross-check.

Advisory only. Nothing here blocks a submission, changes a status or a verification state, or moves a trust tier.
Institutions never receive any of it (the review payload is internal-roles only and no institution-facing response
carries these keys)."""

from __future__ import annotations

from typing import TypedDict

from ..db.pool import Conn, Db
from ..domain import clock, doc_text, patterns
from ..domain.audit import SYSTEM_ACTOR, Actor, record_event
from ..domain.canonical_json import js_json
from ..domain.normalize import norm_ref
from ..domain.rules import load_advisory_rule
from ..repositories import advisory_repo as repo
from ..repositories.advisory_repo import FlagKind, FlagRow
from ..repositories.document_repo import list_live_documents
from ..repositories.instrument_repo import InstrumentRow, find_instrument_by_id
from ..shared_constants import STATUS_LABELS
from . import storage

PRIMARY_DOC = {"FDR": "FDR_COPY", "SECURITY_DEPOSIT": "DEPOSIT_CONFIRMATION"}
UNREADABLE_TEXT = {
    "BROKEN": "The file could not be opened as a PDF.",
    "ENCRYPTED": "The PDF is password-protected, so its text was not read.",
    "TOO_LARGE": "The file is too large to read automatically.",
    "TOO_MANY_PAGES": "The PDF has too many pages to read automatically.",
    "NO_TEXT": "This looks like a scan: it has no readable text.",
    "IMAGE": "This is an image, so there is no text to read.",
}


class Candidate(TypedDict):
    kind: FlagKind
    reason: str
    detail: dict[str, object]


def _candidates(db: Db, inst: InstrumentRow) -> list[Candidate]:
    rule = load_advisory_rule(db)
    out: list[Candidate] = []

    bank, ref = inst["issuingBank"], inst["referenceNo"]
    if bank and ref:
        others = repo.same_reference_elsewhere(db, bank, norm_ref(ref), inst["institutionId"])
        if others:
            holders = "; ".join(f"{o['institutionName']} ({STATUS_LABELS[o['status']]})" for o in others)
            out.append({
                "kind": "DUPLICATE_REFERENCE",
                "reason": f"The same reference number ({ref}) at {bank} is also on record with another institution: "
                          f"{holders}. A genuine deposit belongs to one institution only.",
                "detail": {"referenceNo": ref, "bank": bank, "otherInstrumentIds": [o["id"] for o in others]},
            })  # fmt: skip

    if inst["amount"]:
        amounts = [
            patterns.paise(a) for a in repo.earlier_amounts(db, inst["institutionId"], inst["id"], inst["createdAt"])
        ]
        mine = patterns.paise(inst["amount"])
        if len(amounts) >= rule.min_comparisons:
            median = patterns.median_paise(amounts)
            if patterns.exceeds_multiple(mine, median, rule.amount_multiple):
                median_text = patterns.inr(f"{median // 100}.{median % 100:02d}")
                out.append({
                    "kind": "HIGH_AMOUNT",
                    "reason": f"The amount {patterns.inr(inst['amount'])} is more than {rule.amount_multiple} times "
                              f"what this institution had lodged before (middle value {median_text} across its "
                              f"{len(amounts)} earlier instruments). It may be right; worth a closer look.",
                    "detail": {"amount": inst["amount"], "medianPaise": median, "multiple": rule.amount_multiple,
                               "comparedWith": len(amounts)},
                })  # fmt: skip

    if inst["beneficiaryName"]:
        close = patterns.near_miss_name(inst["beneficiaryName"], rule.names, rule.min_similarity)
        if close:
            out.append({
                "kind": "BENEFICIARY_NEAR_MISS",
                "reason": f"The beneficiary is written “{inst['beneficiaryName']}”, which is close to, but not the "
                          f"same as, the expected “{close}”. Check for a spelling slip or a look-alike name.",
                "detail": {"beneficiaryName": inst["beneficiaryName"], "expected": close},
            })  # fmt: skip
    return out


def _key(kind: str, detail: dict[str, object]) -> str:
    return kind + js_json(dict(sorted(detail.items())))


def refresh_flags(tx: Conn, instrument_id: str, actor: Actor) -> None:
    """Recomputes the instrument's advisory flags (on submission and after a bank verification). Stores them when the
    set changed and writes one audit event; an unchanged result writes nothing. Never raises for a missing row."""
    inst = find_instrument_by_id(tx, instrument_id)
    if inst is None:
        return
    wanted = _candidates(tx, inst)
    current = repo.open_flags(tx, instrument_id)
    if sorted(_key(c["kind"], c["detail"]) for c in wanted) == sorted(_key(f["kind"], f["detail"]) for f in current):
        return
    at = clock.now(tx)
    repo.clear_flags(tx, instrument_id, at)
    for c in wanted:
        repo.insert_flag(tx, instrument_id, c["kind"], c["reason"], c["detail"], at)
    record_event(
        tx, actor=actor, action="ADVISORY_FLAGS_UPDATED", entity_type="instrument", entity_id=instrument_id,
        instrument_id=instrument_id,
        before={"kinds": [f["kind"] for f in current]},
        after={"kinds": [c["kind"] for c in wanted], "reasons": [c["reason"] for c in wanted]},
    )  # fmt: skip


def flags_for_review(db: Db, instrument_id: str) -> list[FlagRow]:
    return repo.open_flags(db, instrument_id)


# ---- document text cross-check ----


def analyse_stored(storage_path: str, ext: str) -> doc_text.Analysis:
    """Reads a freshly stored upload. Never raises: whatever goes wrong becomes UNREADABLE."""
    if ext != "pdf":
        return doc_text.unreadable("IMAGE")
    try:
        return doc_text.analyse(storage.read_stored(storage_path))
    except Exception:
        return doc_text.unreadable("BROKEN")


def record_finding(tx: Conn, document_id: str, instrument_id: str, analysis: doc_text.Analysis) -> None:
    at = clock.now(tx)
    repo.insert_finding(tx, document_id, instrument_id, analysis["status"], analysis["reason"],
                        analysis["extracted"], analysis["metadata"], at)  # fmt: skip
    record_event(
        tx, actor=SYSTEM_ACTOR, action="DOCUMENT_TEXT_CHECKED", entity_type="document_text_check", entity_id=document_id,
        instrument_id=instrument_id,
        after={"status": analysis["status"], "reason": analysis["reason"],
               "metadataSignal": analysis["metadata"]["reasons"] if analysis["metadata"] else []},
    )  # fmt: skip


class DocumentFindingView(TypedDict):
    documentId: str
    filename: str
    docType: str
    status: str
    reason: str | None
    message: str | None  # plain-language reason for UNREADABLE
    checks: list[doc_text.Check]  # only for the instrument's main document (the FDR copy / deposit confirmation)
    metadataSignal: doc_text.MetadataSignal | None
    advisoryLabel: str


class DocumentFindings(TypedDict):
    items: list[DocumentFindingView]
    note: str


def findings_for_review(db: Db, inst: InstrumentRow) -> DocumentFindings:
    findings = {f["documentId"]: f for f in repo.findings_for_instrument(db, inst["id"])}
    claimed: doc_text.Claimed = {
        "referenceNo": inst["referenceNo"], "amount": inst["amount"], "issueDate": inst["issueDate"],
        "maturityDate": inst["maturityDate"],
    }  # fmt: skip
    primary = PRIMARY_DOC.get(inst["type"])
    items: list[DocumentFindingView] = []
    for d in list_live_documents(db, inst["id"]):
        f = findings.get(d["id"])
        if f is None:
            continue
        readable = f["status"] == "READ"
        reason = f["reason"]
        items.append({
            "documentId": d["id"], "filename": d["filename"], "docType": d["docType"], "status": f["status"],
            "reason": reason, "message": None if readable else UNREADABLE_TEXT.get(reason or "", "Text could not be read."),
            "checks": doc_text.compare(f["extracted"], claimed) if readable and d["docType"] == primary else [],  # type: ignore[arg-type]
            "metadataSignal": f["metadataSignal"],  # type: ignore[typeddict-item]
            "advisoryLabel": "Advisory only. The trust tiers are not changed by this.",
        })  # fmt: skip
    return {"items": items, "note": "Advisory only. The trust tiers are not changed by this."}
