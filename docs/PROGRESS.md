# Build progress

Claude Code updates this file at the end of every phase. Read it first in every session.

| Phase | Title | Status | Commit | Notes |
|---|---|---|---|---|
| 00 | Environment and skeleton | done with known issues | (this commit) | AC1 (docker compose) not run: no Docker in build sandbox |
| 01 | Foundation | done | (this commit) | All 11 checks pass (AC11 run in headless Chromium) |
| 02 | Submission and documents | done | (this commit) | All 11 checks pass (AC11 run in headless Chromium) |
| — | Stack migration: backend + mock bank → Python (D28) | done | (this commit) | Phases 00–02 ported 1:1; 100 backend pytest + 1 mock-bank + 7 shared vitest; UI checks re-run |
| 03 | Scrutiny, mock bank, trust tiers | done | (this commit) | All 15 checks pass (AC15 run in headless Chromium) |
| 04 | Rules engine, alerts, escalation | not started | | |
| 05 | Renewal chain and passport | not started | | |
| 06 | Release workflow | not started | | |
| 07 | Dashboard, my day, reports, metrics | not started | | |
| 08 | Admin, audit integrity, security | not started | | |
| 09 | Seed, demo tools, rehearsal, polish | not started | | |

Status values: `not started` · `in progress` · `done` · `done with known issues`.

## Stack migration to Python (after Phase 02, DECISIONS D28)

Backend and mock bank rewritten in Python 3.12 (FastAPI, psycopg 3, pydantic v2, bcrypt, PyJWT,
python-multipart, `filetype`, APScheduler, pytest, ruff, mypy --strict). Frontend unchanged (no source
edits; same API paths, JSON shapes, status codes and `{ code, message, details }` errors). The SQL
migrations moved with `git mv` to `backend/app/db/migrations/`, contents unchanged.

File mapping (TypeScript removed after every ported test passed):

| Was | Now |
|---|---|
| `backend/src/{app,server,config}.ts` | `backend/app/{main,server,config}.py` |
| `backend/src/db/{pool,migrate}.ts` | `backend/app/db/{pool,migrate}.py` (`$1` SQL kept; translated for psycopg) |
| `backend/src/domain/*.ts` | `backend/app/domain/{clock,audit,errors,access,token,state_machine}.py` + `canonical_json.py`, `normalize.py`, `fields.py`, `passwords.py` |
| `backend/src/middleware/*.ts` | `backend/app/middleware/{auth,errors,validate,responses,rate_limit}.py` |
| `backend/src/repositories/*Repo.ts` | `backend/app/repositories/*_repo.py` |
| `backend/src/services/*.ts` | `backend/app/services/{auth,clock,document,health,instrument}_service.py`, `storage.py`, `submission.py` |
| `backend/src/routes/*.ts` | `backend/app/routes/*.py` |
| `backend/src/seed/*.ts` | `backend/app/seed/{base,__main__}.py` |
| `shared/src/{enums,transitions,fields,banks,ruleDefaults,eventLabels}.ts` | `shared/constants.json` (+ `backend/app/shared_constants.py`, `shared/src/constants.ts`, generated `constants.gen.ts`) |
| `shared/src/{schemas,canonicalJson,normalize,fields}.ts` logic | `backend/app/{schemas.py,domain/canonical_json.py,domain/normalize.py,domain/fields.py}`; TS keeps only `normAmount` (live preview), `format.ts`, API types |
| `mock-bank/src/index.ts` | `mock-bank/mock_bank/main.py` |

Test mapping: `phase00.health` → `test_phase00_health.py`; `phase00.infra` → `test_phase00_infra.py`;
`phase01.{auth,access,clock,audit,stateMachine,sourceGuard}` → `test_phase01_{auth,access,clock,audit,state_machine,source_guard}.py`;
`phase02.{submission,documents,list}` → `test_phase02_{submission,documents,list}.py`; shared
`canonicalJson/normalize/schemas/transitions` tests → `test_canonical_json.py`, `test_normalize.py`,
`test_schemas.py`, `test_shared_constants.py`. New: `test_hash_compat.py` (golden vectors generated from
the TypeScript `canonicalJson`/`eventHash` before deletion, so chains written by the old backend still
verify) and `test_shared_constants.py` (SQL enums == JSON, generated TS types up to date).
`shared/tests/{format,normalize}.test.ts` stay in vitest (UI code).

