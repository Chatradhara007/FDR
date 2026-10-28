"""Writes the demo-video sample PDFs to samples/video/<reference>/ (FDR copy and bank letter per deposit).

Same layout and text as the seed's sample PDFs (backend/app/seed/pdf.py), so the PDF text cross-check reads them.
The bank's records for these deposits are in mock-bank/mock_bank/video_records.py; the PDFs and the form carry the
claimed values below, which differ from the bank's for 09002 (amount) and 09003 (maturity date).
Run: node scripts/py.mjs --cwd backend ../scripts/gen_video_samples.py
"""

from __future__ import annotations

from pathlib import Path

from app.seed.base import INSTITUTIONS
from app.seed.pdf import sample_document
from app.seed.replay import document_rows

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "samples" / "video"
NOTE = "We confirm the above deposit is held with lien in favour of AICTE."

# What the institution types and what its PDFs show (all four claim the same values).
CLAIMS: list[tuple[str, str, str]] = [
    ("SBIN/FDR/2026/09001", "State Bank of India", "Begumpet"),
    ("SBIN/FDR/2026/09002", "State Bank of India", "Begumpet"),
    ("SBIN/FDR/2026/09003", "State Bank of India", "Begumpet"),
    ("SBIN/FDR/2026/09004", "Indian Overseas Bank", "Anna Salai"),
    ("SBIN/FDR/2026/09005", "State Bank of India", "Begumpet"),
    ("SBIN/FDR/2026/09006", "State Bank of India", "Begumpet"),
    ("SBIN/FDR/2026/09007", "State Bank of India", "Begumpet"),
    ("SBIN/FDR/2026/09008", "Indian Overseas Bank", "Anna Salai"),
]


def values(ref: str, branch: str) -> dict[str, object]:
    return {
        "referenceNo": ref, "branch": branch, "amount": "2500000.00", "issueDate": "2026-09-15",
        "maturityDate": "2029-09-15", "beneficiaryName": "MEMBER SECRETARY AICTE", "lienMarked": True,
    }  # fmt: skip


def main() -> None:
    institution = INSTITUTIONS["inst1"]["name"]
    for ref, bank, branch in CLAIMS:
        folder = OUT / ref.replace("/", "-")
        folder.mkdir(parents=True, exist_ok=True)
        rows = document_rows(values(ref, branch))
        short = ref.rsplit("/", 1)[1]
        (folder / f"{short}-fdr-copy.pdf").write_bytes(sample_document("FDR_COPY", rows, institution, bank))
        (folder / f"{short}-bank-letter.pdf").write_bytes(sample_document("BANK_LETTER", rows, institution, bank, NOTE))
        print(f"wrote {folder.relative_to(ROOT)}")
    # 09002 / 09006 after the officer returns them: the institution re-uploads documents showing the bank's amount.
    for short in ("09002", "09006"):
        folder = OUT / f"SBIN-FDR-2026-{short}"
        rows = document_rows({**values(f"SBIN/FDR/2026/{short}", "Begumpet"), "amount": "2400000.00"})
        bank = "State Bank of India"
        (folder / f"{short}-corrected-fdr-copy.pdf").write_bytes(sample_document("FDR_COPY", rows, institution, bank))
        (folder / f"{short}-corrected-bank-letter.pdf").write_bytes(
            sample_document("BANK_LETTER", rows, institution, bank, NOTE)
        )


if __name__ == "__main__":
    main()
