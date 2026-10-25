# Phase 07 — Dashboard, "my day" queue, registers, reports and improvement metrics

**Goal:** management overview and a daily worklist for officials. Covers requirement #8
(dashboard and management reports), the institution-wise view of requirement #1, the strategy's
"risk-ranked my-day queue", and the statement's "demonstrate measurable improvements".
(This phase is not in the build guide PDF; it is specified from the strategy report.)

Run with: `/phase 07`

## 7.1 Migration `007_reporting.sql`

Rules:
```jsonc
// key 'risk_weights'
{ "amount": 0.30, "urgency": 0.30, "verification": 0.20, "discrepancy": 0.15, "escalation": 0.05,
  "amountCap": "10000000.00", "urgencyHorizonDays": 90 }
// key 'improvement_baseline'  (assumptions for the manual process — shown labelled as illustrative)
{ "manualStepsPerCase": 14, "portalStepsPerCase": 5,
  "manualVerificationDays": 21, "manualLapseDetectionDays": 45, "manualCaughtBeforeExpiryPct": 40,
  "note": "Assumed manual process: spreadsheets, letters to banks, email reminders. Illustrative figures." }
```
Add indexes only if a query plan needs them (e.g. `alerts (instrument_id, status)`).

## 7.2 Dashboard — `GET /dashboard?region=&type=` (officer, approver, admin, auditor)

One response with:
- `kpis`: live instruments (ACTIVE, EXPIRING, MATURED, LAPSED, RELEASE_REQUESTED) count and total
  amount; amount bank-confirmed (% of live amount with `verification_state = CONFIRMED`); pending
  scrutiny (SUBMITTED + UNDER_SCRUTINY); open discrepancies; open escalations (level ≥ 2).