Deviations / choices in the port:
- Hash compatibility: `canonical_json` reproduces `JSON.stringify` exactly, including JS number
  formatting and JS key order (integer-like keys first). Found and fixed thanks to the golden vectors.
  `clock.now()` is truncated to milliseconds (as a JS `Date` was) so stored and hashed times agree.
- JSON responses are serialised by `ApiJSONResponse` (timestamps `…sss Z`, like `res.json`). FastAPI's
  docs/OpenAPI routes are disabled so unknown paths stay 404; 405 (wrong method) also maps to 404 as in Express.
- Validation reports one message per failing field (zod could list two for one field). Absent required
  fields use the friendly messages (`Enter your password`, `version is required`, …).
- Multipart filenames: browsers/httpx send `"` as `%22` (WHATWG); the upload route decodes `%22`, `%0D`,
  `%0A` before sanitising, so `My "FDR".pdf` is shown as `My FDR.pdf` as before.
- bcrypt: passwords are truncated to 72 bytes before hashing/checking (bcryptjs did this silently; the
  Python library refuses longer input). Existing `$2a$` hashes verify unchanged.
- IST is a fixed +05:30 offset (no tzdata needed in `python:3.12-slim`; India has no DST).
- The login rate limiter is an in-process fixed window (5/min per IP+email) with draft-7 `RateLimit` headers.
- `Literal` types in `shared_constants.py` repeat the JSON values for mypy; an import-time check fails
  startup if they ever disagree.
- Added libraries: `python-dotenv` (repo-root `.env`, never overriding real env vars), `httpx` (health
  ping, TestClient). APScheduler is installed but unused until Phase 04.
- `npm run test` = pytest (backend, mock bank) + the small shared vitest suite. `npm run typecheck` =
  ruff (lint + format check) + mypy --strict + `tsc` for shared and frontend.
- Windows support (follow-up): every Python npm script runs through `scripts/py.mjs` (Node), which uses
  `.venv/Scripts/python.exe` on win32 and `.venv/bin/python` elsewhere, with tools run as modules
  (`python -m uvicorn|pytest|mypy|ruff`); `--cwd` sets the working directory. `npm run setup:py` creates the
  venv with `py -3.12`, then `py -3`, then `python` on Windows (`python3.12`, `python3`, `python` elsewhere),
  uses the first that is 3.12+, and otherwise exits with install instructions. `npm run dev:backend` is now
  `python -m app.server --migrate-only` (wait for DB + migrate) followed by `python -m uvicorn app.main:app
  --reload`; the mock bank runs under `python -m uvicorn` on :4000. `requires-python` relaxed to `>=3.12` so a
  3.13 picked by `py -3` can install. Checked here on Linux: fresh-venv setup, the no-Python and no-venv
  messages, `npm run test`, `npm run typecheck`, `npm run seed`, `npm run dev`. Not run on Windows (no
  Windows machine in the sandbox).
- Root `package.json` workspaces are now `shared`, `frontend`; `package-lock.json` regenerated.

## Endpoints added

(append per phase)

**Phase 00**
- `GET /api/v1/health` (public) → `{ status, db, mockBank, time }`
- Mock bank: `GET /health` → `{ status: 'ok' }`
- Any unknown route → 404 `{ code: 'NOT_FOUND', message, details: null }`

**Phase 01** (all under `/api/v1`)
- `POST /auth/login` (public, 5/min per IP+email → 429 `RATE_LIMITED`) → `{ token, user }`; bad credentials → 401 `INVALID_CREDENTIALS`
- `GET /auth/me` (all roles)
- `GET /clock` (all roles) → `{ mode, now, today }`
- `POST /clock/advance {days 1..730}`, `POST /clock/set {date}`, `POST /clock/reset` (admin) → `{ mode, now, today, warning? }`
- `GET /instruments/:id` (all roles; institution users get 404 for other institutions)
- `GET /demo/users` (public, only when `DEMO_MODE=true`)

**Phase 02** (all under `/api/v1`)
- `GET /instruments` (all roles, institution-scoped) — filters `status` (repeat, `status[]` or comma list), `type`, `bank`,
  `region`, `institutionId`, `q` (reference / beneficiary / institution name), `maturityFrom`, `maturityTo`; `sort`
  (`maturityDate` default, `amount`, `createdAt`, `updatedAt`, `referenceNo`, `-` prefix for descending); `page`, `pageSize`
  (25, max 100) → `{ items, total, page, pageSize }`; items carry `daysToMaturity` from the app clock
