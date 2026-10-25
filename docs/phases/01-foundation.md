# Phase 01 — Foundation

**Goal:** data model, authentication, roles, the app clock, the state machine and the
hash-chained audit hook. Every later phase builds on these.

Run with: `/phase 01`

## 1.1 Migration `001_init.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('institution','officer','approver','admin','auditor');
CREATE TYPE instrument_type AS ENUM ('FDR','SECURITY_DEPOSIT');
CREATE TYPE instrument_status AS ENUM (
  'DRAFT','SUBMITTED','UNDER_SCRUTINY','RETURNED','ACTIVE','EXPIRING',
  'MATURED','RENEWED','LAPSED','RELEASE_REQUESTED','RELEASED');
CREATE TYPE trust_tier AS ENUM ('CLAIMED','DOCUMENT','BANK_CONFIRMED');
CREATE TYPE verification_state AS ENUM ('UNVERIFIED','PENDING','CONFIRMED','MISMATCH','UNAVAILABLE'); -- D12

CREATE TABLE institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aicte_id text UNIQUE NOT NULL,          -- e.g. 1-1234567890
  name text NOT NULL,
  region text NOT NULL,                   -- AICTE regional office: Southern, Northern, Western, Eastern, Central, South-Central, North-West, South-West
  state text NOT NULL,
  contact_email text
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  institution_id uuid REFERENCES institutions(id),
  designation text,                       -- e.g. 'Scrutiny Officer, Southern Region'
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  CHECK ((role = 'institution') = (institution_id IS NOT NULL))
);

CREATE TABLE instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id),
  type instrument_type NOT NULL,
  reference_no text,                      -- nullable while DRAFT; required at submit
  issuing_bank text,
  branch text,
  amount numeric(14,2) CHECK (amount IS NULL OR amount > 0),
  issue_date date,
  maturity_date date,
  beneficiary_name text,
  lien_marked boolean NOT NULL DEFAULT false,               -- D8
  purpose text,                                             -- e.g. 'Security deposit for approval of new institution, AY 2026-27'
  status instrument_status NOT NULL DEFAULT 'DRAFT',
  status_before_release instrument_status,
  verification_state verification_state NOT NULL DEFAULT 'UNVERIFIED',
  accepted_with_override boolean NOT NULL DEFAULT false,    -- D13
  override_note text,
  assigned_officer_id uuid REFERENCES users(id),
  parent_instrument_id uuid REFERENCES instruments(id),
  submitted_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  version int NOT NULL DEFAULT 1,                           -- D10
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (maturity_date IS NULL OR issue_date IS NULL OR maturity_date > issue_date)
);
-- No UNIQUE(issuing_bank, reference_no): see D7 (service rule).

CREATE TABLE field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  field_name text NOT NULL,      -- one of the 7 tracked fields (D8)
  value text NOT NULL,           -- normalised string form
  tier trust_tier NOT NULL DEFAULT 'CLAIMED',
  source text,                   -- 'institution' | 'document:<docId>' | 'bank:<response_id>'
  updated_at timestamptz NOT NULL,
  UNIQUE (instrument_id, field_name)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  doc_type text NOT NULL,        -- FDR_COPY | BANK_LETTER | DEPOSIT_CONFIRMATION | LIEN_LETTER | RELEASE_LETTER | COMPLIANCE_CERTIFICATE | OTHER
  filename text NOT NULL,        -- sanitised original name, display only
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL,
  deleted_at timestamptz,        -- D15
  deleted_by uuid REFERENCES users(id)
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  actor_label text NOT NULL,     -- user name, or 'system'
  action text NOT NULL,
  entity_type text NOT NULL,     -- instrument | document | verification | discrepancy | observation | alert | release_request | rule | user | clock | demo
  entity_id uuid NOT NULL,
  instrument_id uuid,            -- denormalised: the instrument this event concerns, if any (makes the passport timeline one query)
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL,
  prev_hash text,
  hash text NOT NULL
);

-- D16: append-only unless the DEMO_MODE tamper tool explicitly allows it in its own transaction
CREATE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('fdr.allow_tamper', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'events table is append-only';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER events_no_update BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();
-- (TRUNCATE in tests/demo reset is allowed: row triggers do not fire on TRUNCATE.)

CREATE TABLE app_clock (
  id int PRIMARY KEY CHECK (id = 1),
  mode text NOT NULL DEFAULT 'REAL' CHECK (mode IN ('REAL','SIMULATED')),
  simulated_now timestamptz
);
INSERT INTO app_clock (id) VALUES (1);

-- The rules table lives here (not 002) so every phase can rely on it.
CREATE TABLE rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,      -- stable lookup key, e.g. 'required_docs'
  name text NOT NULL,
  type text NOT NULL,            -- required_docs | lien_required | reminder | pending_verification | discrepancy_open | overdue_renewal | release_pending | escalation | release_conditions | approval_levels | risk_weights | improvement_baseline
  config jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz,
  updated_by uuid REFERENCES users(id)
);

