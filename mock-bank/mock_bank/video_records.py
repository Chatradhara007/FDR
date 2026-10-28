"""Fixed bank records for the demo-video sample deposits (samples/video/<reference>/).

They are not portal instruments: the seed never lodges them. The bank always knows them, in every mode, so a deposit
typed from the sample PDFs never comes back "no record at bank". They sit beside the loaded records (POST /records/load
and /reload replace only those) and are not listed by GET /records, so the seed's bank data is unchanged.
"""

from __future__ import annotations

AICTE = "MEMBER SECRETARY AICTE"
LIEN_HOLDER = "Member Secretary, AICTE"


def _record(ref: str, bank: str = "State Bank of India", amount: str = "2500000.00",
            maturity: str = "2029-09-15") -> dict[str, object]:  # fmt: skip
    return {
        "bank": bank,
        "reference_no": ref,
        "amount": amount,
        "issue_date": "2026-09-15",
        "maturity_date": maturity,
        "beneficiary_name": AICTE,
        "lien_marked": True,
        "lien_in_favour_of": LIEN_HOLDER,
        "status": "LIVE",
    }


VIDEO_RECORDS: list[dict[str, object]] = [
    _record("SBIN/FDR/2026/09001"),  # everything matches
    _record("SBIN/FDR/2026/09002", amount="2400000.00"),  # the form and the PDFs claim 25,00,000
    _record("SBIN/FDR/2026/09003", maturity="2029-03-15"),  # the form and the PDFs say 2029-09-15
    _record("SBIN/FDR/2026/09004", bank="Indian Overseas Bank"),  # the offline-test bank: "Bank unavailable"
    # A second set with the same four cases, for a retake after the first set is lodged.
    _record("SBIN/FDR/2026/09005"),
    _record("SBIN/FDR/2026/09006", amount="2400000.00"),
    _record("SBIN/FDR/2026/09007", maturity="2029-03-15"),
    _record("SBIN/FDR/2026/09008", bank="Indian Overseas Bank"),
]
