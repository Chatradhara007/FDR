# Demo dataset specification

Synthetic data only. All days are relative to **D0** = the real date on which the seed runs; the
seed leaves the app clock SIMULATED at D0 (Phase 9, timeline replay). Amounts are realistic for AICTE
security deposits/FDRs (₹5 L – ₹2.5 Cr). Every record is built by replaying service calls, so its
history is genuine.

## Institutions (12) and users

| # | Institution (synthetic) | Region | State | User |
|---|---|---|---|---|
| 1 | Vasavi Institute of Engineering & Technology, Hyderabad | South-Central | Telangana | inst1@demo.in |
| 2 | Godavari College of Engineering, Rajahmundry | Southern | Andhra Pradesh | inst2@demo.in |
| 3 | Kaveri Institute of Technology, Mysuru | South-West | Karnataka | inst3@demo.in |
| 4 | Narmada Polytechnic, Jabalpur | Central | Madhya Pradesh | inst4@demo.in |
| 5 | Sabarmati School of Management, Ahmedabad | Western | Gujarat | inst5@demo.in |
| 6 | Konkan College of Pharmacy, Ratnagiri | Western | Maharashtra | inst6@demo.in |
| 7 | Brahmaputra Institute of Technology, Guwahati | Eastern | Assam | inst7@demo.in |
| 8 | Hooghly Engineering College, Howrah | Eastern | West Bengal | inst8@demo.in |
| 9 | Yamuna Institute of Architecture, Delhi | Northern | Delhi | inst9@demo.in |
| 10 | Sutlej College of Engineering, Ludhiana | North-West | Punjab | inst10@demo.in |
| 11 | Ganga Technical Campus, Varanasi | Northern | Uttar Pradesh | inst11@demo.in |
| 12 | Periyar Engineering College, Salem | Southern | Tamil Nadu | inst12@demo.in |

Internal users (password for everyone: `Demo@123`):
`officer@demo.in` (Scrutiny Officer, South-Central & Southern), `officer2@demo.in` (Scrutiny Officer,
Northern & Western), `approver@demo.in` (Director, Regulation Bureau — competent authority),
`approver2@demo.in` (Deputy Secretary — second approver for > ₹50 L), `admin@demo.in` (Portal
Administrator), `auditor@demo.in` (Internal Audit, read-only).

## Distribution — 60 instruments (assert these counts in the Phase 9 test)

| Status | Count | Notes |
|---|---|---|
| ACTIVE | 16 | 14 bank-confirmed (incl. A2 and A8c); 2 accepted with override (bank unavailable at the time) |
| EXPIRING | 8 | maturities spread 8–88 days out; includes anchor A4 |
| MATURED | 3 | inside the 15-day grace period, OVERDUE_RENEWAL alerts open |
| LAPSED | 3 | includes A6; OVERDUE_RENEWAL escalated |
| RENEWED | 6 | parents in renewal chains (incl. A8a, A8b) |
| RELEASED | 4 | includes A7, full history, refund references |
| RELEASE_REQUESTED | 4 | A5 (blocked), one PENDING_APPROVAL at approver, A9 (> ₹50 L, at second approver), one request RETURNED to institution |
| SUBMITTED | 5 | 2 waiting > 5 days (PENDING_VERIFICATION alerts) |
| UNDER_SCRUTINY | 7 | A3 (unverified), amount mismatch ×2, wrong beneficiary name, date inconsistency, not found at bank, bank unavailable |
| RETURNED | 2 | one for amount mismatch (institution must correct), one for missing lien letter |
| DRAFT | 2 | one nearly complete, one empty |
| **Total** | **60** | |

Advisory flags (post-Phase-09): the dataset carries exactly two deliberate ones and nothing else: F2 `HDFC/FD/2026/32652`
(₹80 L, far above what Institution 3 had lodged before: "high amount") and S4 `CNRB/FD/2026/36859` (beneficiary written
"MEMBER SECRETARY AICTI": "near-miss beneficiary"). A1 carries none. Sample PDFs: A1's FDR copy prints the claimed ₹25,00,000
(the text cross-check matches; only the bank reveals the mismatch), an extra "FDR copy with a different amount" prints the bank's
₹20,00,000, and the bank letter shows the bank's values.

