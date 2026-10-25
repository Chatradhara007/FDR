# FDR Portal — project guide for Claude Code

Security Deposit / FDR Management Portal for AICTE (Smart India Hackathon, problem SIH26265).
Institutions lodge Fixed Deposit Receipts (FDRs) and security deposits as guarantees; AICTE
officials verify them, watch their maturity, process renewals and authorise release.

The product is built around two questions an official asks about every instrument:
1. **How much of this record is proven, and how much is only claimed?** → trust tiers per field.
2. **What is about to go wrong, and who has to act?** → the app clock, rules engine and alerts.

If a feature does not serve one of these, it is low priority.

## Where things are

| Path | What |
|---|---|
| `docs/PROGRESS.md` | **Read first every session.** Which phases are done, deviations, known issues. Update it at the end of every phase. |
| `docs/DECISIONS.md` | Binding design decisions. These override the source PDFs where they differ. |
| `docs/phases/NN-*.md` | One self-contained spec per phase: scope, schema, endpoints, logic, screens, acceptance checks. |
| `docs/spec/*.pdf` / `*.txt` | Original build guide and problem/strategy report. Reference only; the phase files already contain everything needed, corrected. |
| `docs/demo-script.md` | The 8-step judged demo. Every phase must keep it runnable. |
| `docs/seed-spec.md` | The demo dataset (Phase 9). |
| `shared/constants.json` | Statuses, transitions, tracked fields, banks, rule defaults, event labels. One source for Python and the UI. |

## Stack (fixed — do not substitute; DECISIONS D28)

- Monorepo: npm workspaces `shared/`, `frontend/`; Python projects `backend/`, `mock-bank/` sharing one
  dev virtualenv at `.venv/` (`npm run setup:py`).
- **shared**: `shared/constants.json` is the single source of domain constants (roles, statuses,
  allowed transitions, tracked fields, doc types, banks, rule defaults, event labels,
  `institutionVisibleActions`). Python loads it in `backend/app/shared_constants.py` (checked against
  its `Literal` types at import); the UI imports it via `shared/src/constants.ts`, with literal union
  types generated into `shared/src/constants.gen.ts` (`npm run gen:shared`). The rest of `shared/src`
  is UI-only TypeScript: API types, formatting, the live `normAmount` preview. Business logic is
  never duplicated in TypeScript.
- **backend**: Python 3.12, FastAPI + Uvicorn, psycopg 3 + psycopg-pool with raw parameterised SQL
  (no ORM), pydantic v2 for validation, bcrypt, PyJWT, python-multipart, `filetype` (magic bytes),
  APScheduler for the daily job. Package `backend/app`.
- **mock-bank**: tiny FastAPI service (`mock-bank/mock_bank`), own JSON data file.
- **frontend**: React 18 + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS,
  lucide-react icons, recharts for charts.
- **db**: PostgreSQL 16 in Docker. Plain numbered SQL migrations in `backend/app/db/migrations/`.
- **tests**: pytest + FastAPI `TestClient` (httpx) against a real Postgres test database (`fdr_test`).
  No DB mocks. Lint/type check: ruff + mypy (strict) for Python, `tsc` for the frontend.

## Commands (keep these working)

```
docker compose up -d db          # Postgres only (dev)
npm install                      # from repo root, installs the JS workspaces (shared, frontend)
npm run setup:py                 # python3.12 venv at .venv with backend[dev] + mock-bank (editable)
npm run dev                      # uvicorn --reload :3000 (migrates first), mock bank :4000, vite :5173
npm run test                     # pytest (backend + mock bank, uses fdr_test DB) + shared vitest
npm run typecheck                # ruff check/format --check, mypy --strict, tsc for shared + frontend
npm run gen:shared               # after editing shared/constants.json
npm run seed                     # migrations + base dataset (Phase 9: the demo dataset)
npm run db:reset                 # drop + re-create the dev schema
docker compose up --build        # whole system in containers
```
Single test: `cd backend && ../.venv/bin/pytest tests/test_phase02_submission.py -k stale`.

## Architecture rules (non-negotiable)

1. **Layering.** routes → services → repositories. Business rules live only in services.
   Routes parse/validate input and call one service function. Repositories only run SQL.
2. **One clock.** No business code calls `datetime.now()`, `date.today()`, `time.time()` or SQL
   `now()`/`CURRENT_DATE`. Everything reads `clock.now(db)` / `clock.today(db)`
   (`backend/app/domain/clock.py`; UTC `datetime`, millisecond precision).
   This includes `created_at`, `updated_at`, `uploaded_at` — always written explicitly from the
   app clock. The only exceptions: JWT expiry, rate limiting, and the mock bank (an external system).
3. **Dates and money.** Deadline dates (issue, maturity, due) are `DATE`, passed around as
   `'YYYY-MM-DD'` strings (`backend/app/db/pool.py` loads DATE, NUMERIC and UUID as text).
   Event times are `TIMESTAMPTZ`, serialised as `YYYY-MM-DDTHH:MM:SS.sssZ`. Money is `NUMERIC(14,2)`,
   handled as strings — never floats for storage or comparison (compare paise as `int`).
   Business date is computed in `Asia/Kolkata`.
4. **One state machine.** `instruments.status` changes only through `transition()`
   (`backend/app/domain/state_machine.py`), which checks the allowed-transitions table in
   `shared/constants.json` and writes the audit event. Never `UPDATE instruments SET status` anywhere else.
5. **Every state change is a transaction that writes an audit event** via `record_event()`.
   Events are hash-chained from Phase 1 (see DECISIONS D16); `canonical_json` reproduces the original
   JS `JSON.stringify` byte for byte (golden vectors in `backend/tests/fixtures/`).
