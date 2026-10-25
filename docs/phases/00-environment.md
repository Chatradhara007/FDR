# Phase 00 — Environment and skeleton

**Goal:** one command starts the whole system, every piece reaches the others, tests run against a
real database, and the UI shell has its design system in place.

Run with: `/phase 00`

## 0.1 Repository layout (npm workspaces)

```
/                       package.json (workspaces: shared, backend, mock-bank, frontend), tsconfig.base.json
shared/src/             index.ts, enums.ts, transitions.ts, fields.ts, normalize.ts, schemas.ts, eventLabels.ts, banks.ts
backend/src/
  app.ts  server.ts
  db/          pool.ts  migrate.ts  migrations/001_init.sql ...
  domain/      clock.ts  stateMachine.ts  audit.ts  errors.ts  gaps.ts ...
  middleware/  authenticate.ts  requireRole.ts  validate.ts  requestId.ts  errorHandler.ts
  repositories/  services/  routes/  jobs/  seed/
backend/tests/  helpers.ts  phase00.health.test.ts ...
mock-bank/src/  index.ts   mock-bank/data/
frontend/src/   main.tsx  App.tsx  api/  auth/  components/  pages/  hooks/  lib/
docker/db-init/01-test-db.sql   (already present)
```

Root scripts (`package.json`):
- `dev`: `concurrently` runs backend (`tsx watch`), mock-bank (`tsx watch`) and frontend (`vite`).
- `test`: runs vitest in `shared` and `backend`.
- `typecheck`: `tsc --noEmit -p` for each workspace.
- `seed`: `npm run seed -w backend` (stub now, real in Phase 9).
- `db:reset`: drops and recreates the dev schema, then migrates.

`shared` is consumed as TypeScript source (`"main": "src/index.ts"`) by backend (via tsx) and
frontend (via Vite alias/paths). No separate build step.

## 0.2 Docker

`docker-compose.yml` and `.env.example` are already in the repo; create:
- `backend/Dockerfile`, `mock-bank/Dockerfile`, `frontend/Dockerfile` (node:22-alpine; install
  workspaces from the repo root context; backend runs `tsx src/server.ts`; frontend runs
  `vite --host 0.0.0.0`).
- The backend waits for the DB (retry connect up to 30 s), runs migrations on start-up, then listens.

## 0.3 Backend skeleton

- `db/pool.ts`: one `pg.Pool` from `DATABASE_URL`. Set type parsers: DATE (1082) → string,
  INT8 (20) → number, NUMERIC (1700) → string (default). Export:
  - `type Db = Pool | PoolClient`
  - `many<T>(db, sql, params)`, `one<T>(db, sql, params)` (throws NotFound if none),
    `maybeOne<T>(...)`, `exec(db, sql, params)`
  - `withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T>` — BEGIN/COMMIT/ROLLBACK, always releases.
- `db/migrate.ts`: table `schema_migrations(name text primary key, applied_at timestamptz)`;
  applies `migrations/*.sql` in filename order, each in its own transaction. Runs on start-up and
  from tests.
- `domain/errors.ts`: `AppError(code, message, details?, httpStatus)` and subclasses `NotFound`,
  `Forbidden`, `Conflict`, `ValidationFailed`, `InvalidTransition`, `Unauthorized`.
- Middleware: `requestId` (sets `X-Request-Id`), `authenticate`, `requireRole(...roles)`,
  `validate({ body?, query?, params? })` (zod → `ValidationFailed` with one `details` entry per
  issue: `{ field, message }`), `errorHandler` (AppError → status + `{ code, message, details }`;
  anything else → 500 `{ code: 'INTERNAL', message: 'Unexpected error', details: { requestId } }`,
  logged with stack).
- `app.ts` exports `createApp()` (no listen) so tests use supertest on it. `server.ts` migrates and listens.
- `GET /api/v1/health` → `{ status: 'ok', db: 'up'|'down', mockBank: 'up'|'down', time }`.
- CORS allowed for the frontend origin.

## 0.4 Test harness

- Vitest in backend; `tests/helpers.ts`:
  - uses `TEST_DATABASE_URL`; before all: drop schema `public` cascade, recreate, run migrations;
  - `resetDb()` truncates all tables (except `schema_migrations`) and re-inserts fixed rows
    (e.g. `app_clock` row);
  - `api()` returns a supertest agent on `createApp()`; later phases add `loginAs(role)`.
- Tests run serially (`pool: 'forks'`, `singleFork`/`fileParallelism: false`) because they share one DB.

## 0.5 Mock bank skeleton

Express on `MOCK_BANK_PORT`: `GET /health` → `{ status: 'ok' }`. (Real behaviour in Phase 3.)

## 0.6 Frontend skeleton and design system

Vite + React + TS + Tailwind + React Router + TanStack Query + lucide-react.

- `api/client.ts`: `apiFetch(path, { method, body, signal })` → prefixes `VITE_API_URL`, attaches
  `Authorization: Bearer <token>` if present, parses JSON, throws `ApiError { status, code, message,
  details }` on non-2xx. On 401 it clears auth and redirects to `/login`. Supports `FormData` bodies
  and blob downloads (`apiDownload`).
- `components/Layout.tsx`: left sidebar + top header + content. Sidebar entries come from a
  role → nav config (`lib/nav.ts`); empty for now except Home.
- Home page shows the health response (db / mock bank up or down).

**Design direction** (apply from day one so the UI is consistent across phases):
- Audience: government officials using it all day. Calm, dense, trustworthy — closer to a good
  banking back-office than a startup landing page. No gradients, no glassmorphism.
- Palette: deep navy primary (`#1f3a5f`-ish), neutral slate greys, white surfaces; semantic colours
  only for meaning: green = bank-confirmed/healthy, amber = expiring/attention, red = discrepancy/
  lapsed/blocked, blue = info/in progress, grey = draft/claimed. Define them once as Tailwind theme
  tokens.
- Typography: Inter (or system UI), tabular numbers for amounts and dates (`tabular-nums`).
- Amounts formatted in Indian style with ₹ (`₹25,00,000.00`, plus a compact form `₹25 L`, `₹1.2 Cr`).
  Dates shown as `31 Mar 2027`.
- Components to create now (used by every later phase): `Button`, `Card`, `Badge`, `StatusChip`
  (icon + label per lifecycle status), `Table` (sortable header, empty state, loading skeleton),
  `PageHeader` (title, subtitle, actions), `EmptyState`, `Modal`, `Toast` (simple context),
  `FieldError`, `Tabs`, `Money`, `DateText`, `KeyValue`.
- Accessibility: visible focus rings, labels on every input, colour never the only signal.

## Acceptance checks

1. `docker compose up --build` starts db, mock-bank, backend and frontend; the frontend home shows
   "Database: up, Mock bank: up". (Manual check — note the result in PROGRESS.md.)
2. `npm run dev` with only `docker compose up -d db` running works the same way.
3. Test: `GET /api/v1/health` returns 200 with `db: 'up'`.
4. Test: an unknown route returns 404 shaped `{ code, message, details }`.
5. Test: a route that throws a plain `Error` returns 500 with `code: 'INTERNAL'` and a request id.
6. Test: `validate()` returns 422 listing every failing field (use a throwaway test route mounted only in tests).
7. `npm run typecheck` passes in all four workspaces.
