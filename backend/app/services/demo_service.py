"""Demo tools (Phase 9, DEMO_MODE only): reset the demo data, correct a mock bank record, list the anchors and
serve demo step 1's sample files. The routes are mounted only when DEMO_MODE=true (D17)."""

from __future__ import annotations

from typing import Literal, TypedDict

from ..db.pool import get_pool, transaction
from ..domain.access import AuthUser, actor_of
from ..domain.audit import NIL_UUID, record_event
from ..domain.errors import AppError, NotFound
from ..repositories.demo_repo import find_instrument_id
from ..repositories.instrument_repo import find_instrument_by_id
from ..repositories.user_repo import find_user_by_email
from ..schemas import BankCorrectionInput
from ..seed.base import INSTITUTIONS
from ..seed.dataset import A1_CLAIMED_AMOUNT, A1_RECORD, A4_REPLACEMENT, ANCHORS
from ..seed.pdf import sample_document
from ..seed.replay import SeedResult, document_rows, reset_and_seed
from . import bank_client

SampleName = Literal["fdr-copy", "fdr-copy-different-amount", "bank-letter"]
SAMPLE_TYPES: dict[str, str] = {
    "fdr-copy": "FDR_COPY",
    "fdr-copy-different-amount": "FDR_COPY",
    "bank-letter": "BANK_LETTER",
}

# API (camelCase) field -> mock bank record key
BANK_KEYS = {
    "amount": "amount",
    "issueDate": "issue_date",
    "maturityDate": "maturity_date",
    "beneficiaryName": "beneficiary_name",
    "lienMarked": "lien_marked",
}


def reset(user: AuthUser) -> SeedResult:
    return reset_and_seed(actor_of(user))


def _records() -> list[bank_client.BankRecord]:
    try:
        return bank_client.list_records()
    except bank_client.BankUnreachable as err:
        raise AppError("BANK_UNREACHABLE", f"The mock bank is not running ({err})", None, 503) from err


def _find(records: list[bank_client.BankRecord], bank: str, ref: str) -> bank_client.BankRecord | None:
    return next((r for r in records if r["bank"] == bank and r["reference_no"] == ref), None)


class BankRecordView(TypedDict):
    bank: str
    referenceNo: str
    amount: str
    issueDate: str
    maturityDate: str
    beneficiaryName: str
    lienMarked: bool
    status: str


def _view(r: bank_client.BankRecord) -> BankRecordView:
    return {"bank": r["bank"], "referenceNo": r["reference_no"], "amount": r["amount"], "issueDate": r["issue_date"],
            "maturityDate": r["maturity_date"], "beneficiaryName": r["beneficiary_name"],
            "lienMarked": r["lien_marked"], "status": r["status"]}  # fmt: skip


class BankCorrectionResult(TypedDict):
    before: BankRecordView
    after: BankRecordView
    instrumentId: str | None


def bank_correction(user: AuthUser, data: BankCorrectionInput) -> BankCorrectionResult:
    """Simulates the bank correcting one record (after the institution's representation). The bank is an external
    system: its store is changed first, outside any transaction (rule 9), then the event is written."""
    records = _records()
    rec = _find(records, data.bank, data.reference_no)
    if rec is None:
        raise NotFound(f"The bank has no record {data.reference_no} at {data.bank}")
    before = _view(rec)
    changed = data.fields.provided()
    for key, bank_key in BANK_KEYS.items():
        if key in changed:
            value = changed[key]
            if bank_key == "lien_marked":
                rec["lien_marked"] = bool(value)
                rec["lien_in_favour_of"] = "Member Secretary, AICTE" if value else None
            elif value is not None:
                rec[bank_key] = str(value)  # type: ignore[literal-required]
    try:
        bank_client.load_records(records)
    except bank_client.BankUnreachable as err:
        raise AppError("BANK_UNREACHABLE", f"The mock bank is not running ({err})", None, 503) from err
    after = _view(rec)
    instrument_id = find_instrument_id(get_pool(), data.bank, data.reference_no)
    with transaction() as tx:
        record_event(tx, actor=actor_of(user), action="DEMO_BANK_CORRECTION", entity_type="bank_record",
                     entity_id=instrument_id or NIL_UUID, instrument_id=instrument_id,
                     before=dict(before), after=dict(after))  # fmt: skip
    return {"before": before, "after": after, "instrumentId": instrument_id}


class AnchorView(TypedDict):
    code: str
    reference: str
    bank: str
    purpose: str
    signInAs: str
    signInAsName: str | None
    instrumentId: str | None
    status: str | None
    verificationState: str | None
    maturityDate: str | None
    bankRecord: BankRecordView | None


def anchors() -> list[AnchorView]:
    db = get_pool()
    try:
        records: list[bank_client.BankRecord] | None = bank_client.list_records()
    except bank_client.BankUnreachable:
        records = None
    out: list[AnchorView] = []
    for a in ANCHORS:
        inst_id = find_instrument_id(db, a.bank, a.reference)
        inst = find_instrument_by_id(db, inst_id) if inst_id else None
        who = find_user_by_email(db, a.sign_in_as)
        ref_for_bank = {"A1": A1_RECORD["reference_no"], "A4": A4_REPLACEMENT["reference_no"]}.get(a.code)
        rec = _find(records, a.bank, str(ref_for_bank)) if records is not None and ref_for_bank else None
        out.append({
            "code": a.code, "reference": a.reference, "bank": a.bank, "purpose": a.purpose,
            "signInAs": a.sign_in_as, "signInAsName": who["name"] if who else None,
            "instrumentId": inst_id, "status": inst["status"] if inst else None,
            "verificationState": inst["verificationState"] if inst else None,
            "maturityDate": inst["maturityDate"] if inst else None,
            "bankRecord": _view(rec) if rec else None,
        })  # fmt: skip
    return out


def sample_file(name: str) -> tuple[bytes, str]:
    """Demo step 1's sample PDF, printed from the bank's current A1 record (so its dates match today's seed).
    The FDR copy shows the amount the institution claims; the "different amount" copy shows the bank's."""
    doc_type = SAMPLE_TYPES.get(name)
    if doc_type is None:
        raise NotFound("No such sample file")
    rec = _find(_records(), str(A1_RECORD["bank"]), str(A1_RECORD["reference_no"]))
    if rec is None:
        raise NotFound("The bank has no A1 record; reset the demo data first")
    values: dict[str, object] = {
        "referenceNo": rec["reference_no"], "branch": "Main Branch", "amount": rec["amount"],
        "issueDate": rec["issue_date"], "maturityDate": rec["maturity_date"],
        "beneficiaryName": rec["beneficiary_name"], "lienMarked": rec["lien_marked"],
    }  # fmt: skip
    if name == "fdr-copy":
        values["amount"] = A1_CLAIMED_AMOUNT  # the amount the presenter claims: the text cross-check shows a match
    # "fdr-copy-different-amount" keeps the bank's amount, which differs from the claim: the cross-check shows a mismatch
    note = "We confirm the above deposit is held with lien in favour of AICTE." if doc_type == "BANK_LETTER" else ""
    body = sample_document(doc_type, document_rows(values), INSTITUTIONS["inst1"]["name"], rec["bank"], note)
    return body, f"A1-{name}.pdf"