6. **Verification vs lifecycle.** `status` = where the instrument is in its life.
   `verification_state` = how much is proven. `ACTIVE` means an officer accepted it.
7. **API shape.** Prefix `/api/v1`, JSON, UUID ids, errors always `{ code, message, details }`.
   Domain errors → HTTP: NotFound 404, Forbidden 403, Conflict 409, ValidationFailed 422,
   InvalidTransition 409. Validation errors list **every** failing field in `details`.
8. **Access.** Every endpoint depends on `require_role(...)` (which runs `authenticate`). Institution users can only
   see their own institution's data; for someone else's record return **404, not 403**.
9. **No external calls inside DB transactions** (the mock bank call happens outside, then a
   transaction re-locks and re-checks — DECISIONS D9).
10. **Concurrency.** Mutations load rows with `SELECT ... FOR UPDATE`. Editable records carry an
    integer `version`; clients send it back and a mismatch is a 409.
11. **Configurable, not hard-coded.** Reminder offsets, escalation ladder, required documents,
    release conditions, approval levels and risk weights all live in the `rules` table and are
    read at the start of each operation.
12. **Software supports officials, never replaces them.** Nothing auto-approves a release or
    auto-accepts an instrument. UI copy says so on decision screens.

## Coding conventions

- Python: mypy `--strict` and ruff clean. No `Any` in services; type hints on every function
  (`TypedDict` for rows and API shapes, `Literal` for enums from `shared_constants.py`).
- Validation: pydantic v2 models in `backend/app/schemas.py` (camelCase aliases, `mode="before"`
  validators raising `fail(message)`); routes call `parse(Model, data)` from
  `middleware/validate.py`, which lists every failing field. Unhandled exceptions → 500 `INTERNAL`.
- Routes return `json_response(...)` (Express-identical JSON); sync `def` endpoints, `async` only
  for multipart uploads. DB access is synchronous psycopg; `with transaction() as tx:` for writes.
- Audit action names are verb-style SCREAMING_SNAKE (`INSTRUMENT_SUBMITTED`, `STATUS_ACTIVE`,
  `VERIFICATION_RESULT`). Labels for humans live in one map (`shared/constants.json` → `eventLabels`).
- SQL in repositories, parameterised (`$1`, translated by `db/pool.py`; literal `%` is fine),
  never string-concatenated user input.
- Set-based SQL in the evaluation job; indexes on `status`, `maturity_date`.
- File storage: `STORAGE_DIR/<instrumentId>/<uuid>.<ext>`; never use the original filename in a path.
- Frontend: TanStack Query for all server state; one `api` client that attaches the token and
  throws typed `ApiError`s. Show server `details` next to the exact form fields.
- UI: status and trust are never shown by colour alone — always icon + text label.
- Keep components small; shared UI lives in `frontend/src/components/`.

## How to work on this repo

- **One phase per session.** Use the `/phase NN` command. Start in plan mode, show the plan,
  wait for approval, then build.
- Before building, read `docs/PROGRESS.md`, `docs/DECISIONS.md` and the phase file. Do not
  re-read the PDFs unless the phase file is unclear.
- Every "Acceptance check" in a phase file becomes an automated test in
  `backend/tests/test_phaseNN_*.py` (or a frontend check described in the file). A phase is done
  only when `npm run test` and `npm run typecheck` pass.
- Do not start the next phase. Do not refactor earlier phases unless the current phase needs it;
  if you do, say so in PROGRESS.md.
- If the spec is ambiguous or contradicts DECISIONS.md, follow DECISIONS.md; if neither covers
  it, choose the simplest option that keeps the demo script working and record it in
  PROGRESS.md under "Deviations / choices".
- End every phase by: updating `docs/PROGRESS.md`, then `git add -A && git commit -m "phase NN: <summary>"`.
- Never commit `.env`, uploaded files, `node_modules` or `.venv`.

## Phase files written for TypeScript

The phase files predate D28. Read their TypeScript names as the Python equivalents:
- `.ts` files map to snake_case `.py` files under `backend/app/`: `src/domain/stateMachine.ts` →
  `app/domain/state_machine.py`, `services/instrumentService.ts` → `services/instrument_service.py`,
  `repositories/eventRepo.ts` → `repositories/event_repo.py`, `jobs/evaluate.ts` → `jobs/evaluate.py`.
- Functions become snake_case (`recordEvent` → `record_event`, `findGaps` → `find_gaps`); API JSON
  keeps camelCase.
- zod schema → pydantic model in `schemas.py`; Express router → FastAPI `APIRouter`; middleware →
  dependency; `pg` → psycopg; node-cron → APScheduler; multer → python-multipart; file-type →
  `filetype`; vitest/supertest → pytest/`TestClient`; `phaseNN.x.test.ts` → `tests/test_phaseNN_x.py`.
- Constants a phase adds to `shared/src/*.ts` go into `shared/constants.json` (then `npm run gen:shared`).

## Roles (demo users are created by the seed)

| Role | Does |
|---|---|
| `institution` | Submits instruments, uploads documents and renewals, requests release, sees own status |
| `officer` | Scrutiny: verifies with bank, records observations, resolves discrepancies, recommends release |
| `approver` | Competent authority: decides releases, receives escalations |
| `admin` | Users, rules, app clock, demo tools, outbox |
| `auditor` | Read-only: audit trail with integrity check, reports, dashboard |

## Lifecycle statuses

`DRAFT → SUBMITTED → UNDER_SCRUTINY → ACTIVE → EXPIRING → MATURED → LAPSED`, plus
`RETURNED`, `RENEWED` (terminal, replaced by a successor), `RELEASE_REQUESTED`, `RELEASED` (terminal).
The allowed-transitions table is in `docs/phases/01-foundation.md` and `shared/`.