A2 is ACTIVE at D0 (97 days to maturity) and only becomes EXPIRING during the demo jump.

Verification state targets: CONFIRMED for all live instruments except the 2 overrides (UNAVAILABLE)
and A5 (MISMATCH from re-verification). In scrutiny: as listed above. At least one SLOW-bank
(Bank of India) instrument in scrutiny shows PENDING if verified during the demo.

Bank spread: every bank in `shared/banks.ts` appears; Indian Overseas Bank is the configured offline
bank; Bank of India the slow one.

## Demo anchors (stable references — the demo script uses these)

| Anchor | Reference | Institution | State at D0 | Purpose |
|---|---|---|---|---|
| A1 | `SBIN/FDR/2026/00731` | 1 | **No instrument yet** — only the bank record exists: SBI, ₹20,00,000.00, issued D0−10, matures D0+355, beneficiary "MEMBER SECRETARY AICTE", lien in favour of AICTE | Live submission in demo step 1; presenter types ₹25,00,000 → mismatch caught in step 2. Sample PDFs in `docs/demo-files/`. |
| A2 | `CNRB/FD/2025/11842` | 2 | ACTIVE, CONFIRMED, ₹40 L, matures D0+97 | +7 day jump → becomes EXPIRING, 90-day reminders fire |
| A3 | `HDFC/FD/2026/55210` | 9 | UNDER_SCRUTINY, UNVERIFIED, submitted D0−6, claimed by officer@demo.in; PENDING_VERIFICATION alert created D0−1 (L1) | +7 jump → escalates to approver (L2) |
| A4 | `UBIN/FDR/2025/30418` | 1 | EXPIRING, CONFIRMED, ₹35 L, matures D0+37; bank record for its replacement `UBIN/FDR/2026/40977` (₹35 L, issued D0+5, matures D0+400) pre-loaded | Renewal in demo step 6 |
| A5 | `PUNB/FDR/2024/77015` | 3 | RELEASE_REQUESTED; request PENDING_CONDITIONS with release documents attached and both manual conditions ticked; re-verification at D0−2 opened a discrepancy on `amount` (bank shows ₹14,50,000 vs claimed ₹15,00,000) | Release blocked in step 7; bank correction → re-verify → unblocked → recommend → approve |
| A6 | `ICIC/FD/2023/09981` | 10 | LAPSED (matured D0−35, grace over at D0−20), OVERDUE_RENEWAL escalated up the ladder to admin (L3) | Shows a lapse flagged and escalated |
| A7 | `BARB/FDR/2022/12077` | 5 | RELEASED at D0−30 with refund reference `PFMS/RF/2026/0457` | Complete history example |
| A8a → A8b → A8c | `KKBK/FD/2021/00412` → `KKBK/FD/2023/00977` → `KKBK/FD/2025/01563` | 11 | RENEWED → RENEWED → ACTIVE | Chain view: 12-day **gap** between A8a and A8b (a late renewal), 5-day **overlap** between A8b and A8c |
| A9 | `SBIN/FDR/2025/66120` | 7 | RELEASE_REQUESTED, ₹1.2 Cr, recommended and approved at level 2 by approver@demo.in, waiting for approver2@demo.in | Two-approver chain for > ₹50 L |

## Tricky cases the strategy asks for

- Amount mismatch (A1 live, plus two in scrutiny).
- Wrong beneficiary name (claimed "PRINCIPAL, KONKAN COLLEGE" vs bank "MEMBER SECRETARY AICTE").
- Date inconsistency (claimed maturity 2027-03-31 vs bank 2027-03-13).
- Not found at bank (reference typo).
- A renewal that arrives late (A8 gap) — with the coverage-gap CONCERN observation.
- A release request blocked by an open discrepancy (A5).
- An instrument accepted with override because the bank was unavailable.

## Mock bank records

For every non-draft instrument (and A1, A4's replacement) the seed writes the bank's true record.
Records for mismatch cases hold the bank's value (the institution's claim differs). The NOT_FOUND
case has no record. Load with `POST /records/load` at the start of the seed and again on demo reset.