CREATE INDEX ON instruments (institution_id);
CREATE INDEX ON instruments (status);
CREATE INDEX ON instruments (maturity_date);
CREATE INDEX ON instruments (parent_instrument_id);
CREATE INDEX ON instruments (issuing_bank, reference_no);
CREATE INDEX ON events (entity_type, entity_id);
CREATE INDEX ON events (instrument_id);
CREATE INDEX ON documents (instrument_id);
```

Insert the rules every later phase needs, in `001` or a `001b_rules.sql` (the admin screen in
Phase 8 edits them; defaults must be restorable — keep the defaults also in `shared/src/ruleDefaults.ts`):

| key | type | config |
|---|---|---|
| `required_docs` | required_docs | `{"FDR":["FDR_COPY","BANK_LETTER"],"SECURITY_DEPOSIT":["DEPOSIT_CONFIRMATION"]}` |
| `lien_required` | lien_required | `{"FDR":true,"SECURITY_DEPOSIT":false}` |
| others | — | added by Phases 4, 6, 7 in their migrations |

## 1.2 shared/

- `enums.ts`: roles, instrument types, statuses, trust tiers, verification states, doc types.
- `fields.ts`: `TRACKED_FIELDS = ['reference_no','issuing_bank','amount','issue_date','maturity_date','beneficiary_name','lien_marked'] as const` with display labels.
- `transitions.ts`:

```ts
export const ALLOWED: Record<Status, Status[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_SCRUTINY', 'RETURNED'],
  UNDER_SCRUTINY: ['ACTIVE', 'RETURNED'],
  RETURNED: ['SUBMITTED'],
  ACTIVE: ['EXPIRING', 'RELEASE_REQUESTED'],
  EXPIRING: ['MATURED', 'RENEWED', 'RELEASE_REQUESTED'],
  MATURED: ['RENEWED', 'LAPSED', 'RELEASE_REQUESTED'],
  LAPSED: ['RENEWED', 'RELEASE_REQUESTED'],
  RELEASE_REQUESTED: ['RELEASED', 'ACTIVE', 'EXPIRING', 'MATURED', 'LAPSED'],
  RENEWED: [],
  RELEASED: [],
};
export const LIVE_STATUSES = ['ACTIVE','EXPIRING','MATURED','LAPSED','RELEASE_REQUESTED'];
export const TERMINAL_STATUSES = ['RENEWED','RELEASED'];
```

- `canonicalJson.ts`: deterministic stringify with recursively sorted keys (D16).
- `normalize.ts`: `normAmount('25,00,000') → '2500000.00'`, `normDate → 'YYYY-MM-DD'`,
  `normName` (uppercase, trim, collapse spaces, strip `.` and `,`), `normRef` (uppercase, strip
  spaces), `normBool` → `'true'|'false'`. Unit-test each.
- `banks.ts`: the bank list (shared with mock bank and the form dropdown):
  State Bank of India, Punjab National Bank, Bank of Baroda, Canara Bank, Union Bank of India,
  HDFC Bank, ICICI Bank, Axis Bank, Bank of India, Indian Overseas Bank, Kotak Mahindra Bank.

## 1.3 The app clock (`backend/src/domain/clock.ts`)

```ts
export async function now(db: Db): Promise<Date>        // SIMULATED ? simulated_now : new Date()
export async function today(db: Db): Promise<string>    // 'YYYY-MM-DD' in Asia/Kolkata
export async function setSimulated(db: Db, date: string) // sets simulated_now = date at 10:00 IST
export async function advanceDays(db: Db, n: number)    // from current now(); switches to SIMULATED
export async function resetToReal(db: Db)
export function daysBetween(a: string, b: string): number // calendar days, b - a
```

Endpoints:
- `GET /clock` (any authenticated role) → `{ mode, now, today }` — everyone sees the simulated date badge.
- `POST /clock/advance {days: 1..730}`, `POST /clock/set {date}`, `POST /clock/reset` (admin only).
  Each writes `CLOCK_ADVANCED` / `CLOCK_SET` / `CLOCK_RESET` (entity_type `clock`, entity_id the
  nil UUID). Moving backwards is allowed and returns `warning: 'CLOCK_MOVED_BACKWARDS'`.
  Phase 4 makes these call the evaluation job and return its summary.

## 1.4 Audit hook (`backend/src/domain/audit.ts`) — hash-chained (D16)

```ts
export async function recordEvent(tx: PoolClient, e: {
  actor: { id?: string; label: string };   // automatic actions: { label: 'system' }
  action: string;                          // INSTRUMENT_SUBMITTED, STATUS_ACTIVE, ...
  entityType: string; entityId: string;
  instrumentId?: string;
  before?: unknown; after?: unknown;
}): Promise<void>
```
Steps: `pg_advisory_xact_lock(7001)` → read last `hash` (by id desc) → `nextval('events_id_seq')`
→ `created_at = clock.now(tx)` → compute hash (sha256 hex of `prev ?? 'GENESIS'` + `'|'` +
`canonicalJson({ id, actor_id, actor_label, action, entity_type, entity_id, instrument_id, before_json, after_json, created_at: iso })`)
→ insert with explicit id. Also export `verifyChain(db): Promise<{ ok, checked, firstBrokenId }>`
(used in Phase 8, write and test it now).

## 1.5 State machine (`backend/src/domain/stateMachine.ts`)

```ts
export async function transition(tx, inst: { id; status; version }, to: Status, actor, extra?: object): Promise<void>
```
- Throws `InvalidTransition(from, to)` (409, code `INVALID_TRANSITION`) if not allowed.
- `UPDATE instruments SET status=$1, version=version+1, updated_at=$clockNow WHERE id=$2 AND status=$from`
  — if 0 rows updated, someone changed it concurrently → Conflict.
- When entering `RELEASE_REQUESTED`, also store `status_before_release = from` (same UPDATE).
- Records `STATUS_<TO>` with `before {status}`, `after {status, ...extra}`, `instrumentId`.
- Lint rule by convention: grep in a test that no file except `stateMachine.ts` contains `SET status`
  for instruments (cheap guard; implement as a test reading source files).

## 1.6 Authentication and access

- `POST /auth/login {email, password}` → `{ token, user: { id, name, email, role, institutionId, institutionName, designation } }`.
  bcrypt compare. JWT (8 h) with `sub`, `role`, `institutionId`. Wrong credentials → 401
  `INVALID_CREDENTIALS` (same message for unknown email and wrong password).
- Rate limit login: 5 attempts per minute per IP+email (express-rate-limit, custom key) → 429.
- `GET /auth/me` → current user.
- `authenticate` verifies JWT and loads the user (must be `active`) on every request.
- `requireRole(...roles)` → 403 `FORBIDDEN`.
- `assertCanSee(user, instrument)`: institution users get **404** for other institutions' records.
  Also `scopeInstrumentsQuery(user)` helper that adds `institution_id = $n` for institution users.
- `GET /demo/users` (only when `DEMO_MODE=true`, unauthenticated) → list of demo users
  `{ email, name, role, institutionName }` for the login page quick buttons. Demo password for all
  seeded users: `Demo@123`.

Dev seed (`backend/src/seed/base.ts`, run by tests' helpers and `npm run seed`):
- Institutions: at least 2 (e.g. "Vasavi College of Engineering, Hyderabad" South-Central/Telangana;
  "Sri Venkateswara Institute of Technology, Tirupati" Southern/Andhra Pradesh).
- Users: `inst1@demo.in` (institution 1), `inst2@demo.in` (institution 2), `officer@demo.in`,
  `officer2@demo.in`, `approver@demo.in`, `admin@demo.in`, `auditor@demo.in`; realistic names and designations.

## 1.7 Frontend foundation

- `AuthContext`: token + user in `sessionStorage`; `login()`, `logout()`; redirect to `/login` on 401.
- `ProtectedRoute roles={[...]}`.
- Login page: email/password form with field errors; in demo mode a row of "Sign in as" buttons
  (Institution 1, Institution 2, Officer, Approver, Admin, Auditor).
- Role homes (placeholders): `/institution`, `/officer`, `/approver`, `/admin`, `/auditor`;
  after login redirect by role.
- Header: product name "FDR Portal — AICTE", user name + role chip, logout, and a clock badge:
  `SIMULATED · 12 Dec 2026` (amber) when the clock is simulated, otherwise today's date.
  Admins get +1 / +7 / +30 day buttons, "Set date" and "Reset" (results toast for now).
- Sidebar entries depend on role (`lib/nav.ts`), using the routes later phases will fill.

## Acceptance checks

1. Login succeeds with correct credentials and fails with 401 for a wrong password and an unknown email (same message).
2. The 6th login attempt within a minute for the same email+IP returns 429.
3. An institution user fetching another institution's instrument gets 404; an officer gets 200
   (insert an instrument directly via the repository and expose a minimal `GET /instruments/:id` now).
4. `transition()` rejects DRAFT → ACTIVE with 409 `INVALID_TRANSITION` and writes no event; DRAFT → SUBMITTED updates status, bumps `version` and writes exactly one `STATUS_SUBMITTED` event.
5. Entering RELEASE_REQUESTED stores `status_before_release`.
6. `POST /clock/advance {days: 10}` changes `today()` by 10 and writes a `CLOCK_ADVANCED` event; non-admins get 403; `POST /clock/reset` returns to real time.
7. Hash chain: after several events `verifyChain` returns `ok: true`; altering one event row (in the test, inside a transaction with `SET LOCAL fdr.allow_tamper = 'on'`) makes it return `ok: false` with that id as `firstBrokenId`.
8. A plain `UPDATE events ...` without the setting fails (append-only trigger).
9. Normalisers in `shared` have unit tests (amount with commas/₹, names with dots, refs with spaces).
10. Source guard test: only `stateMachine.ts` updates `instruments.status`.
11. UI: each demo user can log in with a quick button and lands on its role home; the clock badge shows.
