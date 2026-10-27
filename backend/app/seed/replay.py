"""Phase 9 seed engine: wipes the data, loads the bank's records, then replays every instrument's script day by day
through the real services, running the evaluation job as the days pass. Events, the hash chain, provenance,
verifications, alerts and escalations are therefore all genuine. Ends SIMULATED at D0 (today's real date).

Used by `npm run seed` (python -m app.seed) and POST /demo/reset.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import threading
import time
from collections.abc import Callable
from typing import TypedDict

from ..config import config
from ..db.pool import get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser
from ..domain.audit import CHAIN_LOCK, NIL_UUID, SYSTEM_ACTOR, Actor, record_event
from ..domain.errors import AppError, Conflict
from ..jobs.evaluate import JOB_LOCK, evaluate
from ..middleware.validate import parse
from ..repositories import demo_repo
from ..repositories.user_repo import find_user_by_email
from ..schemas import (
    AcceptInput,
    ConditionUpdate,
    DecideInput,
    DocumentCheckInput,
    InstrumentCreate,
    InstrumentPatch,
    ObservationCreate,
    RecommendInput,
    ReleaseRequestCreate,
)
from ..services import (
    bank_client,
    document_service,
    instrument_service,
    release_service,
    renewal_service,
    scrutiny_service,
    submission,
    verification_service,
)
from ..services.audit_service import clear_integrity_cache
from ..services.document_service import IncomingFile
from ..shared_constants import FIELD_LABELS
from .base import INSTITUTIONS, seed_base
from .dataset import A1_CLAIMED_AMOUNT, A1_RECORD, A4_REPLACEMENT, AICTE, LIEN_HOLDER, Spec, Step, build
from .pdf import sample_document

# Evaluate every day of the last weeks (alerts and escalations land on their exact dates), every 5th day before.
DAILY_FROM = -45
GRID = 5


class SeedResult(TypedDict):
    d0: str
    instruments: int
    events: int
    alerts: int
    durationMs: int


_running = threading.Lock()


def _day(d0: str, offset: int) -> str:
    return clock.add_days(d0, offset)


def _fmt_inr(amount: str) -> str:
    rupees, paise = amount.split(".")
    head, tail = rupees[:-3], rupees[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return "₹" + ",".join([*groups, tail]) + ("" if paise == "00" else f".{paise}")


# ---- bank records ----


def bank_record(spec: Spec, d0: str) -> bank_client.BankRecord:
    lien = spec.lien and spec.type == "FDR"
    assert spec.ref is not None
    return {
        "bank": spec.bank,
        "reference_no": spec.ref,
        "amount": spec.amount,
        "issue_date": _day(d0, spec.issue),
        "maturity_date": _day(d0, spec.maturity),
        "beneficiary_name": AICTE if spec.beneficiary == AICTE else spec.beneficiary,
        "lien_marked": lien,
        "lien_in_favour_of": LIEN_HOLDER if lien else None,
        "status": "LIVE",
    }


def extra_record(r: dict[str, object], d0: str) -> bank_client.BankRecord:
    return {
        "bank": str(r["bank"]),
        "reference_no": str(r["reference_no"]),
        "amount": str(r["amount"]),
        "issue_date": _day(d0, int(str(r["issue"]))),
        "maturity_date": _day(d0, int(str(r["maturity"]))),
        "beneficiary_name": AICTE,
        "lien_marked": True,
        "lien_in_favour_of": LIEN_HOLDER,
        "status": "LIVE",
    }


def bank_records(specs: list[Spec], d0: str) -> list[bank_client.BankRecord]:
    """The bank's true records: every non-draft instrument (none for the not-found case), A1 and A4's replacement."""
    out = [bank_record(s, d0) for s in specs if s.bank_record]
    return [*out, extra_record(A1_RECORD, d0), extra_record(A4_REPLACEMENT, d0)]


# ---- sample documents ----


def document_rows(values: dict[str, object]) -> list[tuple[str, str]]:
    lien = values.get("lienMarked")
    return [
        ("Deposit number", str(values.get("referenceNo") or "")),
        ("Branch", str(values.get("branch") or "")),
        ("Amount", _fmt_inr(str(values["amount"])) if values.get("amount") else ""),
        ("Date of issue", str(values.get("issueDate") or "")),
        ("Date of maturity", str(values.get("maturityDate") or "")),
        ("In favour of", str(values.get("beneficiaryName") or "")),
        ("Lien", f"Marked in favour of {LIEN_HOLDER}" if lien else "Not marked"),
    ]


def a1_values(d0: str) -> dict[str, object]:
    return {
        "referenceNo": A1_RECORD["reference_no"], "issuingBank": A1_RECORD["bank"], "branch": "Main Branch",
        "amount": A1_RECORD["amount"], "issueDate": _day(d0, int(str(A1_RECORD["issue"]))),
        "maturityDate": _day(d0, int(str(A1_RECORD["maturity"]))), "beneficiaryName": AICTE, "lienMarked": True,
    }  # fmt: skip


def a1_sample(doc_type: str, d0: str, *, amount_on_copy: str = "claimed") -> bytes:
    """Demo step 1's sample PDFs for today's D0. The bank letter always carries the bank's true values.

    The FDR copy carries the amount the institution is going to claim (`amount_on_copy="claimed"`, the default), so
    the advisory text cross-check shows a match and only the bank reveals the mismatch. `"bank"` prints the bank's
    own amount instead ("FDR copy with a different amount"): the cross-check then shows a mismatch."""
    values = a1_values(d0)
    if doc_type == "FDR_COPY" and amount_on_copy == "claimed":
        values["amount"] = A1_CLAIMED_AMOUNT
    note = "We confirm the above deposit is held with lien in favour of AICTE." if doc_type == "BANK_LETTER" else ""
    return sample_document(doc_type, document_rows(values), INSTITUTIONS["inst1"]["name"],
                           str(A1_RECORD["bank"]), note)  # fmt: skip


# ---- replay ----


class Replay:
    def __init__(self, d0: str, specs: list[Spec], records: list[bank_client.BankRecord]) -> None:
        self.d0 = d0
        self.specs = {s.key: s for s in specs}
        self.records = records
        self.ids: dict[str, str] = {}
        self.requests: dict[str, str] = {}
        self.users: dict[str, AuthUser] = {}
        self.tmp = tempfile.mkdtemp(prefix="fdr-seed-")
        self.uploads = 0

    def user(self, email: str) -> AuthUser:
        if email not in self.users:
            u = find_user_by_email(get_pool(), email)
            assert u is not None, email
            self.users[email] = AuthUser(u["id"], u["name"], u["role"], u["institution_id"])
        return self.users[email]

    def institution(self, s: Spec) -> AuthUser:
        return self.user(f"inst{s.inst}@demo.in")

    def claimed(self, s: Spec) -> dict[str, object]:
        """What the institution types (the bank's values unless the case says otherwise)."""
        assert s.ref is not None
        ref = s.ref
        if s.claim.get("transpose"):
            ref = ref[:-2] + ref[-1] + ref[-2]
        return {
            "type": s.type,
            "referenceNo": ref,
            "issuingBank": s.bank,
            "branch": s.branch,
            "amount": s.claim.get("amount", s.amount),
            "issueDate": _day(self.d0, s.issue),
            "maturityDate": _day(self.d0, int(str(s.claim.get("maturity", s.maturity)))),
            "beneficiaryName": s.claim.get("beneficiary", s.beneficiary),
            "lienMarked": bool(s.claim.get("lien", s.lien and s.type == "FDR")),
            "purpose": s.purpose,
        }

    def file(self, s: Spec, doc_type: str, n: int) -> IncomingFile:
        """A generated PDF with the instrument's true values (each upload unique, so no duplicate warnings)."""
        values = self.claimed(s) | {"amount": s.amount, "beneficiaryName": AICTE if s.beneficiary == AICTE
                                    else s.beneficiary, "referenceNo": s.ref}  # fmt: skip
        notes = {"BANK_LETTER": "We confirm the deposit above is held by us as stated.",
                 "RELEASE_LETTER": "The institution requests release of the deposit to its account.",
                 "LIEN_REMOVAL_REQUEST": "Please remove the lien on release by AICTE."}  # fmt: skip
        body = sample_document(doc_type, document_rows(values), INSTITUTIONS[f"inst{s.inst}"]["name"], s.bank,
                               f"{notes.get(doc_type, '')} (copy {n})".strip())  # fmt: skip
        path = os.path.join(self.tmp, f"upload-{self.uploads}.pdf")
        self.uploads += 1
        with open(path, "wb") as f:
            f.write(body)
        name = f"{doc_type.lower().replace('_', '-')}-{(s.ref or s.key).replace('/', '-')}.pdf"
        return IncomingFile(path, name)

    def run(self, step: Step) -> None:
        s = self.specs[step.key]
        a = step.args
        handler: Callable[[Spec, dict[str, object]], None] = getattr(self, f"_{step.action}")
        try:
            handler(s, a)
        except AppError as err:
            raise RuntimeError(f"seed step failed: day {step.day} {step.action} {step.key}: {err.code} "
                               f"{err.args[0] if err.args else ''} {getattr(err, 'details', '')}") from err  # fmt: skip

    def _officer(self, a: dict[str, object]) -> AuthUser:
        return self.user(str(a["officer"]))

    def _create(self, s: Spec, a: dict[str, object]) -> None:
        values: dict[str, object] = {"type": s.type} if a.get("empty") else self.claimed(s)
        detail = instrument_service.create_draft(self.institution(s), parse(InstrumentCreate, values))
        self.ids[s.key] = detail["id"]

    def _upload(self, s: Spec, a: dict[str, object]) -> None:
        doc_type = str(a["docType"])
        document_service.upload_document(self.institution(s), self.ids[s.key], doc_type,
                                         self.file(s, doc_type, self.uploads))  # fmt: skip

    def _submit(self, s: Spec, a: dict[str, object]) -> None:
        submission.submit_instrument(self.institution(s), self.ids[s.key])

    def _claim(self, s: Spec, a: dict[str, object]) -> None:
        scrutiny_service.claim(self._officer(a), self.ids[s.key])

    def _verify(self, s: Spec, a: dict[str, object]) -> None:
        verification_service.request_verification(self._officer(a), self.ids[s.key])

    def _check_document(self, s: Spec, a: dict[str, object]) -> None:
        officer = self._officer(a)
        detail = instrument_service.get_instrument(officer, self.ids[s.key])
        primary = "FDR_COPY" if s.type == "FDR" else "DEPOSIT_CONFIRMATION"
        doc = next(d for d in detail["documents"] if d["docType"] == primary)
        field = str(a["field"])
        scrutiny_service.check_document(officer, self.ids[s.key], field, parse(DocumentCheckInput, {
            "documentId": doc["id"], "note": f"{FIELD_LABELS[field]} read from the original {primary.replace('_', ' ').lower()}"}))  # type: ignore[index]  # fmt: skip

    def _observe(self, s: Spec, a: dict[str, object]) -> None:
        scrutiny_service.add_observation(self._officer(a), self.ids[s.key], parse(ObservationCreate, {
            "text": a["text"], "severity": a["severity"], "visibleToInstitution": a["visible"]}))  # fmt: skip

    def _return(self, s: Spec, a: dict[str, object]) -> None:
        scrutiny_service.return_instrument(self._officer(a), self.ids[s.key], str(a["reason"]))

    def _edit(self, s: Spec, a: dict[str, object]) -> None:
        user = self.institution(s)
        detail = instrument_service.get_instrument(user, self.ids[s.key])
        values = dict(a) if a else {k: v for k, v in self.claimed(s).items() if k != "type"}
        instrument_service.edit_instrument(user, self.ids[s.key],
                                           parse(InstrumentPatch, {**values, "version": detail["version"]}))  # fmt: skip

    def _accept(self, s: Spec, a: dict[str, object]) -> None:
        officer = self._officer(a)
        if a.get("resolveObservations"):
            review = scrutiny_service.get_review(officer, self.ids[s.key])
            for o in review["observations"]:
                if o["status"] == "OPEN":
                    scrutiny_service.resolve_observation_with_note(officer, o["id"], "Signed copy received")
        override = a.get("override")
        scrutiny_service.accept(officer, self.ids[s.key], parse(AcceptInput, {"overrideNote": override} if override
                                                                 else {}))  # fmt: skip

    def _renew(self, s: Spec, a: dict[str, object]) -> None:
        detail = renewal_service.renew(self.institution(s), self.ids[str(a["parent"])])
        self.ids[s.key] = detail["id"]

    def _request_release(self, s: Spec, a: dict[str, object]) -> None:
        view = release_service.create_request(self.institution(s), self.ids[s.key],
                                              parse(ReleaseRequestCreate, {"reason": a["reason"]}))  # fmt: skip
        self.requests[s.key] = view["request"]["id"]

    def _release_document(self, s: Spec, a: dict[str, object]) -> None:
        doc_type = str(a["docType"])
        release_service.upload_release_document(self.institution(s), self.requests[s.key], doc_type,
                                                self.file(s, doc_type, self.uploads))  # fmt: skip

    def _tick(self, s: Spec, a: dict[str, object]) -> None:
        officer = self._officer(a)
        view = release_service.get_request(officer, self.requests[s.key])
        remarks = {"COMPLIANCE_CONFIRMED": "Obligation confirmed fulfilled from the approval file",
                   "LIEN_REMOVAL_DOCUMENT": "Lien removal request from the bank is on file"}  # fmt: skip
        for c in view["conditions"]:
            if not c["auto"] and not c["met"]:
                release_service.update_condition(officer, c["id"], parse(ConditionUpdate, {
                    "met": True, "remarks": remarks.get(c["code"], "Checked")}))  # fmt: skip

    def _recommend(self, s: Spec, a: dict[str, object]) -> None:
        officer = self._officer(a)
        view = release_service.get_request(officer, self.requests[s.key])
        release_service.recommend(officer, self.requests[s.key], parse(RecommendInput, {
            "remarks": "All conditions met; release recommended.", "level": view["request"]["currentLevel"]}))  # fmt: skip

    def _decide(self, s: Spec, a: dict[str, object]) -> None:
        user = self.user(str(a["user"]))
        view = release_service.get_request(user, self.requests[s.key])
        body: dict[str, object] = {"decision": a["decision"], "level": view["request"]["currentLevel"],
                                   "remarks": a.get("remarks") or "Approved. Conditions verified on the portal."}  # fmt: skip
        if a.get("refund"):
            body["refundReference"] = a["refund"]
        release_service.decide(user, self.requests[s.key], parse(DecideInput, body))

    def _bank_update(self, s: Spec, a: dict[str, object]) -> None:
        for r in self.records:
            if r["bank"] == s.bank and r["reference_no"] == s.ref and "amount" in a:
                r["amount"] = str(a["amount"])
        bank_client.load_records(self.records)


def _evaluate(day: str) -> None:
    with transaction() as tx:
        clock.set_simulated_at(tx, day, 18)
        evaluate(tx, day)


def _set_clock(day: str, hour: int, minute: int) -> None:
    with transaction() as tx:
        clock.set_simulated_at(tx, day, hour, minute)


def _wipe(d0: str) -> None:
    """Empties the data under the evaluation lock (409 while a job runs) and the audit-chain lock."""
    with transaction() as tx:
        if not demo_repo.try_lock(tx, JOB_LOCK):
            raise Conflict("The evaluation job is running; try the reset again in a moment", None, "EVALUATION_RUNNING")
        demo_repo.lock(tx, CHAIN_LOCK)
        demo_repo.truncate_all(tx)
        clock.set_simulated(tx, d0)
        seed_base(tx)


def _clear_storage() -> None:
    root = config.storage_dir
    if not root.is_dir():
        return
    for child in root.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)


