# Build progress

Claude Code updates this file at the end of every phase. Read it first in every session.

| Phase | Title | Status | Commit | Notes |
|---|---|---|---|---|
| 00 | Environment and skeleton | done with known issues | (this commit) | AC1 (docker compose) not run: no Docker in build sandbox |
| 01 | Foundation | done | (this commit) | All 11 checks pass (AC11 run in headless Chromium) |
| 02 | Submission and documents | done | (this commit) | All 11 checks pass (AC11 run in headless Chromium) |
| 03 | Scrutiny, mock bank, trust tiers | not started | | |
| 04 | Rules engine, alerts, escalation | not started | | |
| 05 | Renewal chain and passport | not started | | |
| 06 | Release workflow | not started | | |
| 07 | Dashboard, my day, reports, metrics | not started | | |
| 08 | Admin, audit integrity, security | not started | | |
| 09 | Seed, demo tools, rehearsal, polish | not started | | |

Status values: `not started` · `in progress` · `done` · `done with known issues`.

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

## Known issues / follow-ups

(things to fix later; mark resolved when fixed)

- Phase 00: frontend image lacked `tsconfig.base.json` (fixed in all three Dockerfiles); `docker compose up --build`
  needs a re-run on a machine with Docker to confirm.
- ~~Phase 01: switch `migrate()`'s `appliedAt` to the app clock; move StatusChip statuses to the shared enum;
  add the `app_clock` row to `insertFixedRows()`~~ — resolved in Phase 01.
- Phase 04: clock endpoints should run the evaluation job and return its summary.

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
- Phase 00 checks 3–6: `backend/tests/phase00.health.test.ts`. Check 7: `npm run typecheck` passes in all 4 workspaces.
- Phase 01 checks 1–2: `backend/tests/phase01.auth.test.ts`; 3: `phase01.access.test.ts`; 4–5: `phase01.stateMachine.test.ts`;
  6: `phase01.clock.test.ts`; 7–8: `phase01.audit.test.ts`; 9: `shared/tests/normalize.test.ts`; 10: `phase01.sourceGuard.test.ts`.
- Phase 02 checks 1–3, 7–9: `backend/tests/phase02.submission.test.ts`; 4–6: `phase02.documents.test.ts`;
  10: `phase02.list.test.ts`; schemas/`amountInWords`: `shared/tests/schemas.test.ts`, `format.test.ts`.
- Phase 02 check 11 (UI), cloud sandbox, `npm run dev` + headless Chromium: Institution 1 → New instrument; invalid
  reference/amount/bank showed errors under each field; amount typed `2500000` shown as `25,00,000` with "Twenty-five lakh
  rupees"; Next saved the draft and moved to Documents; a text file named `.pdf` was rejected next to the file input; FDR
  copy and bank letter uploads turned the checklist green; re-uploading the same file showed the duplicate warning; Review
  said "Everything required is in place"; Submit → detail page with Submitted + Not verified chips and seven "Claimed by
  institution" chips. Two tabs editing the same draft: the second save showed "This record changed in another tab" and
  Reload loaded the other tab's value. Only console errors were the browser's log lines for the intentional 422s.
- Phase 01 check 11 (UI), cloud sandbox, `npm run dev` + headless Chromium: each of the six quick buttons signed in and
  landed on its role home with name and `Today · 25 Oct 2026` badge; officer opening `/admin` was redirected to `/officer`
  and saw no clock controls; admin +7d → `SIMULATED · 1 Nov 2026`, Set date 2026-12-12 → `SIMULATED · 12 Dec 2026`,
  Reset → `Today · …`; wrong password showed "Email or password is incorrect"; invalid email showed a field error;
  no console errors.