- `POST /instruments` (institution) → 201 DRAFT detail; `PATCH /instruments/:id` (institution, own, DRAFT/RETURNED, `version`
  required → 409 `STALE_VERSION`); `DELETE /instruments/:id` (DRAFT only) → 204
- `GET /instruments/:id` now returns the detail: `documents`, `provenance`, `daysToMaturity`, `requiredDocs`, `missingDocs`,
  `lienRequired`, `institutionName`, `region`
- `POST /instruments/:id/submit` (institution) → 200 detail; 422 `details: { fields, missingDocuments }`; 409
  `INVALID_TRANSITION` / `DUPLICATE_REFERENCE`
- `POST /instruments/:id/documents` (multipart `file` + `docType`) → 201 `{ document, duplicateOf }`; 422
  `UNSUPPORTED_FILE_TYPE` / `FILE_TOO_LARGE`; 409 `INVALID_STATE` outside DRAFT/RETURNED
- `DELETE /instruments/:id/documents/:docId` (soft, D15) → 204
- `GET /instruments/:id/documents/:docId/download` and `/preview` (all roles, scoped; each logs `DOCUMENT_ACCESSED`)
- `GET /meta` (all roles) → banks, doc types, instrument types, regions, `requiredDocs`, `lienRequired`

**Phase 03** (all under `/api/v1`)
- `GET /scrutiny/queue` (officer, approver, admin, auditor) — filters `region`, `bank`, `verificationState`, `assigned`
  (`me`/`unassigned`/`all`), `page`, `pageSize` → `{ items, total, page, pageSize }`; items carry `ageingDays` (app clock),
  `openDiscrepancies`, `assignedOfficerName`
- `GET /instruments/:id/review` (officer, approver, admin, auditor) → `{ instrument, assignedOfficerName, fields, verifications,
  discrepancies, observations, gaps, canAccept, canAcceptWithOverride, acceptBlockers }`
- Officer only (institution → 403): `POST /instruments/:id/claim`, `POST /instruments/:id/verify` → `{ result, verificationId,
  mismatchedFields, retryAfterSeconds, reason?, review }` (409 `INSTRUMENT_CHANGED` when D9 stores a STALE result),
  `POST /instruments/:id/fields/:field/check-document {documentId, note?}` → `{ unchanged, review }`,
  `POST /instruments/:id/observations {text, severity, visibleToInstitution}` (201), `POST /observations/:id/resolve {note}`,
  `POST /instruments/:id/return {reason}`, `POST /instruments/:id/accept {overrideNote?}` (409 `ACCEPT_BLOCKED`,
  `details.reasons`), `POST /discrepancies/:id/resolve {note}`; each returns the review payload
- `GET /instruments` items and `GET /instruments/:id` gain `weakestTier`; the detail gains `returns` (newest first) and
  `observations` (institution users: only those visible to them)
- Mock bank (Python): `POST /verify`, `GET /records`, `POST /records/load {records}`, `POST /reload`, `GET /health`;
  dev data `mock-bank/data/records.example.json` (used until `records.json` is written by a load)

## Pages added

(append per phase)

**Phase 00**
- `/` Home: system status (API, Database, Mock bank: up/down with icon + label)
- `/login` placeholder (real sign-in in Phase 01)
- Shared components in `frontend/src/components/`: Button, Card, Badge, StatusChip, Table, PageHeader,
  EmptyState, Modal, Toast, FieldError, Tabs, Money, DateText, KeyValue, Layout

**Phase 01**
- `/login`: email/password form with per-field errors; demo-mode "Sign in as" buttons (Institution 1, Institution 2,
  Officer, Approver, Admin, Auditor)
- Role homes (placeholders): `/institution`, `/officer`, `/approver`, `/admin`, `/auditor`; `/` redirects by role;
  wrong-role URLs redirect to the user's own home
- Header: user name + role chip, sign out, clock badge (`SIMULATED · 12 Dec 2026` amber / `Today · …`),
  admin clock controls (+1d/+7d/+30d, Set date modal, Reset) with toasts
- New components: `ClockBadge`/`ClockControls`, `SystemStatus` (was the Phase 00 Home page)

**Phase 02**
- `/institution`: tiles (Active, Expiring ≤ 90 d, Returned — needs action, Drafts) and instrument table (reference link,
  type, bank, amount, maturity, days left from the server, status chip, verification chip); RETURNED rows show
  "Action needed — returned by officer"; "New instrument" button
