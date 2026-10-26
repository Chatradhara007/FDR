# Build progress

Claude Code updates this file at the end of every phase. Read it first in every session.

| Phase | Title | Status | Commit | Notes |
|---|---|---|---|---|
| 00 | Environment and skeleton | done with known issues | (this commit) | AC1 (docker compose) not run: no Docker in build sandbox |
| 01 | Foundation | done | (this commit) | All 11 checks pass (AC11 run in headless Chromium) |
| 02 | Submission and documents | done | (this commit) | All 11 checks pass (AC11 run in headless Chromium) |
| — | Stack migration: backend + mock bank → Python (D28) | done | (this commit) | Phases 00–02 ported 1:1; 100 backend pytest + 1 mock-bank + 7 shared vitest; UI checks re-run |
| 03 | Scrutiny, mock bank, trust tiers | done | (this commit) | All 15 checks pass (AC15 run in headless Chromium) |
| 04 | Rules engine, alerts, escalation | done | (this commit) | All 13 checks pass (AC13 run in headless Chromium) |
| 05 | Renewal chain and passport | done | (this commit) | All 9 checks pass (AC9 run in headless Chromium) |
| 06 | Release workflow | done | (this commit) | All 10 checks pass (AC10 run in headless Chromium) |
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

**Phase 04** (all under `/api/v1`)
- `POST /clock/advance`, `/clock/set`, `/clock/reset` (admin) now run the evaluation job in the same transaction and return
  `{ clock: { mode, now, today, warning? }, summary: { asOf, statusChanges, alertsCreated, escalations, resolved, superseded } }`
- `POST /jobs/evaluate` (admin) → the summary
- `GET /alerts` (all roles, scoped per D23) — `status` (`open` = OPEN+ACKNOWLEDGED default, `OPEN`, `ACKNOWLEDGED`,
  `ESCALATED`, `RESOLVED`, `all`), `kind`, `instrumentId`, `mine=true` (addressed to me), `level`, `page`, `pageSize` (50, max
  100); items joined with instrument reference/type/status/bank/amount/maturity, institution name, `ageDays` from the root
- `GET /alerts/summary` → `{ total, byKind, byLevel }` (open = OPEN+ACKNOWLEDGED, for the bell)
- `POST /alerts/:id/acknowledge` (all but auditor; does not stop escalation), `POST /alerts/:id/resolve {note}` (officer,
  approver, admin → `MANUAL`); an alert not addressed to the user → 404
- `GET /outbox` (admin) → simulated emails, newest first, paged
- `GET /instruments` and `GET /scrutiny/queue` items gain `worstOpenAlertLevel` and `openAlertCount`
- Real clock: APScheduler evaluates at start-up and daily at 06:00 IST while the clock mode is REAL (`SCHEDULER_ENABLED=false`
  turns it off; the tests do)

**Phase 05** (all under `/api/v1`)
- `POST /instruments/:id/renew` (institution, own) → 201 the new DRAFT replacement (copies institution, type, bank, branch,
  beneficiary, purpose, amount; dates/reference empty, lien false); 409 `NOT_RENEWABLE` (not EXPIRING/MATURED/LAPSED, or a
  release request is open — D6) / `ALREADY_RENEWING` (`details.successorId`); other institution 404, AICTE roles 403
- `GET /instruments/:id/passport` (all roles, scoped) → `{ instrument, fields, weakestTier, chain, documents, verifications,
  discrepancies, observations, returns, alerts, releaseRequests: [], summary, timeline }`; chain links carry `depth`,
  `isCurrent`, `gapDaysFromPrevious` (+ = gap, − = overlap) and `gapKind`
- `POST /instruments/:id/submit` of a replacement: 422 on `maturityDate` when it does not mature after the parent (rule
  `renewal_checks`); coverage gap / lower amount add system CONCERN observations (once)
- `POST /instruments/:id/accept` of a replacement: re-checks the maturity rule (422), then the parent → RENEWED (409
  `PARENT_NOT_RENEWABLE` rolls the whole accept back), `RENEWED_BY` / `RENEWS` events, parent's alerts auto-resolved at once

