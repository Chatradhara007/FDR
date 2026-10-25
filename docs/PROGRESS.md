# Build progress

Claude Code updates this file at the end of every phase. Read it first in every session.

| Phase | Title | Status | Commit | Notes |
|---|---|---|---|---|
| 00 | Environment and skeleton | done with known issues | (this commit) | AC1 (docker compose) not run: no Docker in build sandbox |
| 01 | Foundation | not started | | |
| 02 | Submission and documents | not started | | |
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

## Pages added

(append per phase)

**Phase 00**
- `/` Home: system status (API, Database, Mock bank: up/down with icon + label)
- `/login` placeholder (real sign-in in Phase 01)
- Shared components in `frontend/src/components/`: Button, Card, Badge, StatusChip, Table, PageHeader,
  EmptyState, Modal, Toast, FieldError, Tabs, Money, DateText, KeyValue, Layout

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

## Known issues / follow-ups

(things to fix later; mark resolved when fixed)

- Phase 00: frontend image lacked `tsconfig.base.json` (fixed in all three Dockerfiles); `docker compose up --build`
  needs a re-run on a machine with Docker to confirm.
- Phase 01: switch `migrate()`'s `appliedAt` to the app clock; move StatusChip statuses to the shared enum;
  add the `app_clock` row to `insertFixedRows()` in `backend/tests/helpers.ts`.

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