- `/institution/instruments/new` and `/institution/instruments/:id/edit`: 3-step wizard (Details / Documents / Review and
  submit), Save draft on every step, server field errors next to the fields, missing-document checklist, upload with
  progress, duplicate-file warning, stale-version banner with Reload, delete draft (confirm modal), RETURNED banner
- `/institution/instruments/:id`: simple detail page (fields, required documents, "What is proven" table with trust chips,
  documents with preview/download)
- New components: `VerificationChip`, `TrustChip`, `DocumentList`, `DocChecklist`

**Phase 03**
- `/officer/queue` (officer; read-only for approver/admin/auditor): filters (region, bank, verification, assigned), columns
  institution, reference + status, bank, amount, submitted · ageing (amber > 5 d, red > 10 d, icon + text), verification chip,
  open discrepancies, assigned officer; Claim on unassigned submitted rows. Officer sidebar gains "Scrutiny queue".
- `/officer/review/:id`: header (reference, bank, amount, institution, status, verification, weakest-tier badge); action bar
  (Verify / Re-verify with bank with spinner, PENDING countdown banner, neutral UNAVAILABLE banner, Add observation, Return,
  Accept disabled with the blocker list, Accept with override + warning modal, "the decision is yours" copy); discrepancy
  cards "Institution claimed" vs "Bank confirmed" with Resolve with note / Return; "What is proven" (7 fields, TrustBadge,
  source label); completeness checklist; tabs Documents (preview, per-field "Checked against this document"), Verification
  history (result chip, mismatched fields, raw JSON), Observations (add with severity + visibility, resolve)
- Institution: detail page and wizard show the return reason and observations marked visible
- New components: `TrustBadge` (Claimed outline circle / Document-checked file-check / Bank-confirmed shield-check;
  `TrustChip` is now an alias), `WeakestTierBadge`, `ObservationItem` + `SeverityChip`

## Deviations / choices

(anything that differs from the phase files or DECISIONS.md, with the reason)

**Phase 00**
- `GET /health` `time` and `schema_migrations.applied_at` use wall time: no app clock exists until
  Phase 01. Health is infrastructure; `migrate({ appliedAt })` accepts a value so Phase 01 can pass `clock.now()`.
- Tailwind v4 (`@tailwindcss/vite`), tokens defined once in `frontend/src/index.css` `@theme`.
- Added libraries beyond the listed stack (additions, not substitutions): `cors`, `@fontsource/inter`
  (self-hosted font, no CDN). Express pinned to 4.x, TypeScript to 5.9.
- Formatting helpers (`formatINR`, `formatINRCompact`, `formatDate`) live in `shared/src/format.ts` (pure, tested).
- `StatusChip` keeps a local status union until Phase 01 adds the shared enum.
- Config: backend, mock bank and tests load the repo-root `.env` via `process.loadEnvFile` (never overrides
  real env vars); Vite uses `envDir` = repo root. Tests force `DATABASE_URL = TEST_DATABASE_URL` and refuse
  to run without it.
- Malformed JSON bodies → 422 `VALIDATION_FAILED` (`field: 'body'`).
- `createApp({ mountTestRoutes })` lets tests mount throwaway routes under `/api/v1`.
- Cloud sandbox (no Docker): `scripts/start-pg-sandbox.sh` starts local Postgres 16 on 5432 and writes `.env`.
  `.env.example` / `docker-compose.yml` unchanged (local Docker uses 55432).

**Phase 01**
- Default rules are inserted at the end of `001_init.sql` (no separate `001b`); same values in `shared/src/ruleDefaults.ts`;
  `seedBase()` re-inserts missing ones (`ON CONFLICT DO NOTHING`, never overwrites admin edits).
- Event hash payload includes `instrument_id` (phase file 1.4; D16 updated in Phase 02 to list it). `before`/`after` are
  JSON round-tripped before hashing so the hash matches what JSONB returns; `created_at` hashed as ISO (ms).
- `transition()` raises 409 `STATUS_CHANGED` when the row's status no longer matches (concurrent change).
- `authenticate` now loads the user from the DB on each request (deactivated users are rejected at once);
  `req.user` gains `name`. `signToken` moved to `domain/token.ts` (re-exported from the middleware).
  `phase00.infra.test.ts` updated to use seeded users instead of fake ids (needed by this change).
