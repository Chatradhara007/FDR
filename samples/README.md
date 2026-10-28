# Fresh-submission samples

Bank records the mock bank holds that are **never** portal instruments (also in showcase mode), so a new deposit can be
submitted and bank-verified live. Defined in `backend/app/seed/dataset.py` (`SAMPLE_RECORDS`); regenerate the PDFs with
`node scripts/py.mjs --cwd backend -m app.seed.samples`. Fixed dates, beneficiary MEMBER SECRETARY AICTE, lien marked in
favour of Member Secretary, AICTE.

| Key | Submit as | Reference | Bank / branch | Bank amount | PDFs print | Issue → maturity | Officer sees |
|---|---|---|---|---|---|---|---|
| S1 | inst2@demo.in | CNRB/FD/2026/52018 | Canara Bank, Rajahmundry Main | ₹15,00,000 | same | 2026-09-15 → 2027-09-15 | CONFIRMED |
| S2 | inst3@demo.in | BARB/FDR/2026/31406 | Bank of Baroda, Mysuru City | ₹10,00,000 | same | 2026-08-20 → 2028-08-20 | CONFIRMED |
| S3 | inst5@demo.in | HDFC/FD/2026/77215 | HDFC Bank, Ahmedabad Navrangpura | ₹25,00,000 | same | 2026-10-01 → 2027-10-01 | CONFIRMED |
| S4 | inst9@demo.in | PUNB/FDR/2026/18834 | Punjab National Bank, Connaught Place | ₹27,50,000 | ₹30,00,000 | 2026-09-01 → 2027-12-01 | MISMATCH (amount) |

`new-deposit/`: A1-style set for `SBIN/FDR/2026/00845` (not held by the mock bank; dated for 2026-10-28).