def reset_and_seed(actor: Actor | None = None) -> SeedResult:
    """The whole demo dataset. Refuses (409) while another reset or the evaluation job is running."""
    if not _running.acquire(blocking=False):
        raise Conflict("A demo reset is already running", None, "RESET_RUNNING")
    try:
        return _reset_and_seed(actor)
    finally:
        _running.release()


def _reset_and_seed(actor: Actor | None) -> SeedResult:
    started = time.monotonic()
    d0 = clock.real_today()
    specs = build(d0)
    records = bank_records(specs, d0)
    try:
        bank_client.list_records()
    except bank_client.BankUnreachable as err:
        raise AppError("BANK_UNREACHABLE",
                       f"The mock bank is not running ({err}). Start it first: npm run dev:bank", None, 503) from err  # fmt: skip
    _wipe(d0)
    _clear_storage()
    bank_client.load_records(records)

    replay = Replay(d0, specs, records)
    by_day: dict[int, list[Step]] = {}
    for s in specs:
        for st in s.steps:
            by_day.setdefault(st.day, []).append(st)
    first = min(by_day)
    try:
        for offset in range(first, 0):  # D0 itself is evaluated last, at 10:00
            steps = by_day.get(offset, [])
            if not steps and offset < DAILY_FROM and offset % GRID != 0:
                continue
            day = _day(d0, offset)
            for n, st in enumerate(steps):
                _set_clock(day, 10 + (n * 7) // 60, (n * 7) % 60)
                replay.run(st)
            _evaluate(day)
    finally:
        shutil.rmtree(replay.tmp, ignore_errors=True)

    db = get_pool()
    with transaction() as tx:
        clock.set_simulated(tx, d0)
        evaluate(tx, d0)
        counts = {t: demo_repo.count(tx, t) for t in ("instruments", "events", "alerts")}
        record_event(tx, actor=actor or SYSTEM_ACTOR, action="DEMO_RESET", entity_type="demo", entity_id=NIL_UUID,
                     after={"demoDate": d0, "instruments": counts["instruments"]})  # fmt: skip
    clear_integrity_cache()
    return {
        "d0": d0,
        "instruments": counts["instruments"],
        "events": demo_repo.count(db, "events"),
        "alerts": counts["alerts"],
        "durationMs": int((time.monotonic() - started) * 1000),
    }