- Login: unknown emails still run a bcrypt compare (same timing, same 401 body). Rate limit counts every attempt.
  Limiter is created per `createApp()` (tests are isolated).
- `advanceDays` keeps the current time of day; `setSimulated` uses 10:00 IST. `migrate()` stamps `applied_at` from
  the app clock once `app_clock` exists (wall time only for the very first migration).
- `GET /instruments/:id` returns camelCase (column aliases); shared API types in `shared/src/types.ts`.
- `normDate` also accepts `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`; `normAmount` strips `₹`, `Rs.`, `INR`, commas, spaces
  and rejects more than 2 significant decimals.
- Source guards (test): only `stateMachine.ts` updates `instruments.status`; only `clock.ts` (+ health, migrate,
  server startup) reads wall time.
- Frontend session (token + user) in `sessionStorage`. Sidebar lists only pages that exist (role home).
- Allowed infra change: `docker-compose.yml` publishes Postgres on `${DB_HOST_PORT:-5432}`; `.env.example` documents
  `# DB_HOST_PORT=5432` (commented). **Local Docker using 55432 must set `DB_HOST_PORT=55432` in `.env`.**
- Added dependency: `express-rate-limit` (backend).

**Phase 02**
- DECISIONS D16 now lists `instrument_id` among the hashed fields (matches the Phase 01 code; no code change).
- Lien not marked is **not** a submit blocker: D8 makes it a gap for `findGaps` and the accept guard (Phase 3). The wizard
  shows a hint when `lien_required` applies.
- D7 duplicate check counts drafts too (any non-terminal status). It runs at create, at edit (when bank or reference
  changes) and at submit; 409 `DUPLICATE_REFERENCE` with `details: { field: 'referenceNo', status }`. Comparison uses the
  normalised reference (`normRef`, also applied in SQL).
- Stored values: `reference_no` stored `normRef`-normalised; `beneficiary_name`, `branch`, `purpose` trimmed with spaces
  collapsed; empty strings clear a field (null). Provenance `value` is the canonical string (`trackedValue`);
  D5 compares with `sameTrackedValue` (beneficiary ignores case/punctuation via `normName`).
- Date rules vs. today (`issue_date <= today`, `maturity_date >= today`) are checked at submit only (drafts may be
  incomplete); `maturity_date > issue_date` is checked on every save (422, not the DB constraint error).
- Extra event `INSTRUMENT_CREATED` on create. Wrong-state edit/upload/delete → 409 `INVALID_STATE`; wrong-state submit →
  409 `INVALID_TRANSITION` (as specified). `type` can be changed only while DRAFT.
- `ValidationFailed` accepts the submit shape `{ fields, missingDocuments }`; every other 422 keeps the array shape.
- Upload order: visibility check → magic-byte type check → file stored (outside any transaction) → transaction re-locks,
  checks DRAFT/RETURNED and records it; if the transaction fails the unrecorded file is removed. Stored path is relative
  to `STORAGE_DIR` (`<instrumentId>/<uuid>.<ext>`). Tests use a temp `STORAGE_DIR`.
- Instrument detail endpoint replaced the Phase 01 bare row with the detail shape (a superset).
- Return reason text is not shown yet (no `returns` table until Phase 3); the wizard shows a generic RETURNED banner.
- Frontend: `ApiError.fieldErrors()` also reads `details.fields` and single-`field` 409s; added `missingDocumentsOf()`,
  `apiUpload()` (XHR for upload progress) and `apiOpenInTab()` (authorised preview via blob URL).

**Phase 03**
- Mock bank: Python FastAPI, same contract as §3.1. It keeps its own copy of the normalisers (`mock_bank/normalize.py`) rather
  than importing the backend: it stands in for an external system. Env vars (offline/slow banks, slow seconds) are read per
  request; data file `MOCK_BANK_DATA_FILE` (default `mock-bank/data/records.json`, gitignored), falling back to
  `records.example.json`. The example file includes demo A1 (`SBIN/FDR/2026/00731`, ₹20 L) so demo steps 1–2 work before Phase 9.
- A CLOSED deposit whose fields all match still gets an OPEN discrepancy on `reference_no` with reason "Deposit closed at bank"
  (otherwise a MISMATCH would have nothing to resolve).