**Phase 06** (all under `/api/v1`)
- `POST /instruments/:id/release-requests {reason}` (institution, own) → 201 the request view; instrument → RELEASE_REQUESTED
  (`status_before_release` kept). 409 `NOT_RELEASABLE` (not ACTIVE/EXPIRING/MATURED/LAPSED — RENEWED says only its live
  replacement can be released — or a non-terminal successor exists, D6) / `RELEASE_ALREADY_REQUESTED`; other institution 404
- `GET /release-requests` (all roles; institutions only their own) — `status` (repeat or comma list), `awaitingMe=true` (open and
  the current level is the caller's role), `instrumentId`, `page`, `pageSize` → `{ items, total, page, pageSize }`; items carry
  `ageDays` at the current level, instrument and institution columns
- `GET /release-requests/:id` (all roles, scoped) → `{ request, statusLabel, currentLevelInfo, instrument, documents, conditions,
  blocked, blockers, approvals, orderNumber, canRecommend, canDecide, canApprove, actionBlockers, canEditConditions,
  canUploadDocuments, canResubmit, canCancel }`; conditions carry live `met`, `reason`, `link` (`discrepancy`/`observation`/
  `verification`/`documents`), `metAtRecommendation`, `changedSinceRecommendation`
- `POST /release-requests/:id/documents` (multipart, institution, PENDING_CONDITIONS or RETURNED; RELEASE_LETTER,
  COMPLIANCE_CERTIFICATE, LIEN_REMOVAL_REQUEST, OTHER) → 201 `{ document, duplicateOf }`; download/preview through the
  instrument's document routes
- `PATCH /release-conditions/:id {met, remarks}` (officer, manual conditions, PENDING_CONDITIONS; remarks required when `met`)
- `POST /release-requests/:id/recommend {remarks, level?}` (role of the current RECOMMEND level) — 409 `RELEASE_BLOCKED`
  `details.reasons`
- `POST /release-requests/:id/decide {decision: APPROVE|REJECT|RETURN, remarks, refundReference?, level?}` (role of the current
  level) — 409 `RELEASE_BLOCKED` (APPROVE only), 409 `ALREADY_DECIDED`, 403 `SEPARATION_OF_DUTIES`, 403 another role's level
- `POST /release-requests/:id/resubmit {note}` (institution, RETURNED), `POST /release-requests/:id/cancel` (institution,
  PENDING_CONDITIONS or RETURNED)
- `GET /instruments/:id/passport` `releaseRequests` is filled (one view per request, newest first)
- `POST /instruments/:id/renew` now refuses (409 `NOT_RENEWABLE`) while a row in `release_requests` is open (PENDING_CONDITIONS,
  PENDING_APPROVAL or RETURNED), naming its state and date
- Evaluation job: `RELEASE_PENDING` alerts (see deviations)

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

**Phase 04**
- Header (admin): clock widget +1d / +7d / +30d / +90d, "Set date…", "Reset to today"; toast built from the summary
  (`App date 2 Nov 2026 (simulated): 1 status change · 5 alerts · 0 escalations · 0 resolved`); moving backwards (an earlier
  date, or Reset while the simulated date is ahead of the browser's date) asks for confirmation; every query is invalidated
- Header (all roles): bell with the open alert count (`/alerts/summary`, polled every 30 s and refreshed after clock changes)
- `/alerts` (all roles): tabs Open / Acknowledged / Escalated / Resolved, alerts grouped by instrument (reference, status chip,
  institution, bank, amount, maturity, Open instrument), kind chip with icon, level chip (`L1`, `L2 · Escalated to approver`,
  `L3 · Escalated to administrator`), due date and age, Acknowledge, Resolve with note (internal roles), resolution text
- `/admin/outbox` (admin): table of simulated emails (time, recipient, subject); click opens the email
- Institution home table and scrutiny queue gain an "Alerts" column (worst open level + count, icon + text)
- Sidebar: "Alerts" for every role, "Outbox" for admin
- New components: `AlertKindChip`, `AlertLevelChip`, `WorstAlertChip`, `AlertBell`; `NoteModal` moved from
  `pages/officer/review/` to `components/` (reused by the inbox)

**Phase 05**
- `/instruments/:id` (all roles): the **passport** — header (reference, bank, amount, maturity with days left / overdue in red,
  status, verification, open-alert chip, weakest-tier badge, "Accepted without bank confirmation" badge + note for AICTE roles,
  "Replaces …" / "Replaced by …" links); actions: institution Renew (EXPIRING/MATURED/LAPSED without successor), Continue
  renewal, Edit / Correct and resubmit; AICTE roles Open review. Open-problems card (blockers). Tabs Timeline (default; icon,
  label, actor, app-clock time, click to expand a before/after table with changed keys highlighted), Fields (tier, source, last
  updated), Documents (+ required checklist), Verification (result, per-field match, raw payload for AICTE roles, observations),
  Chain (nodes oldest → newest, arrows "12-day gap" red / "5-day overlap" green / "continuous", current highlighted, click opens
  that passport), Alerts (open / resolved), Release (empty until Phase 6)
- The Phase 2 detail page is gone: `/institution/instruments/:id` redirects to the passport. Institution home rows, alerts inbox
  "Open instrument" (every role), scrutiny queue reference links and the wizard's post-submit redirect go to the passport;
  the review page links to it. Queue row click still opens the review.
- Wizard: a renewal draft shows "Replacement for <ref> (matures …)" with the rule it must meet
- New files: `pages/passport/{PassportPage,TimelineTab,ChainTab,DetailTabs}.tsx`, `pages/institution/ReturnBanner.tsx` (moved),
  `pages/institution/wizard/ReplacementBanner.tsx`

**Phase 06**
- `/officer/releases` (officer; read-only for approver/admin/auditor): tabs Waiting for me / Open / Closed / All; columns
  institution, instrument, amount, request status chip, level ("L2 of 3 · Competent authority decision"), days waiting (amber
  from 5 d, icon + text). Sidebar "Releases" (officer, admin, auditor), "All releases" (approver).
- `/officer/releases/:id` and `/approver/releases/:id`: one release review / decision page — header (reference, institution,
  bank, amount, request + instrument + verification chips, passport and scrutiny-review links), decision banner ("The portal
  supports the decision; the decision rests with the competent authority"), red blocked banner listing failing conditions,
  actions by whose turn it is (officer: Re-verify with bank, Recommend — disabled while blocked, with the reasons —, Return,
  Reject; approver: Approve with remarks + refund reference, Return, Reject), conditions checklist (auto conditions live ✓/✗ with a
  link to the cause, e.g. "Open discrepancy on amount →" to the review page's discrepancy card; manual conditions as checkbox +
  remarks + Save for the officer; "Changed since recommendation" highlight), approval chain (levels, who, decision, remarks,
  when), request facts, release documents, "At recommendation" snapshot with changed rows highlighted.
- `/approver` home: "Decisions waiting for you" table and the open alerts addressed to the competent authority.
- `/releases/:id/order` (all roles who can see the request): printable Release / Discharge Order — order number, instrument
  details, conditions met, approval chain (last round), refund reference, "Generated by FDR Portal (demo)"; Print / save as PDF.
  The sidebar, header and toasts are hidden when printing.
- Passport: institution "Request release" (eligible statuses, no open request, no replacement in progress) → modal with reason,
  document type and file; the Release tab lists every request (status, level, reason, return message, conditions in plain
  wording, documents with upload while allowed, decisions, Resubmit / Cancel, release-order link; AICTE roles also "Open release
  review"). Timeline release events use a new `release` icon.
- New files: `api/releases.ts`, `components/ReleaseStatusChip.tsx`, `pages/releases/{ReleaseList,ReleaseReviewPage,ReleaseOrder,
  RequestReleaseModal,ApproverHome,parts}.tsx`, `pages/passport/ReleaseTab.tsx`.

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
- Re-verification (now DECISIONS D29): a field that was BANK_CONFIRMED and is now contradicted by the bank drops to CLAIMED (source `institution`)
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
- `after_accept(tx, inst)` hook in `scrutiny_service.py` is a no-op for Phases 4/5 (Phase 04 filled in the targeted sweep).

Phase 04:
- `JOB_EVALUATED` is written only when some counter is non-zero, so a repeat run on the same date leaves no trace at all (AC2).
  It carries the summary in `after_json`.
- Clock change and evaluation run in **one** transaction (clock row locked, `CLOCK_*` event, then the job), so a failed run
  leaves the clock unchanged. Phase 01 tests and `useClockMutation` were updated for the `{ clock, summary }` response (spec §4.4).
- Summary counters: `alertsCreated` = live alerts inserted by maturity reminders and the process step; `superseded` = live
  reminders updated to SUPERSEDED plus looser ones inserted already superseded; `escalations` = new higher-level alerts (not
  also counted as created); `resolved` = auto-resolved (SYSTEM_CONDITION_CLEARED).
- `OVERDUE_RENEWAL` keeps one `rule_key` (`overdue_renewal`, due = maturity + grace) across MATURED → LAPSED, so the escalation
  chain is not restarted by the lapse; its message is fixed when created ("matured … grace ends …" or "lapsed …").
- Escalated alerts copy the root's due date and message, prefixed "Escalated to approver (L2) — not resolved for N days.";
  their recipients follow D23 (officer level → assigned officer). Each escalated alert gets an outbox email.
- No per-alert `ALERT_CREATED` event (the outbox row and `JOB_EVALUATED` record creation). `ALERT_ACKNOWLEDGED`,
  `ALERT_ESCALATED` and `ALERT_RESOLVED` (manual, auto-resolved, superseded) are events.
- Alert visibility (D23): institution → own institution's institution copies; officer → officer copies addressed to them or to
  the pool; approver / admin → their role's copies; auditor → all (read-only). `worstOpenAlertLevel` / `openAlertCount` on
  instrument lists count every open copy for AICTE roles (so the queue shows an item escalated to L3) and only their own
  copies for institutions.
- `PENDING_VERIFICATION` / `DISCREPANCY_OPEN` ages use the IST calendar date of `submitted_at` / the discrepancy's
  `created_at`; `>= afterDays` triggers (5 days after submission). Discrepancy alerts are not raised on RENEWED/RELEASED.
- Rule configs are validated by pydantic models in `schemas.py` (`ReminderRule`, `AfterDaysRule`, `OverdueRenewalRule`,
  `EscalationRule`, `RULE_CONFIG_MODELS`, for the Phase 8 editor). A missing rule falls back to its default in
  `shared/constants.json`; an invalid stored config fails the run with 500 `RULE_INVALID` (nothing is applied).
- Alert inserts are batched (`jsonb_to_recordset`, `ON CONFLICT (dedupe_key) DO NOTHING RETURNING`), ids generated in Python
  so level-1 alerts carry `root_alert_id = id`. The 365-day jump over 500 instruments takes ≈2 s here.
- The inbox has a fourth tab, "Escalated", so an officer can see what climbed above them.
- `GET /alerts/summary` (the bell) counts OPEN + ACKNOWLEDGED, as `GET /alerts`'s default; acknowledging does not lower it.
- Phase 01 source guard: the `SET status` pattern now matches only `UPDATE instruments … SET status`, so
  `UPDATE alerts SET status` is allowed; the instruments guard is as strict as before.
- Scheduler uses the fixed IST offset from `domain/clock.py` (no tz database needed on Windows).

Phase 05:
- Chain query (§5.5): the `down` part starts at depth **1** (the spec's CTE gave the successor depth 0, the same as the
  instrument itself, so ordering by depth was ambiguous). Children are found with ids only, then joined to the full rows.
- ~~No `release_requests` table until Phase 6: "open release request" (D6) is the RELEASE_REQUESTED status.~~ Replaced in
  Phase 6 by a real check of `release_requests` (see Phase 06 below).
- Coverage gap is flagged when `gapDays > flagCoverageGapDays` (default 0: any day between parent maturity and replacement
  issue). Lower amount compared in paise. Both observations are system ones (author null, CONCERN, visible to the
  institution, `OBSERVATION_ADDED` by `system`), deduplicated by exact text on the instrument. They are warnings, not accept
  blockers. `requireLaterMaturity: false` switches the hard rule off (rule `renewal_checks`, migration 005 + `ruleDefaults`,
  validated by `RenewalChecksRule`).
- The maturity rule is checked again at accept (422 `maturityDate`), and the soft checks run again there (dedup keeps them single).
- Error codes: `NOT_RENEWABLE`, `ALREADY_RENEWING` (the partial unique index backs it up under a race), `PARENT_NOT_RENEWABLE`.
- Events: `RENEWAL_STARTED` on both instruments (child `after {parentId, parentReferenceNo}`, parent `after {childId}`), plus
  `INSTRUMENT_CREATED` on the child; at activation `STATUS_RENEWED` (`renewedBy`), `RENEWED_BY` (parent, `{childId,
  referenceNo}`), `RENEWS` (child, `{parentId, referenceNo}`). All three are institution-visible (D24 whitelist).
- Targeted auto-resolve: `auto_resolve`/`resolve_cleared` take an optional instrument id; activation runs it for the parent
  (`ALERT_RESOLVED` events, SYSTEM_CONDITION_CLEARED). The child then gets the D20 sweep as before.
- Passport, D24 strictly: institutions get no discrepancies (`[]`; per-field match is in the verification outcome), no raw
  verification payloads or requester, `overrideNote` null, only visible observations (also in `openProblems`), only their own
  alert copies, only whitelisted events. AICTE roles get every alert copy.
- Labels: `eventLabels` stays the one map; `domain/event_labels.py` refines a few from the event data (VERIFICATION_RESULT
  "Bank verification: mismatch on amount" / "…: confirmed", RENEWED_BY "Replaced by <ref>", RENEWS "Replaces <ref>",
  ALERT_ESCALATED "Escalated to approver", DOCUMENT_ACCESSED "Document viewed by <actor>"); unknown actions fall back to the
  action name. The existing STATUS_* labels ("Status changed to Active") were kept; "Accepted by officer" is INSTRUMENT_ACCEPTED.
  Icon keys come from the server (`icon_for`), mapped to lucide icons in the UI.
- `shared/constants.json` gains `renewableStatuses` (EXPIRING, MATURED, LAPSED), the `renewal_checks` default, three labels.
- Refactors needed by this phase: the review page's field builder moved to `instrument_service.field_rows` (shared with the
  passport); `after_accept` takes the actor; `sourceLabel` accepts passport verifications; the mock-bank `bank_url` fixture
  moved from `test_phase03_scrutiny.py` to `conftest.py` (unchanged) for the renewal tests.
- The passport page is keyed by instrument id so moving along the chain starts on the Timeline tab.

Phase 06:
- D6 both ways against the `release_requests` table: renew is refused while the instrument has an open request
  (PENDING_CONDITIONS, PENDING_APPROVAL or RETURNED — the message names the state and request date); a release request is
  refused while the instrument has a successor that is not RENEWED/RELEASED (a draft replacement counts; deleting it frees the
  instrument). The Phase 05 test that faked the status now makes a real request.
- Migration `006_release.sql` adds to the spec's tables: `release_requests.stage_started_at` (when the current level was reached;
  RELEASE_PENDING age and the list's "waiting" column), `seq bigserial` on requests and approvals (the simulated clock can give
  several decisions the same time, so order is by insertion), `release_conditions.position` (configured order) and
  `UNIQUE (release_request_id, code)`, a CHECK on request status / decision, an index on `documents.release_request_id`.
- New rules `release_conditions` and `approval_levels` (migration + `ruleDefaults`), validated by `ReleaseConditionsRule` (only
  codes with an automatic check may be `auto`) and `ApprovalLevelsRule` (levels numbered 1…n, the last one DECIDE). The chain is
  snapshotted into `required_levels`; `extraLevel` is appended when amount > `extraApprovalAbove` (paise; exactly ₹50 L stays at
  two levels). Code loops over levels: a level's `action` is RECOMMEND (uses `/recommend`) or DECIDE (`/decide`).
- `/decide` at a RECOMMEND level allows RETURN and REJECT (the officer can send a request back for missing papers); APPROVE there
  is a 422 on `decision`. `level` in the body is the level the client saw: a different current level (or a closed request) →
  409 `ALREADY_DECIDED` "This request was already decided by <name> (<decision>, level n)". Concurrency: request and instrument
  rows are locked `FOR UPDATE` in every step (two simultaneous approvals: one 200, one 409 — tested with threads).
- Separation of duties (D27) applies to every decision (recommend, approve, return, reject): a user who acted at another level of
  the same request → 403 `SEPARATION_OF_DUTIES`. Acting again at the same level after a return is allowed. A user whose role is
  not the current level's gets 403 `FORBIDDEN`.
- Manual conditions can be changed only while PENDING_CONDITIONS; a request returned and resubmitted keeps its ticks (the officer
  can untick). Auto conditions are never stored; a closed request shows its conditions as of its last decision's snapshot.
- Release documents live in `documents` with `release_request_id` (same storage, magic-byte and size rules — the upload code is
  shared via `document_service.store_document`); the instrument's own document list and required-document checks exclude them.
  New doc type `LIEN_REMOVAL_REQUEST`. The upload event is `DOCUMENT_UPLOADED` with `releaseRequestId` (label "Release document
  uploaded: …").
- Events (entity `release_request`, labelled in `eventLabels`, icon `release`): RELEASE_REQUESTED, RELEASE_CONDITION_CHECKED
  (entity `release_condition`), RELEASE_RECOMMENDED, RELEASE_LEVEL_APPROVED (non-final approval), RELEASE_APPROVED (after_json:
  every condition, the whole approval chain, refund reference, order number, required levels), RELEASE_REJECTED,
  RELEASE_RETURNED, RELEASE_RESUBMITTED, RELEASE_CANCELLED. Restoring transitions carry `releaseRequestId` and read "Status
  changed to Active (release request closed)". Institution whitelist (D24): REQUESTED, REJECTED, RETURNED, RESUBMITTED, CANCELLED
  — not RECOMMENDED / LEVEL_APPROVED / CONDITION_CHECKED (internal), and not APPROVED, whose chain carries internal remarks
  (institutions see STATUS_RELEASED, the Release tab and the order). In the request view institutions get remarks only on
  RETURN/REJECT decisions and no condition snapshots.
- RELEASE_PENDING: requests in PENDING_CONDITIONS / PENDING_APPROVAL for `afterDays` (5) at their current level → alert to the
  role of the current level (`subject_id` = request id, `rule_key` `release_pending:<level>`, due = level reached + afterDays),
  starting at that role's rung of the escalation ladder (officer L1, approver L2) so it escalates per D11 from there. The rule's
  `recipients` list is not used (§6.5 says the current level's role). It auto-resolves when the request leaves those states or
  moves to another level; every release action also runs the targeted auto-resolve so screens are right at once.
- Reject and cancel restore `status_before_release` through `transition()` and then run the targeted sweep (D20). Approval runs
  the targeted auto-resolve, which closes every open alert of the RELEASED instrument.
- Order number `AICTE/REL/<IST year>/<first 8 of the request id>` (derived, no column).
- Base seed gains `approver2@demo.in` (Shri R. K. Malhotra, Deputy Secretary — second approver above ₹50 L), as in
  `docs/seed-spec.md`; the login page's quick buttons are unchanged.
- `routes/instruments._receive_file` renamed `receive_file` (shared with the release upload route). Layout/Toast gained
  `print:hidden` classes for the order.

## Known issues / follow-ups

(things to fix later; mark resolved when fixed)

- Phase 00: frontend image lacked `tsconfig.base.json` (fixed in all three Dockerfiles); `docker compose up --build`
  needs a re-run on a machine with Docker to confirm.
- ~~Phase 01: switch `migrate()`'s `appliedAt` to the app clock; move StatusChip statuses to the shared enum;
  add the `app_clock` row to `insertFixedRows()`~~ — resolved in Phase 01.
- ~~Phase 04: clock endpoints should run the evaluation job and return its summary.~~ — resolved in Phase 04.
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
- Phase 04 checks 1–6, 8, 12: `backend/tests/test_phase04_job.py` (also: targeted sweep after accept, grace period, overdue
  messages, discrepancy alerts); 7, 9, 10: `test_phase04_alerts.py` (also: assigned officer vs pool, filters/summary, list
  alert columns); 11: `test_phase04_clock.py` (also: backwards move keeps alerts, `/jobs/evaluate`, outbox, rules read per run,
  rule validation, scheduler only in REAL mode).
- Phase 04 check 13 (UI), cloud sandbox, `npm run seed` + three scratch instruments + `npm run dev` + headless Chromium:
  admin +7d → toast "App date 2 Nov 2026 (simulated): 1 status change · 5 alerts · 0 escalations · 0 resolved", badge
  `SIMULATED · 2 Nov 2026`; next +7d → "1 escalation"; next → L3 reached the admin: bell 1, `/alerts` showed one instrument group
  with "Verification pending" + "L3 · Escalated to administrator"; Outbox listed the emails and opened one; Set date to an earlier
  day showed "Move the clock backwards?" and Cancel left the date unchanged. Officer: bell count, queue row "L3 · 1 open",
  inbox grouped by instrument, Acknowledge moved the row to the Acknowledged tab, Resolve with an empty note showed "Note is
  required", with a note → Resolved tab "Resolved by hand — …". Institution 1: home table "Alerts" column `L1 · 1 open`, inbox
  with only its own two instruments and no Resolve button. Officer review page Return modal still opens (NoteModal move).
  No console errors. Dev DB reset and re-seeded afterwards.
- Phase 05 checks 1–5, 8: `backend/tests/test_phase05_renewal.py` (also: renew copy + events, permissions, renewable statuses,
  same-maturity rejection, the rule switch, every failing field listed, accept re-check, draft successor in the chain);
  6–7: `test_phase05_passport.py` (also: payload shape, newest-first timeline, dynamic labels).
- Phase 05 check 9 (UI), cloud sandbox, `npm run seed` + `npm run dev` + headless Chromium: Institution 1's
  `SBIN/FDR/2026/00731` accepted, clock +100 d → EXPIRING; its passport showed Expiring / Bank-confirmed / "L1 · 1 open",
  57 d to maturity, Timeline with icons and actors; **Renew** → wizard with "Replacement for SBIN/FDR/2026/00731 (matures 1 Apr
  2027)"; maturity 1 Mar 2027 → Submit showed "Maturity date: Replacement must mature after the instrument it replaces (1 Apr
  2027)"; corrected to 1 Feb 2028 → submitted → passport. Officer claimed, verified (CONFIRMED), accepted (API). Child passport
  Chain tab: two nodes, arrow "59-day overlap", current node highlighted; clicking the parent node opened its passport on the
  Timeline tab: Renewed, "Replaced by SBIN/FDR/2027/00950" and "Status changed to Renewed" expanded (status EXPIRING →
  RENEWED highlighted); Alerts tab: reminder "Resolved · Condition cleared", 0 open. Officer passport: Verification tab with
  per-field matches and the raw payload toggle, "Open review" button, internal events in the timeline. No console errors
  besides the browser's log line for the intentional 422. Dev DB reset and re-seeded, `mock-bank/data/records.json` removed.
- Phase 06 checks 1–9: `backend/tests/test_phase06_release.py` (also: request validation and access, release document types and
  separation from instrument documents, manual-condition remarks, blocking observation and override, chain from the rule,
  exactly-₹50 L boundary, threaded concurrent approvals, returned request blocks renewal, list scoping/`awaitingMe`, passport
  Release tab, D24 filtering and labels for every release event). Phase 05 AC5 test now uses a real release request.
- Phase 06 check 10 (UI), cloud sandbox, `npm run seed` + `npm run dev` + headless Chromium. Setup through the API: Institution
  1's `SBIN/FDR/2026/00731` (₹20 L) submitted, verified (CONFIRMED) and accepted. Institution 1 → passport → **Request
  release**: empty reason showed "Enter the reason for the release"; with reason + release letter → Release tab "Checking
  conditions", level 1 of 2, red banner "Release blocked — 2 conditions are not met" (the two officer checks), Cancel request
  shown, Request release gone. Officer → Releases → the request: Recommend disabled; ticked both manual conditions with remarks;
  mock bank record changed to ₹25 L → **Re-verify with bank** → red banner listing "Open discrepancy on amount" and "Not confirmed
  by the bank (Mismatch)", condition link "Open discrepancy on amount →" to `/officer/review/<id>`, Recommend still disabled;
  record restored → Re-verify → all green → Recommend with remarks → "Awaiting approval". Approver home "Decisions waiting for
  you (1)" → decision page with the competent-authority banner and "At recommendation" snapshot → Approve with empty remarks
  showed "Remarks are required"; with remarks + refund reference → "Approved — released", instrument Released → **Release /
  Discharge Order** (order no., details, six conditions met, two-level chain, refund reference, demo footer); print media hides
  sidebar, header and toasts. Institution timeline: "Release approved…" not shown, "Status changed to Released", "Release
  document uploaded: release letter", "Release requested". Second run (`CNRB/FD/2025/11842`, returned by the approver through the
  API): institution saw "Returned by AICTE: …", no internal recommendation remarks, uploaded a compliance certificate, Resubmit
  (empty note → "Note for AICTE is required") → "Checking conditions"; Cancel request → Cancelled, instrument back to Active,
  Request release offered again. No console errors. Dev DB reset and re-seeded, `mock-bank/data/records.json` removed.