- `byStatus`: count and amount per status — Active, Expiring, Matured, Lapsed, Renewed, Release
  requested, Released, Pending scrutiny, Returned (the statement names "active, expiring, matured,
  renewed, released and pending" — all must be visible).
- `verification`: counts per `verification_state` for non-draft instruments, plus `acceptedWithOverride`.
- `maturityBuckets`: overdue (MATURED/LAPSED), 0–30, 31–60, 61–90 days — count and amount.
- `maturityByMonth`: next 12 months, amount maturing per month (from `clock.today()`).
- `byRegion`: count, amount, atRisk count (EXPIRING/MATURED/LAPSED or MISMATCH or open discrepancy).
- `byBank`: count, verified count, mismatch rate (discrepancies opened / verifications), unavailable count.
- `alerts`: open counts by kind and by level.
- `asOf`: the app-clock date (dashboard must change visibly when the clock is advanced).

## 7.3 "My day" — `GET /myday` (officer, approver, admin)

A ranked worklist of what *this* user should act on, scored by the `risk_weights` rule.

Candidates:
- **officer:** SUBMITTED (unassigned) and UNDER_SCRUTINY assigned to me; live instruments with open
  alerts addressed to officers (me or pool); release requests in PENDING_CONDITIONS.
- **approver:** release requests whose current level is approver (excluding ones the user already
  acted on — D27); instruments with open alerts escalated to approver.
- **admin:** anything with an open level-3 alert.

Score (each component 0..1, `score = round(100 × Σ weight × component)`):
- `amount = min(1, amount / amountCap)`
- `urgency = daysLeft <= 0 ? 1 : max(0, 1 − daysLeft / urgencyHorizonDays)`; for items in scrutiny use
  `min(1, ageingDays / 10)` instead.
- `verification`: CONFIRMED or override → 0, PENDING 0.6, UNVERIFIED 0.7, UNAVAILABLE 0.8, MISMATCH 1.
- `discrepancy = open discrepancies > 0 ? 1 : 0`
- `escalation = worstOpenAlertLevel / 3`

Each item: `{ kind: 'instrument'|'release', id, instrumentId, title, institution, amount, score,
reasons: string[], nextAction: string, link }`. Reasons are short and concrete —
`"₹1.2 Cr at stake"`, `"Matures in 6 days"`, `"Bank mismatch: amount"`, `"Escalated to approver (L2)"`,
`"Waiting 8 days for verification"`. `nextAction` examples: "Verify with bank", "Resolve discrepancy
on beneficiary name", "Chase renewal — lapses in 12 days", "Recommend or return release request",
"Decide release request". Return the top 50, highest score first; ties by days left.

## 7.4 Registers and institution-wise view

- `GET /institutions` (internal roles): list with counts and amounts by status, open problems; filter
  by region/state, search.
- `GET /institutions/:id` (internal roles; institution users only their own): profile + all its
  instruments + open alerts + release requests. This is the "institution-wise" centralised repository.
- Instrument register: the Phase 2 `GET /instruments` with all filters is reused.

## 7.5 Reports — `GET /reports/:preset?…&format=json|csv` (officer, approver, admin, auditor)

Presets (each a parameterised query reusing repository functions):
- `register` — full instrument register with filters (status, type, region, bank, institution, maturity range).
- `expiring` — live instruments maturing within `days` (default 90).
- `pending-verification` — not CONFIRMED, in scrutiny or live, with ageing.
- `discrepancies` — open (or all) discrepancies with claimed vs confirmed values and age.
- `lapsed` — LAPSED or MATURED without renewal, with days overdue.
- `releases` — release requests in a date range with status, approvals and refund reference.
- `institution-summary` — per institution: counts/amounts per status, open problems.
CSV: UTF-8 with BOM (Excel-friendly), ISO dates, plain amounts, header row with human labels,
filename `fdr-<preset>-<asOf>.csv`. Every export writes `REPORT_EXPORTED` (who, preset, filters).

## 7.6 Improvement metrics — `GET /metrics/improvement`

Computed from the portal's own data (events use the app clock), compared with `improvement_baseline`:
- **Submission → verification outcome**: median hours from `INSTRUMENT_SUBMITTED` to the first
  conclusive `VERIFICATION_RESULT` (CONFIRMED/MISMATCH/NOT_FOUND); vs `manualVerificationDays`.
- **Lapses caught before expiry**: of instruments that reached MATURED, % that had a maturity reminder
  created ≥ 30 days before maturity; vs `manualCaughtBeforeExpiryPct`.
- **Days to detect a lapsing instrument**: portal = days between maturity and the first
  OVERDUE_RENEWAL alert (0 when the job runs daily); vs `manualLapseDetectionDays`.
- **Problems detected automatically**: discrepancies raised from bank responses + gaps from `findGaps`
  across live instruments (missing docs, unconfirmed fields, lien not marked).
- **Steps per case**: `portalStepsPerCase` vs `manualStepsPerCase` (config).
- **Visibility of pending cases**: count of pending items visible on the dashboard vs "not tracked".
Response includes `label: "Simulated on demo data — illustrative, not real-world claims"` (D26).

## 7.7 Frontend

- **Dashboard** `/dashboard` (officer, approver, admin, auditor; default home for approver/admin/auditor):
  KPI tiles (amount in ₹ Cr, % bank-confirmed), status breakdown (horizontal bars with counts and
  amounts — every named status visible), maturity buckets, 12-month maturity bar chart, verification
  donut/bars, region table with at-risk counts, bank table with mismatch rate, open alerts by level.
  Region/type filters. Every tile links to the filtered register/report. `asOf` shown prominently.
  Use recharts; consistent semantic colours; numbers in `tabular-nums`; readable on a projector.
- **My day** `/officer` (officer home) and section on `/approver`: ranked cards — score pill, title
  ("CNRB-0042 · Vasavi College"), amount, reason chips, next action button that deep-links. A small
  "Why this order?" popover explains the weights (from the rule). The order visibly changes after a
  clock jump — this is a demo moment.
- **Register** `/register` (internal roles): all instruments, filters, sort, paging, CSV export.
- **Institutions** `/institutions` and profile `/institutions/:id`.
- **Reports** `/reports`: preset picker, filters, preview table, Download CSV.
- **Improvement** panel `/reports/improvement`: before/after cards (manual vs portal) with the
  "Simulated on demo data" label on every card.

## Acceptance checks

1. Dashboard counts per status equal direct SQL counts on the same data; every statement-named status (active, expiring, matured, renewed, released, pending) is present in the response.
2. After `POST /clock/advance {days: 60}`, dashboard `asOf`, maturity buckets and status counts change accordingly.
3. My day: an instrument with an open discrepancy, high amount and 5 days to maturity ranks above a confirmed low-amount one maturing in 80 days; changing `risk_weights` changes the order; every item has reasons and a next action.
4. Approver's my-day excludes release requests they already acted on.
5. Each report preset returns JSON and CSV; CSV has a BOM and header row; export writes `REPORT_EXPORTED`; institution users cannot call reports (403).
6. Institution profile shows all its instruments; an institution user can open only their own (404 otherwise).
7. Improvement metrics compute without errors on empty and seeded data and carry the simulated label.
8. UI: dashboard readable at 1366×768 and on a projector; tiles link to filtered lists; my-day reorders after a clock jump.