- Re-verification: a field that was BANK_CONFIRMED and is now contradicted by the bank drops to CLAIMED (source `institution`)
  besides getting the discrepancy — keeping a confirmation the bank now disputes would overstate the proof. Fields that were
  CLAIMED/DOCUMENT keep their tier as specified. A MISMATCH response also auto-resolves open discrepancies of fields that now match.
- `verifications.requested_at` / `responded_at` come from the app clock (rule 2); the bank's own `responded_at` stays in
  `response_payload`. VERIFICATION_REQUESTED is written in the apply transaction (with the request time), so no transaction is
  open during the bank call (rule 9). STALE (D9): the row and events are committed, then 409 is raised.
- Every applied bank result bumps `version` (also PENDING/UNAVAILABLE). Claim and accept bump it too; document checks,
  observations and discrepancy resolutions do not touch the instrument row.
- Accept blockers: missing required documents, open discrepancies, open BLOCKING observations, lien (D8) and status ≠
  UNDER_SCRUTINY cannot be overridden; "not confirmed by the bank" is lifted by `overrideNote`. A note sent while CONFIRMED is
  ignored (no override recorded). "Field not bank-confirmed" and open CONCERN observations are checklist warnings.
- Gap messages use field labels ("Open discrepancy: Amount (Amount mismatch)") instead of raw column names.
- Claim only from SUBMITTED (409 otherwise); any officer may act on any case (no per-officer lock yet). Return from SUBMITTED or
  UNDER_SCRUTINY. Observations can be added in any status but DRAFT.
- Queue and review GETs are open to approver/admin/auditor (read-only UI); every mutation is officer-only.
- Document check on a DOCUMENT or BANK_CONFIRMED field → 200 `unchanged: true`; unknown field → 404; a document not attached
  to the instrument → 422 on `documentId`.
- `shared/constants.json` gains `verifiableStatuses`, `verificationResults` (+ labels), `observationSeverities` (+ labels),
  `discrepancyReasons`, new event labels; `institutionVisibleActions` += INSTRUMENT_RETURNED, INSTRUMENT_ACCEPTED,
  VERIFICATION_RESULT (D24). `gen_shared_types.py` emits `VerificationResult` and `ObservationSeverity`.
- `after_accept(tx, inst)` hook in `scrutiny_service.py` is a no-op for Phases 4/5.

## Known issues / follow-ups

(things to fix later; mark resolved when fixed)

- Phase 00: frontend image lacked `tsconfig.base.json` (fixed in all three Dockerfiles); `docker compose up --build`
  needs a re-run on a machine with Docker to confirm.
- ~~Phase 01: switch `migrate()`'s `appliedAt` to the app clock; move StatusChip statuses to the shared enum;
  add the `app_clock` row to `insertFixedRows()`~~ — resolved in Phase 01.
- Phase 04: clock endpoints should run the evaluation job and return its summary.
- Python migration: Docker images were not built here (no Docker). The backend and mock-bank image layouts were
  simulated (same COPY paths, clean `python3.12` venv, non-editable install): constants, migrations and the DB
  resolve. **`docker compose up --build` re-run pending, to be done by the user** (with `DB_HOST_PORT=55432`).

## Manual checks

(results of the UI/manual acceptance checks, e.g. "Phase 00 check 1: docker compose up OK on macOS")

- Phase 00 check 1 (`docker compose up --build`), first run by the user: db, mock-bank and backend OK; the frontend
  failed with `TSCONFIG_ERROR "Failed to load tsconfig '../tsconfig.base.json'"`, because the Dockerfiles never
  copied the root `tsconfig.base.json`, which every workspace tsconfig extends (`shared`, `backend`, `mock-bank`,
  `frontend`). Fixed: all three Dockerfiles now `COPY package.json package-lock.json tsconfig.base.json ./`.
  Reviewed by reading only (no Docker in the sandbox):
  - each image has the root manifests and the base tsconfig, every workspace `package.json` (needed by `npm ci`),
    and its own sources plus `shared/` where it imports it (backend, frontend);
  - `.dockerignore` excludes only `node_modules`, `.env`, `storage`, `.git`, `dist` and `coverage`, none of which
    the build needs. The `.env` loaders skip a missing file, and compose passes the env vars.

  **Re-run pending, to be done by the user.**
- Phase 00 check 2 (`npm run dev` + Postgres only): OK in cloud sandbox (Postgres 16 via
  `scripts/start-pg-sandbox.sh`). Headless Chromium on `http://localhost:5173` showed "API: up, Database: up,
  Mock bank: up" with no console errors; CORS header present for the frontend origin.
