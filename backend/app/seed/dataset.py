"""The demo dataset (docs/seed-spec.md) as data: 60 instruments, each with a script of service calls on days relative
to D0, plus the bank's true records. `replay.py` plays the scripts through the real services.

Days are offsets from D0 (negative = past). Amounts are the bank's true values; `claim` lists what the institution
typed where it differs (the tricky cases). Reference numbers of filler instruments and the A8 chain carry the year of
their issue date; the anchors' references fixed by the seed spec are kept as written.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from ..domain import clock
from ..shared_constants import InstrumentType
from .prng import Mulberry32

AICTE = "MEMBER SECRETARY AICTE"
LIEN_HOLDER = "Member Secretary, AICTE"
OVERRIDE_NOTE = (
    "Bank verification service was unavailable. Original FDR sighted and the bank's confirmation letter checked "
    "field by field; accepted pending the bank's written confirmation."
)

BANK_CODES: dict[str, tuple[str, str]] = {
    "State Bank of India": ("SBIN", "FDR"),
    "Punjab National Bank": ("PUNB", "FDR"),
    "Bank of Baroda": ("BARB", "FDR"),
    "Canara Bank": ("CNRB", "FD"),
    "Union Bank of India": ("UBIN", "FDR"),
    "HDFC Bank": ("HDFC", "FD"),
    "ICICI Bank": ("ICIC", "FD"),
    "Axis Bank": ("UTIB", "FD"),
    "Bank of India": ("BKID", "FD"),
    "Indian Overseas Bank": ("IOBA", "FD"),
    "Kotak Mahindra Bank": ("KKBK", "FD"),
}

BRANCHES: dict[str, list[str]] = {
    "State Bank of India": ["Main Branch", "Industrial Estate", "University Campus"],
    "Punjab National Bank": ["Civil Lines", "Mall Road"],
    "Bank of Baroda": ["Station Road", "Collectorate"],
    "Canara Bank": ["Market Branch", "Gandhi Nagar"],
    "Union Bank of India": ["Ring Road", "Town Hall"],
    "HDFC Bank": ["Corporate Branch", "MG Road"],
    "ICICI Bank": ["Ferozepur Road", "City Centre"],
    "Axis Bank": ["Fort Area", "Nehru Place"],
    "Bank of India": ["Bow Bazar", "Park Street"],
    "Indian Overseas Bank": ["Anna Salai", "Cantonment"],
    "Kotak Mahindra Bank": ["Cantt Road", "Lanka"],
}

PURPOSES = [
    "Security deposit for grant of approval (new institution)",
    "Corpus fund towards extension of approval",
    "Security deposit for increase in intake",
    "Fixed deposit lodged towards change of site",
    "Security deposit for introduction of new course",
]

Action = Literal[
    "create", "upload", "submit", "claim", "verify", "check_document", "observe", "return", "edit", "accept",
    "renew", "request_release", "release_document", "tick", "recommend", "decide", "bank_update",
]  # fmt: skip


@dataclass(frozen=True)
class Step:
    day: int
    action: Action
    key: str
    args: dict[str, object] = field(default_factory=dict)


@dataclass
class Spec:
    key: str
    inst: int
    bank: str
    amount: str
    issue: int
    maturity: int
    type: InstrumentType = "FDR"
    ref: str | None = None  # fixed by the seed spec; otherwise derived from the issue date
    beneficiary: str = AICTE
    lien: bool = True  # bank's record: lien marked in favour of AICTE
    claim: dict[str, object] = field(default_factory=dict)  # what the institution typed, where it differs
    bank_record: bool = True
    parent: str | None = None  # renewal: the instrument this replaces
    serial: int | None = None  # fixed serial for a derived reference (the A8 chain)
    branch: str = ""
    purpose: str = ""
    steps: list[Step] = field(default_factory=list)


@dataclass(frozen=True)
class Anchor:
    code: str
    key: str | None  # instrument key (None: A1 has only a bank record)
    reference: str
    bank: str
    sign_in_as: str
    purpose: str


ANCHORS: tuple[Anchor, ...] = (
    Anchor("A1", None, "SBIN/FDR/2026/00731", "State Bank of India", "inst1@demo.in",
           "Live submission (step 1): type ₹25,00,000 — the bank holds ₹20,00,000, so step 2 catches the mismatch"),
    Anchor("A2", "A2", "CNRB/FD/2025/11842", "Canara Bank", "admin@demo.in",
           "+7 day jump: becomes Expiring and the 90-day reminders fire (step 4)"),
    Anchor("A3", "A3", "HDFC/FD/2026/55210", "HDFC Bank", "approver@demo.in",
           "Verification pending; after +7 days it escalates to the competent authority (step 5)"),
    Anchor("A4", "A4", "UBIN/FDR/2025/30418", "Union Bank of India", "inst1@demo.in",
           "Renewal (step 6): replacement UBIN/FDR/2026/40977, ₹35,00,000, bank record pre-loaded"),
    Anchor("A5", "A5", "PUNB/FDR/2024/77015", "Punjab National Bank", "officer@demo.in",
           "Release blocked by an amount discrepancy; bank correction → re-verify → recommend → approve (step 7)"),
    Anchor("A6", "A6", "ICIC/FD/2023/09981", "ICICI Bank", "admin@demo.in",
           "Lapsed without renewal, escalated up to the administrator (step 5)"),
    Anchor("A7", "A7", "BARB/FDR/2022/12077", "Bank of Baroda", "auditor@demo.in",
           "Released with refund reference PFMS/RF/2026/0457 — a complete history"),
    Anchor("A8", "A8c", "KKBK/FD/2025/01563", "Kotak Mahindra Bank", "officer@demo.in",
           "Renewal chain: 12-day coverage gap A8a → A8b, 5-day overlap A8b → A8c (step 6)"),
    Anchor("A9", "A9", "SBIN/FDR/2025/66120", "State Bank of India", "approver2@demo.in",
           "₹1.2 Cr release approved at level 2, waiting for the second approver (step 7)"),
)  # fmt: skip

A1_RECORD = {"bank": "State Bank of India", "reference_no": "SBIN/FDR/2026/00731", "amount": "2000000.00",
             "issue": -10, "maturity": 355}  # fmt: skip
A4_REPLACEMENT = {"bank": "Union Bank of India", "reference_no": "UBIN/FDR/2026/40977", "amount": "3500000.00",
                  "issue": 5, "maturity": 400}  # fmt: skip
A5_BANK_AMOUNT_AT_REVERIFY = "1450000.00"

# Officers by region (seed spec: officer@ South-Central & Southern …, officer2@ Northern & Western).
OFFICER_FOR_REGION = {
    "South-Central": "officer@demo.in", "Southern": "officer@demo.in", "South-West": "officer@demo.in",
    "Central": "officer@demo.in", "Eastern": "officer@demo.in",
    "Northern": "officer2@demo.in", "North-West": "officer2@demo.in", "Western": "officer2@demo.in",
}  # fmt: skip
INSTITUTION_REGION = {1: "South-Central", 2: "Southern", 3: "South-West", 4: "Central", 5: "Western", 6: "Western",
                      7: "Eastern", 8: "Eastern", 9: "Northern", 10: "North-West", 11: "Northern", 12: "Southern"}  # fmt: skip


def officer_for(inst: int) -> str:
    return OFFICER_FOR_REGION[INSTITUTION_REGION[inst]]


def required_docs(spec: Spec) -> list[str]:
    return ["FDR_COPY", "BANK_LETTER"] if spec.type == "FDR" else ["DEPOSIT_CONFIRMATION"]


# ---- script builders ----


def lodge(
    s: Spec,
    day: int,
    *,
    verify_day: int | None = None,
    accept_day: int | None = None,
    officer: str | None = None,
    override: bool = False,
    claim_day: int | None = None,
) -> None:
    """Create, upload the required documents and submit on `day`; claim and verify the next day; accept after."""
    off = officer or officer_for(s.inst)
    s.steps.append(Step(day, "create", s.key))
    for doc in required_docs(s):
        s.steps.append(Step(day, "upload", s.key, {"docType": doc}))
    s.steps.append(Step(day, "submit", s.key))
    c = day + 1 if claim_day is None else claim_day
    s.steps.append(Step(c, "claim", s.key, {"officer": off}))
    if verify_day is not None:
        s.steps.append(Step(verify_day, "verify", s.key, {"officer": off}))
    if accept_day is not None:
        if override:
            for f in ("amount", "issue_date", "maturity_date", "reference_no"):
                s.steps.append(Step(accept_day, "check_document", s.key, {"officer": off, "field": f}))
        s.steps.append(
            Step(accept_day, "accept", s.key, {"officer": off, "override": OVERRIDE_NOTE if override else None})
        )


def live(s: Spec, day: int) -> Spec:
    """The normal path: submitted on `day`, verified (all green) next day, accepted the day after."""
    lodge(s, day, verify_day=day + 1, accept_day=day + 2)
    return s


def renewal(child: Spec, parent: Spec, day: int, accept_day: int) -> Spec:
    """Institution starts the renewal on `day`, completes the draft and submits; officer verifies and accepts."""
    child.parent = parent.key
    off = officer_for(child.inst)
    child.steps += [
        Step(day, "renew", child.key, {"parent": parent.key}),
        Step(day, "edit", child.key),
        *[Step(day, "upload", child.key, {"docType": d}) for d in required_docs(child)],
        Step(day, "submit", child.key),
        Step(accept_day, "claim", child.key, {"officer": off}),
        Step(accept_day, "verify", child.key, {"officer": off}),
        Step(accept_day, "accept", child.key, {"officer": off}),
    ]
    return child


def release(
    s: Spec,
    day: int,
    *,
    reason: str,
    tick: int | None = None,
    recommend: int | None = None,
    approve: list[tuple[int, str]] | None = None,
    refund: str | None = None,
) -> Spec:
    off = officer_for(s.inst)
    s.steps += [
        Step(day, "request_release", s.key, {"reason": reason}),
        Step(day, "release_document", s.key, {"docType": "RELEASE_LETTER"}),
        Step(day, "release_document", s.key, {"docType": "LIEN_REMOVAL_REQUEST"}),
    ]
    if tick is not None:
        s.steps.append(Step(tick, "tick", s.key, {"officer": off}))
    if recommend is not None:
        s.steps.append(Step(recommend, "recommend", s.key, {"officer": off}))
    for n, (d, who) in enumerate(approve or [], start=1):
        last = n == len(approve or [])
        s.steps.append(Step(d, "decide", s.key, {"user": who, "decision": "APPROVE",
                                                  "refund": refund if last else None}))  # fmt: skip
    return s


# ---- the dataset ----


def build(d0: str) -> list[Spec]:
    """The 60 instruments for demo date `d0` (deterministic: a fixed PRNG seed)."""
    rng = Mulberry32(26265)
    specs: list[Spec] = []

    def add(s: Spec) -> Spec:
        if not s.branch:
            s.branch = rng.choice(BRANCHES[s.bank])
        if not s.purpose:
            s.purpose = rng.choice(PURPOSES)
        specs.append(s)
        return s

    def sp(key: str, inst: int, bank: str, lakh: float, issue: int, maturity: int, **kw: object) -> Spec:
        amount = f"{round(lakh * 100000):d}.00"
        return add(Spec(key, inst, bank, amount, issue, maturity, **kw))  # type: ignore[arg-type]

    # ACTIVE, bank-confirmed (14, incl. A2, A8c and four renewal replacements)
    live(sp("A2", 2, "Canara Bank", 40, -330, 97, ref="CNRB/FD/2025/11842"), -325)
    for key, inst, bank, lakh, issue, mat, typ in (
        ("F1", 1, "State Bank of India", 30, -200, 530, "FDR"),
        ("F3", 5, "ICICI Bank", 15, -95, 635, "SECURITY_DEPOSIT"),
        ("F4", 6, "Union Bank of India", 22, -300, 430, "FDR"),
        ("F5", 7, "Axis Bank", 60, -260, 470, "FDR"),
        ("F6", 9, "Punjab National Bank", 10, -60, 305, "FDR"),
        ("F7", 10, "Bank of Baroda", 45, -420, 310, "FDR"),
        ("F8", 12, "Canara Bank", 250, -130, 600, "FDR"),
    ):
        live(sp(key, inst, bank, lakh, issue, mat, type=typ), issue + rng.int_between(3, 9))
    # F2: a full correction cycle in its history (amount typed wrong, returned, corrected, re-verified).
    # F2's bank amount is ₹80 L; the first claim was ₹8 L (a missing zero).
    f2 = sp("F2", 3, "HDFC Bank", 80, -150, 215, claim={"amount": "800000.00"})
    lodge(f2, -144, verify_day=-143)
    f2.steps += [
        Step(-142, "return", "F2", {"officer": officer_for(3), "reason": "Amount does not match the bank record"}),
        Step(-139, "edit", "F2", {"amount": "8000000.00"}),
        Step(-139, "submit", "F2"),
        Step(-138, "claim", "F2", {"officer": officer_for(3)}),
        Step(-138, "verify", "F2", {"officer": officer_for(3)}),
        Step(-137, "accept", "F2", {"officer": officer_for(3)}),
    ]

    # ACTIVE, accepted with override while the bank (Indian Overseas Bank) was unavailable (2)
    lodge(sp("O1", 4, "Indian Overseas Bank", 6, -170, 560), -165, verify_day=-164, accept_day=-162, override=True)
    lodge(sp("O2", 11, "Indian Overseas Bank", 9, -75, 290, type="SECURITY_DEPOSIT"), -70, verify_day=-69,
          accept_day=-67, override=True)  # fmt: skip

    # EXPIRING (8), maturities 8–88 days out, incl. A4
    live(sp("A4", 1, "Union Bank of India", 35, -400, 37, ref="UBIN/FDR/2025/30418"), -394)
    for key, inst, bank, lakh, issue, mat, typ in (
        ("E1", 2, "State Bank of India", 20, -357, 8, "FDR"),
        ("E2", 3, "Punjab National Bank", 5, -350, 15, "SECURITY_DEPOSIT"),
        ("E3", 5, "HDFC Bank", 28, -341, 24, "FDR"),
        ("E4", 6, "Canara Bank", 14, -678, 52, "FDR"),
        ("E6", 10, "Axis Bank", 11, -1020, 75, "FDR"),
        ("E7", 12, "Kotak Mahindra Bank", 32, -277, 88, "FDR"),
    ):
        live(sp(key, inst, bank, lakh, issue, mat, type=typ), issue + rng.int_between(3, 9))
    e5 = sp("E5", 8, "ICICI Bank", 75, -299, 66)
    lodge(e5, -292, verify_day=-291)
    e5.steps += [
        Step(-291, "observe", "E5", {"officer": officer_for(8), "severity": "CONCERN", "visible": True,
                                     "text": "Bank letter is unsigned; please upload the signed copy."}),
        Step(-290, "return", "E5", {"officer": officer_for(8), "reason": "Upload the signed bank letter"}),
        Step(-287, "upload", "E5", {"docType": "BANK_LETTER"}),
        Step(-287, "submit", "E5"),
        Step(-285, "claim", "E5", {"officer": officer_for(8)}),
        Step(-285, "accept", "E5", {"officer": officer_for(8), "resolveObservations": True}),
    ]  # fmt: skip

    # MATURED (3) inside the 15-day grace period; LAPSED (3) incl. A6
    for key, inst, bank, lakh, issue, mat, typ in (
        ("M1", 4, "Bank of Baroda", 16, -368, -3, "FDR"),
        ("M2", 7, "State Bank of India", 24, -737, -7, "FDR"),
        ("M3", 9, "Union Bank of India", 7, -377, -12, "SECURITY_DEPOSIT"),
        ("L1", 2, "HDFC Bank", 9, -385, -20, "FDR"),
        ("L2", 8, "Canara Bank", 13, -780, -50, "FDR"),
    ):
        live(sp(key, inst, bank, lakh, issue, mat, type=typ), issue + rng.int_between(3, 9))
    live(sp("A6", 10, "ICICI Bank", 18, -1130, -35, ref="ICIC/FD/2023/09981"), -1125)

    # RENEWED (6): the A8 chain (A8a → A8b → A8c) and four parents whose replacements are ACTIVE
    a8a = live(sp("A8a", 11, "Kotak Mahindra Bank", 22, -1837, -1107, serial=412), -1832)
    a8b = renewal(sp("A8b", 11, "Kotak Mahindra Bank", 22, -1095, -365, serial=977), a8a, -1095, -1094)
    renewal(sp("A8c", 11, "Kotak Mahindra Bank", 22, -370, 360, serial=1563), a8b, -370, -368)
    for pk, ck, inst, bank, lakh, typ, p_issue, p_mat, c_issue, c_mat, start, accept in (
        ("R1p", "R1c", 1, "State Bank of India", 25, "FDR", -480, -115, -122, 608, -121, -118),
        ("R2p", "R2c", 4, "Punjab National Bank", 12, "SECURITY_DEPOSIT", -760, -30, -36, 694, -35, -33),
        ("R3p", "R3c", 8, "Bank of Baroda", 50, "FDR", -1100, -200, -205, 525, -204, -202),
        ("R4p", "R4c", 12, "Axis Bank", 18, "FDR", -400, -40, -40, 325, -39, -38),
    ):
        parent = live(sp(pk, inst, bank, lakh, p_issue, p_mat, type=typ), p_issue + rng.int_between(3, 9))
        renewal(sp(ck, inst, bank, lakh, c_issue, c_mat, type=typ), parent, start, accept)

    # RELEASED (4) incl. A7
    release(live(sp("A7", 5, "Bank of Baroda", 30, -1500, 326, ref="BARB/FDR/2022/12077"), -1494), -50,
            reason="Approval for the additional course withdrawn; the security deposit is no longer required",
            tick=-42, recommend=-40, approve=[(-30, "approver@demo.in")], refund="PFMS/RF/2026/0457")  # fmt: skip
    release(live(sp("X1", 3, "State Bank of India", 12, -700, 30), -694), -170,
            reason="Institution closed the programme; AICTE letter of closure attached",
            tick=-160, recommend=-158, approve=[(-150, "approver@demo.in")], refund="PFMS/RF/2026/0211")  # fmt: skip
    release(live(sp("X2", 6, "Axis Bank", 6, -500, -100, type="SECURITY_DEPOSIT"), -495), -120,
            reason="Obligation fulfilled at the end of the approval period",
            tick=-114, recommend=-113, approve=[(-108, "approver@demo.in")], refund="PFMS/RF/2026/0174")  # fmt: skip
    release(live(sp("X3", 9, "Kotak Mahindra Bank", 40, -900, -400), -894), -398,
            reason="Matured deposit; release requested in place of renewal after the change of site was completed",
            tick=-395, recommend=-394, approve=[(-390, "approver@demo.in")], refund="PFMS/RF/2025/1188")  # fmt: skip

    # RELEASE_REQUESTED (4): A5 (blocked), one at the approver, A9 (second approver), one returned to the institution
    a5 = live(sp("A5", 3, "Punjab National Bank", 15, -750, 345, ref="PUNB/FDR/2024/77015"), -744)
    release(a5, -10, reason="Programme discontinued; deposit to be refunded", tick=-5)
    a5.steps += [
        Step(-2, "bank_update", "A5", {"amount": A5_BANK_AMOUNT_AT_REVERIFY}),
        Step(-2, "verify", "A5", {"officer": officer_for(3)}),
    ]
    release(
        live(sp("RQ1", 1, "HDFC Bank", 26, -540, 190), -534),
        -12,
        reason="Extension of approval not sought for the evening programme",
        tick=-8,
        recommend=-6,
    )
    release(live(sp("A9", 7, "State Bank of India", 120, -400, 330, ref="SBIN/FDR/2025/66120"), -395), -15,
            reason="Corpus fund obligation discharged after accreditation", tick=-11, recommend=-9,
            approve=[(-4, "approver@demo.in")])  # fmt: skip
    rq2 = release(
        live(sp("RQ2", 5, "Union Bank of India", 19, -620, 110), -614),
        -9,
        reason="Intake reduced; excess security deposit to be released",
    )
    rq2.steps.append(Step(-6, "decide", "RQ2", {"user": officer_for(5), "decision": "RETURN",
                                                "remarks": "Attach the compliance certificate signed by the "
                                                           "affiliating university and resubmit."}))  # fmt: skip

    # SUBMITTED (5): two waiting more than 5 days; S3 at the slow bank (Bank of India)
    for key, inst, bank, lakh, issue, mat, submit, typ in (
        ("S1", 2, "Axis Bank", 17, -20, 345, -8, "FDR"),
        ("S2", 6, "State Bank of India", 8, -15, 715, -6, "SECURITY_DEPOSIT"),
        ("S3", 8, "Bank of India", 21, -10, 355, -3, "FDR"),
        ("S4", 11, "Canara Bank", 10, -6, 359, -2, "FDR"),
        ("S5", 12, "HDFC Bank", 33, -4, 726, -1, "FDR"),
    ):
        s = sp(key, inst, bank, lakh, issue, mat, type=typ)
        s.steps += [Step(submit, "create", key)] + [Step(submit, "upload", key, {"docType": d})
                                                    for d in required_docs(s)] + [Step(submit, "submit", key)]  # fmt: skip

    # UNDER_SCRUTINY (7): A3 unverified, two amount mismatches, wrong beneficiary, date inconsistency, not found,
    # bank unavailable
    lodge(sp("A3", 9, "HDFC Bank", 27, -20, 710, ref="HDFC/FD/2026/55210"), -6, officer="officer@demo.in")
    lodge(sp("U1", 4, "State Bank of India", 16.8, -25, 340, claim={"amount": "1800000.00"}), -9, verify_day=-8)
    lodge(sp("U2", 10, "Punjab National Bank", 4.5, -18, 347, claim={"amount": "4500000.00"}), -4, verify_day=-3)
    lodge(sp("U3", 6, "Bank of Baroda", 12, -30, 335, claim={"beneficiary": "PRINCIPAL, KONKAN COLLEGE"}), -7,
          verify_day=-6)  # fmt: skip
    lodge(sp("U4", 3, "Canara Bank", 23, -27, 138, claim={"maturity": 156}), -12, verify_day=-11)
    lodge(sp("U5", 7, "Union Bank of India", 31, -16, 349, claim={"transpose": True}), -5, verify_day=-4)
    u6 = sp("U6", 5, "Indian Overseas Bank", 10, -14, 351)
    lodge(u6, -5, verify_day=-3)
    u6.steps.append(Step(-3, "observe", "U6", {"officer": officer_for(5), "severity": "INFO", "visible": False,
                                               "text": "Bank API unavailable; confirmation requested from the branch "
                                                       "by e-mail."}))  # fmt: skip

    # RETURNED (2): amount mismatch; missing lien letter
    t1 = sp("T1", 1, "ICICI Bank", 12, -22, 343, claim={"amount": "2100000.00"})
    lodge(t1, -14, verify_day=-13)
    t1.steps.append(Step(-12, "return", "T1", {"officer": officer_for(1),
                                               "reason": "Amount does not match the bank record (the bank confirms "
                                                         "₹12,00,000). Correct the amount and resubmit."}))  # fmt: skip
    t2 = sp("T2", 11, "State Bank of India", 15, -19, 711, lien=False, claim={"lien": False})
    lodge(t2, -11, verify_day=-10)
    t2.steps += [
        Step(-10, "observe", "T2", {"officer": officer_for(11), "severity": "BLOCKING", "visible": True,
                                    "text": "Lien letter in favour of AICTE is not on file and the bank shows no lien."}),
        Step(-9, "return", "T2", {"officer": officer_for(11),
                                  "reason": "Get the lien marked in favour of AICTE and upload the bank's lien letter."}),
    ]  # fmt: skip

    # DRAFT (2): one nearly complete (bank letter missing), one empty
    d1 = sp("D1", 2, "Axis Bank", 14, -5, 360, bank_record=False)
    d1.steps += [Step(-2, "create", "D1"), Step(-2, "upload", "D1", {"docType": "FDR_COPY"})]
    d2 = sp("D2", 9, "State Bank of India", 0, 0, 0, bank_record=False)
    d2.steps.append(Step(-1, "create", "D2", {"empty": True}))

    for s in specs:
        if s.ref is None:
            s.ref = reference(s, d0, rng)
    return specs


def reference(s: Spec, d0: str, rng: Mulberry32) -> str:
    """Bank-style reference whose year is the issue date's year (the seed spec's anchors keep their fixed ones)."""
    code, kind = BANK_CODES[s.bank]
    if s.type == "SECURITY_DEPOSIT":
        kind = "SD"
    serial = s.serial if s.serial is not None else rng.int_between(1000, 99999)
    return f"{code}/{kind}/{clock.add_days(d0, s.issue)[:4]}/{serial:05d}"
