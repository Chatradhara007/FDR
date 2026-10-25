# Phase 09 — Demo dataset, demo tools, end-to-end rehearsal and polish

**Goal:** a realistic dataset with history, a one-click reset, and a demo that runs flawlessly from
the script. Nothing new in the domain — this phase makes everything already built *demonstrable*.

Run with: `/phase 09`

## 9.1 Seed engine — timeline replay (`backend/src/seed/`)

The dataset is specified in `docs/seed-spec.md`. Build it **through the real services**, not raw
inserts, so events, the hash chain, provenance, verifications, alerts and metrics are all authentic:

1. Truncate all tables (except `schema_migrations`), insert institutions, users (bcrypt `Demo@123`)
   and default rules.
2. Generate the bank records (true values) and load them into the mock bank (`POST /records/load`).
   For "tampered" cases the institution's claim differs from the bank record.
3. Each seed instrument has a **script**: a list of `{ day, action, args }` where `day` is relative to
   the demo date D0 (= the real `today` at seed time, e.g. `-180`), and actions are the same service
   calls the UI makes: `create`, `upload` (generated sample PDFs), `submit`, `claim`, `verify`,
   `checkDocument`, `observe`, `return`, `edit`, `resubmit`, `accept`, `renew`, `requestRelease`,
   `tickCondition`, `recommend`, `decide`.
4. Replay: walk days from the earliest script day to D0. For each day with actions or every 5th day,
   `clock.setSimulated(day)`, run that day's actions in order, then run `evaluate(day)`. This gives
   real reminder/escalation history (alerts created on the right dates, escalations aged correctly).
5. Finish with `clock.setSimulated(D0)` and a final `evaluate(D0)` — the demo starts in SIMULATED mode
   on today's date so the presenter can jump forward. (Document how to switch to REAL.)
6. Use a seeded PRNG (`seedrandom`-style, implement a tiny mulberry32) so runs are reproducible.
7. Sample documents: generate small valid PDFs (pdf-lib) that look like an FDR receipt / bank letter /
   deposit confirmation with the instrument's values printed (synthetic bank letterhead "Demo Bank
   Letter — synthetic data"). Also write a few into `docs/demo-files/` for the live submission step
   (FDR copy + bank letter for the demo anchor A1).

`npm run seed` runs it from the CLI; `POST /demo/reset` (admin, DEMO_MODE) runs the same function and
returns `{ instruments, events, alerts, durationMs }`. Target: under 15 s.

## 9.2 Demo tools (`/admin/demo`, admin, DEMO_MODE only)

- **Reset demo data** (confirm dialog) → `/demo/reset`.
- **Jump presets** — "+7 days", "+30 days", "+45 days", "To maturity of anchor A2"; same as the clock widget.
- **Bank correction** — `POST /demo/bank-correction {bank, referenceNo, fields}` updates one mock bank
  record (simulates the bank correcting its record after the institution's representation); used in
  demo step 7. Writes `DEMO_BANK_CORRECTION`.
- **Tamper with audit log** — `/demo/tamper` (Phase 8) with an explanation of what it does.
- **Anchor list** — the demo anchors (A1…A8 from the seed spec) with links to their passports and the
  user to sign in as for each step.
- A small "Demo mode" ribbon in the header whenever DEMO_MODE is on.

## 9.3 End-to-end rehearsal

- Write `backend/tests/phase09.demo.test.ts`: runs the seed, then performs every step of
  `docs/demo-script.md` through the API as the right users, asserting the outcomes the presenter will
  point at (mismatch on amount, alerts after the jump, escalation to approver, renewal chain gap,
  release blocked then approved, integrity verified then failed after tamper).
- **Should:** a Playwright script (`e2e/demo.spec.ts`, root workspace `e2e`) that clicks through the
  same script in the browser and saves screenshots to `e2e/screenshots/` (useful for the deck).
- Run the full stack with `docker compose up --build` from a clean clone and confirm the demo works;
  note any manual steps in README.

## 9.4 Polish checklist (go screen by screen)

- Every page: loading skeletons, empty states with a helpful line, error toasts with the server message.
- Every table: sensible default sort, sticky header, numbers right-aligned in `tabular-nums`, ₹ formatting.
- Status chips, verification chips, trust badges consistent everywhere (same component).
- Header clock badge always visible; after a clock change every visible query refetches.
- Breadcrumbs or back links on detail pages; passport reachable from every reference number.
- Consistent wording: "Bank-confirmed", "Claimed by institution", "Document-checked", "Discrepancy",
  "Competent authority".
- Responsive down to 1280 px wide (projector) — nothing overflows horizontally.
- Favicon and title "FDR Portal — AICTE"; login page with a one-line product description and a
  "Synthetic demo data" note.
- Remove console errors and React key warnings.

## 9.5 README for judges/teammates

Update root `README.md`: what it is (3 lines), how to run (`docker compose up --build`, or dev
commands), demo users table, the demo script link, architecture diagram (Mermaid), requirement map
link (`docs/requirements-map.md`), and the honesty notes (mock bank is a stand-in; metrics simulated).

## Acceptance checks

1. `npm run seed` produces exactly the distribution in `docs/seed-spec.md` (test asserts counts per status/verification state) in under 15 s, twice in a row with identical results.
2. After seeding, `/audit/integrity` is ok and every instrument's passport timeline is chronological.
3. The demo test (9.3) passes every step.
4. `/demo/*` routes 404 when DEMO_MODE is off.
5. Clean clone → `docker compose up --build` → demo works (manual; record in PROGRESS.md).
6. Polish checklist done (manual; tick items in PROGRESS.md).