- Phase 00 checks 3–6: `backend/tests/test_phase00_health.py`. Check 7: `npm run typecheck` (ruff, mypy, tsc) passes.
- Phase 01 checks 1–2: `backend/tests/test_phase01_auth.py`; 3: `test_phase01_access.py`; 4–5: `test_phase01_state_machine.py`;
  6: `test_phase01_clock.py`; 7–8: `test_phase01_audit.py`; 9: `test_normalize.py`; 10: `test_phase01_source_guard.py`.
- Phase 02 checks 1–3, 7–9: `backend/tests/test_phase02_submission.py`; 4–6: `test_phase02_documents.py`;
  10: `test_phase02_list.py`; schemas: `test_schemas.py`; `amountInWords`: `shared/tests/format.test.ts`.
  (Before the Python migration these were the equivalent `*.test.ts` files.)
- Phase 02 check 11 (UI), cloud sandbox, `npm run dev` + headless Chromium: Institution 1 → New instrument; invalid
  reference/amount/bank showed errors under each field; amount typed `2500000` shown as `25,00,000` with "Twenty-five lakh
  rupees"; Next saved the draft and moved to Documents; a text file named `.pdf` was rejected next to the file input; FDR
  copy and bank letter uploads turned the checklist green; re-uploading the same file showed the duplicate warning; Review
  said "Everything required is in place"; Submit → detail page with Submitted + Not verified chips and seven "Claimed by
  institution" chips. Two tabs editing the same draft: the second save showed "This record changed in another tab" and
  Reload loaded the other tab's value. Only console errors were the browser's log lines for the intentional 422s.
- Python migration, cloud sandbox, `npm run seed` + `npm run dev` (uvicorn, Python mock bank, Vite) + headless
  Chromium: Phase 01 check 11 and Phase 02 check 11 repeated in full against the Python backend. All six quick
  sign-ins landed on their role homes with `Today · 25 Oct 2026`; officer `/admin` → `/officer` without clock
  controls; admin +7d → `SIMULATED · 1 Nov 2026`, Set date → `SIMULATED · 12 Dec 2026`, Reset → `Today · …`;
  wrong password / invalid email messages shown. Wizard: server field errors under reference, amount ("Amount must
  be more than zero") and bank; "Twenty-five lakh rupees"; text file named `.pdf` rejected; FDR copy + bank letter
  uploaded; duplicate warning; second tab got the stale-version banner and Reload showed the other tab's value;
  Review "Everything required is in place"; Submit → detail with Submitted / Not verified and seven "Claimed by
  institution" chips. No unexpected console errors. CORS preflight from `http://localhost:5173` allowed.
- Phase 03 checks 1–14: `backend/tests/test_phase03_scrutiny.py` (real mock bank under uvicorn on a free port; AC12 stubs the
  bank client to bump the version); `find_gaps`: `test_gaps.py`; mock bank contract: `mock-bank/tests/test_phase03_mock_bank.py`.
- Phase 03 check 15 (UI), cloud sandbox, `npm run dev` + headless Chromium (demo steps 1–2): Institution 1's `SBIN/FDR/2026/00731`
  at ₹25 L → Officer → Scrutiny queue → Claim → Verify with bank → discrepancy card "Institution claimed ₹25,00,000.00 · Bank
  confirmed ₹20,00,000.00", six fields "Bank-confirmed" (shield icon), amount "Claimed by institution", weakest field Claimed,
  Accept disabled listing "Open discrepancy: Amount (Amount mismatch)" and "Not confirmed by the bank"; Return to institution
  (prefilled reason) → Institution 1 sees the reason on the RETURNED banner; corrected to ₹20 L and resubmitted → Officer claims,
  verifies → all green, checklist "Everything is in place" → Accept → Active; verification history shows both calls. Slow bank
  (Bank of India) showed "Bank is processing — retry in 10s". No console errors.
- Phase 01 check 11 (UI), cloud sandbox, `npm run dev` + headless Chromium: each of the six quick buttons signed in and
  landed on its role home with name and `Today · 25 Oct 2026` badge; officer opening `/admin` was redirected to `/officer`
  and saw no clock controls; admin +7d → `SIMULATED · 1 Nov 2026`, Set date 2026-12-12 → `SIMULATED · 12 Dec 2026`,
  Reset → `Today · …`; wrong password showed "Email or password is incorrect"; invalid email showed a field error;
  no console errors.
