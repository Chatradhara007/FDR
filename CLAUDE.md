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

## Stack (fixed — do not substitute)

- npm workspaces monorepo: `shared/`, `backend/`, `mock-bank/`, `frontend/`.
- **shared**: TypeScript enums, types, zod schemas and pure functions used by both sides
  (statuses, transitions table, field list, normalisers, validation schemas).
- **backend**: Node 22, TypeScript, Express 4, `pg` (node-postgres, no ORM), zod, bcryptjs,
  jsonwebtoken, multer, file-type, node-cron. Run with `tsx` (no build step needed in dev).
- **mock-bank**: tiny Express service, own JSON data file.
- **frontend**: React 18 + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS,
  lucide-react icons, recharts for charts.
- **db**: PostgreSQL 16 in Docker. Plain numbered SQL migrations.
- **tests**: Vitest + supertest against a real Postgres test database (`fdr_test`). No DB mocks.

## Commands (keep these working)

```
docker compose up -d db          # Postgres only (dev)
npm install                      # from repo root, installs all workspaces
npm run dev                      # backend :3000, mock-bank :4000, frontend :5173 (concurrently)
npm run test                     # backend + shared tests (uses fdr_test DB)
npm run typecheck                # tsc --noEmit in every workspace
npm run seed                     # Phase 9: load the demo dataset
docker compose up --build        # whole system in containers
```

## Architecture rules (non-negotiable)

1. **Layering.** routes → services → repositories. Business rules live only in services.
   Routes parse/validate input and call one service function. Repositories only run SQL.
2. **One clock.** No business code calls `new Date()`, `Date.now()` or SQL `now()`/`CURRENT_DATE`.
   Everything reads `clock.now(db)` / `clock.today(db)` (`backend/src/domain/clock.ts`).
   This includes `created_at`, `updated_at`, `uploaded_at` — always written explicitly from the
   app clock. The only exceptions: JWT expiry, rate limiting, and the mock bank (an external system).
3. **Dates and money.** Deadline dates (issue, maturity, due) are `DATE`, passed around as
   `'YYYY-MM-DD'` strings (configure the pg type parser for OID 1082 to return strings).
   Event times are `TIMESTAMPTZ`. Money is `NUMERIC(14,2)`, handled as strings — never JS floats
   for storage or comparison. Business date is computed in `Asia/Kolkata`.
4. **One state machine.** `instruments.status` changes only through `transition()`
   (`backend/src/domain/stateMachine.ts`), which checks the allowed-transitions table in
   `shared/` and writes the audit event. Never `UPDATE instruments SET status` anywhere else.
5. **Every state change is a transaction that writes an audit event** via `recordEvent()`.
   Events are hash-chained from Phase 1 (see DECISIONS D16).
6. **Verification vs lifecycle.** `status` = where the instrument is in its life.
   `verification_state` = how much is proven. `ACTIVE` means an officer accepted it.
7. **API shape.** Prefix `/api/v1`, JSON, UUID ids, errors always `{ code, message, details }`.
   Domain errors → HTTP: NotFound 404, Forbidden 403, Conflict 409, ValidationFailed 422,
   InvalidTransition 409. Validation errors list **every** failing field in `details`.
8. **Access.** Every endpoint has `authenticate` + `requireRole(...)`. Institution users can only
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

- TypeScript `strict`. No `any` in services; explicit return types on exported functions.
- Audit action names are verb-style SCREAMING_SNAKE (`INSTRUMENT_SUBMITTED`, `STATUS_ACTIVE`,
  `VERIFICATION_RESULT`). Labels for humans live in one map (`shared/src/eventLabels.ts`).
- SQL in repositories, parameterised (`$1`), never string-concatenated user input.
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
  `backend/tests/phaseNN.*.test.ts` (or a frontend check described in the file). A phase is done
  only when `npm run test` and `npm run typecheck` pass.
- Do not start the next phase. Do not refactor earlier phases unless the current phase needs it;
  if you do, say so in PROGRESS.md.
- If the spec is ambiguous or contradicts DECISIONS.md, follow DECISIONS.md; if neither covers
  it, choose the simplest option that keeps the demo script working and record it in
  PROGRESS.md under "Deviations / choices".
- End every phase by: updating `docs/PROGRESS.md`, then `git add -A && git commit -m "phase NN: <summary>"`.
- Never commit `.env`, uploaded files, or `node_modules`.

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
