# Phase 04 — Rules engine, alerts and escalation

**Goal:** the system watches dates and states, creates alerts, escalates what is ignored, and closes
alerts that no longer apply. It behaves identically whether time passes for real or the clock is
advanced by hand. Covers requirements #4 (validity/maturity tracking) and #7 (alerts and escalation),
and powers the demo's "fast-forward" moment.

Run with: `/phase 04`

## 4.1 Migration `004_alerts.sql`

```sql
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  kind text NOT NULL,              -- MATURITY_REMINDER | PENDING_VERIFICATION | DISCREPANCY_OPEN | OVERDUE_RENEWAL | RELEASE_PENDING
  rule_key text NOT NULL,          -- e.g. 'maturity:30', 'pending_verification', 'overdue_renewal'
  subject_id text NOT NULL DEFAULT '-',  -- D1: discrepancy id / release request id / '-'
  level int NOT NULL DEFAULT 1,    -- escalation level (1 = original)
  root_alert_id uuid,              -- D11: first alert of this escalation chain (self for the first)
  recipient_role user_role NOT NULL,
  recipient_user_id uuid REFERENCES users(id),
  institution_id uuid NOT NULL REFERENCES institutions(id),   -- denormalised for scoping
  due_date date NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',   -- OPEN | ACKNOWLEDGED | ESCALATED | RESOLVED
  resolution text,                       -- SYSTEM_CONDITION_CLEARED | MANUAL | SUPERSEDED
  resolution_note text,
  dedupe_key text NOT NULL UNIQUE,       -- D1: instrument_id|kind|rule_key|subject_id|due_date|level|recipient_role
  created_at timestamptz NOT NULL,
  acknowledged_at timestamptz, acknowledged_by uuid REFERENCES users(id),
  resolved_at timestamptz,     resolved_by uuid REFERENCES users(id)
);
CREATE INDEX alerts_open ON alerts (status, recipient_role);
CREATE INDEX ON alerts (instrument_id);

CREATE TABLE outbox (            -- stand-in for email; visible to admins
  id bigserial PRIMARY KEY,
  alert_id uuid REFERENCES alerts(id),
  to_role user_role, to_user_id uuid, to_institution_id uuid,
  subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL
);
```

Insert these rules (keep defaults in `shared/src/ruleDefaults.ts` too):

```jsonc
// key 'reminder', type 'reminder'
{ "offsets": [
  { "days": 90, "recipients": ["institution","officer"] },
  { "days": 60, "recipients": ["institution","officer"] },
  { "days": 30, "recipients": ["institution","officer"] },
  { "days": 7,  "recipients": ["institution","officer","approver"] } ] }
// key 'pending_verification'
{ "afterDays": 5, "recipients": ["officer"] }
// key 'discrepancy_open'
{ "afterDays": 7, "recipients": ["officer"] }
// key 'overdue_renewal'
{ "graceDays": 15, "recipients": ["institution","officer","approver"] }
// key 'release_pending'   (used from Phase 6)
{ "afterDays": 5, "recipients": ["approver"] }
// key 'escalation'  (D11)
{ "levels": [ { "level": 1, "role": "officer",  "afterDays": 0 },
              { "level": 2, "role": "approver", "afterDays": 7 },
              { "level": 3, "role": "admin",    "afterDays": 14 } ],
  "kinds": ["PENDING_VERIFICATION","DISCREPANCY_OPEN","OVERDUE_RENEWAL","RELEASE_PENDING"] }
```

Rules are read at the start of each run, so editing them (Phase 8) takes effect on the next run.
Validate each rule's config with a zod schema in `shared` (reused by the Phase 8 editor).

## 4.2 The evaluation job (`backend/src/jobs/evaluate.ts`)

`evaluate(tx, asOf: string): Promise<Summary>` runs in **one** transaction guarded by
`SELECT pg_advisory_xact_lock(42)`. `asOf` is `clock.today()`. Steps run in this order:

**Step 1 — status sweeps**, applied one after another so a large clock jump cascades correctly
(ACTIVE → EXPIRING → MATURED → LAPSED in one run):
1. ACTIVE → EXPIRING when `maturity_date - asOf <= max(reminder offsets)` (90 by default).
2. EXPIRING → MATURED when `maturity_date <= asOf`.
3. MATURED → LAPSED when `asOf > maturity_date + graceDays` and **no submitted successor exists**
   (a successor whose status is not DRAFT; an untouched draft does not prevent lapse).
Each change goes through `transition()` with actor `system`. Not swept: DRAFT, SUBMITTED,
UNDER_SCRUTINY, RETURNED, RENEWED, RELEASE_REQUESTED, RELEASED.
Implement as `sweepInstrument(tx, inst, asOf, rules)` (D20) used both by the job (over a set-based
candidate query) and by targeted calls.

**Step 2 — maturity reminders** for instruments in ACTIVE or EXPIRING:
`daysLeft = maturity_date - asOf`. Find the tightest offset already crossed
(smallest `offset.days` with `daysLeft <= offset.days`). For it, create one alert per recipient role
(`rule_key 'maturity:<days>'`, `due_date = maturity_date`, level 1). Then **D2**: for every looser
offset, (a) update any existing OPEN/ACKNOWLEDGED/ESCALATED alert of that offset to RESOLVED/SUPERSEDED,
and (b) insert the missing ones as already RESOLVED/SUPERSEDED (no outbox row). A jump from day 100 to
day 10 therefore yields one live reminder per role. Message example:
`FDR CNRB-0042 (₹25 L, Canara Bank) matures on 31 Mar 2027 — 30 days left. Arrange renewal or release.`

**Step 3 — process alerts:**
- `PENDING_VERIFICATION`: SUBMITTED or UNDER_SCRUTINY with `verification_state` in (UNVERIFIED,
  PENDING, UNAVAILABLE) and `asOf - date(submitted_at IST) >= afterDays`. `due_date = submitted date + afterDays`.
- `DISCREPANCY_OPEN`: each OPEN discrepancy older than `afterDays` (`subject_id` = discrepancy id).
- `OVERDUE_RENEWAL`: MATURED or LAPSED instruments with no successor in ACTIVE (i.e. not yet renewed).
  `due_date = maturity_date + graceDays`. Message distinguishes "matured, grace ends <date>" from "lapsed".
- `RELEASE_PENDING`: implemented in Phase 6 (leave a registered no-op kind handler now).

**Step 4 — escalation (D11):** for each OPEN or ACKNOWLEDGED alert whose kind is in
`escalation.kinds` **and** whose `recipient_role` equals the role of its current level in the ladder
(so institution-facing copies never escalate), compute `age = asOf - date(root.created_at)`. While the
next level exists and `age >= next.afterDays`: insert the next-level alert (same instrument, kind,
rule_key, subject, `root_alert_id`, recipient = next role, level+1, new dedupe key), set the current
one to ESCALATED, write `ALERT_ESCALATED`. A big jump may climb several levels in one run.

**Step 5 — auto-resolution:** each kind has `stillRelevant(alert, state)`. Close every OPEN,
ACKNOWLEDGED **or ESCALATED** alert whose condition no longer holds with
`resolution = 'SYSTEM_CONDITION_CLEARED'` and an `ALERT_RESOLVED` event:
- MATURITY_REMINDER: instrument still ACTIVE, EXPIRING or RELEASE_REQUESTED (reminders stay visible during a release request).
- PENDING_VERIFICATION: still SUBMITTED/UNDER_SCRUTINY and not CONFIRMED.
- DISCREPANCY_OPEN: discrepancy still OPEN.
- OVERDUE_RENEWAL: instrument still MATURED or LAPSED.
- RELEASE_PENDING: request still pending.
- Any alert on a RELEASED or RENEWED instrument is cleared.

```ts
export async function evaluate(tx: PoolClient, asOf: string): Promise<Summary> {
  await tx.query('SELECT pg_advisory_xact_lock(42)');
  const rules = await loadRules(tx);
  const s = { asOf, statusChanges: 0, alertsCreated: 0, escalations: 0, resolved: 0, superseded: 0 };
  s.statusChanges += await sweepStatuses(tx, asOf, rules);
  ({ created, superseded } = await maturityReminders(tx, asOf, rules));
  s.alertsCreated += await processAlerts(tx, asOf, rules);
  s.escalations  += await escalate(tx, asOf, rules);
  s.resolved     += await autoResolve(tx, asOf);
  await recordEvent(tx, { actor: { label: 'system' }, action: 'JOB_EVALUATED', entityType: 'job', entityId: NIL_UUID, after: s });
  return s;
}
```
Every insert uses `ON CONFLICT (dedupe_key) DO NOTHING` and counts only rows actually inserted, so a
second run on the same date changes nothing and returns zeros (but still logs JOB_EVALUATED — or skip
logging when everything is zero; choose and document).

## 4.3 Recipients and the outbox (D23)

- `officer` → `assigned_officer_id` if set, else pool (`recipient_user_id` null).
- `institution` → visible only to users of that institution (`alerts.institution_id`).
- `approver` / `admin` → role pool.
- For each newly created (not superseded) alert, insert an outbox row with a realistic email subject
  and body (e.g. `[AICTE FDR Portal] Reminder: FDR CNRB-0042 matures in 30 days`). A real mailer can
  replace the insert later without touching anything else.

## 4.4 Scheduling and clock integration

- Real clock: run `evaluate` at start-up and daily at 06:00 IST (node-cron with `timezone: 'Asia/Kolkata'`),
  only when the clock mode is REAL.
- Simulated clock: `POST /clock/advance` and `/clock/set` call `evaluate` immediately after changing
  the clock, in the same request, and return `{ clock, summary }`. `POST /clock/reset` also evaluates.
- `POST /jobs/evaluate` (admin) runs it on demand and returns the summary.
- Fill the Phase 3 `afterAccept` hook with the targeted sweep (D20) so an instrument accepted 40 days
  before maturity becomes EXPIRING immediately.

## 4.5 Alert endpoints

| Method and path | Purpose |
|---|---|
| `GET /alerts` | Filters: `status` (default open = OPEN+ACKNOWLEDGED), `kind`, `instrumentId`, `mine=true` (officer: assigned to me), `level`; scoped by role and institution; joined with instrument ref/bank/amount/institution; paging |
| `GET /alerts/summary` | Open count per kind and per level for the current user, plus `total` for the bell |
| `POST /alerts/:id/acknowledge` | Mark as seen; **does not stop escalation** (on purpose: only fixing the cause or a manual resolution does) |
| `POST /alerts/:id/resolve` | Manual close `{note}` (internal roles only), `resolution = 'MANUAL'` |
| `GET /outbox` | Admin; newest first, paging |

Instrument list/queue endpoints gain `worstOpenAlertLevel` (max level of OPEN/ACK alerts) and
`openAlertCount`.

## 4.6 Frontend

- **Clock widget** (header, admin): persistent amber badge `SIMULATED · 12 Dec 2026` when not real;
  buttons +1 day, +7, +30, +90, "Set date…", "Reset to today". After each change show a toast built
  from the summary — `3 status changes · 14 alerts · 2 escalations · 5 resolved` — and invalidate all
  queries so every open screen refreshes. Moving backwards asks for confirmation.
- **Alerts inbox** `/alerts` (all roles, scoped): grouped by instrument, kind chips with icons,
  level indicator (L1/L2/L3 with "Escalated to approver" wording), due date, age, actions
  Acknowledge / Resolve with note / Open instrument. Tabs: Open, Acknowledged, Resolved.
- **Bell** in the header with the open count from `/alerts/summary` (poll every 30 s and after clock changes).
- **Outbox** page for admins (`/admin/outbox`): table of simulated emails, click to read.
- Instrument tables (institution home, queue, register) show a chip for the worst open alert level.

## 4.7 Edge cases

- Clock moved backwards: allowed with a warning; never deletes alerts; the job only creates and closes.
- Weekends/holidays: calendar days only (D22).
- A renewal accepted in the same run as a sweep must win: the LAPSED sweep checks for a successor,
  and auto-resolution runs last.
- A one-year jump must finish well within the request timeout (D18): set-based candidate queries,
  indexes on `status` and `maturity_date`.

## Acceptance checks

1. Advance 45 days: instruments with maturity within 90 days of the new date become EXPIRING; the right reminder alerts exist (one live per recipient role per instrument); counts in the summary match the DB.
2. Running `evaluate` twice on the same date creates nothing the second time (all counters 0).
3. D2: jump from 100 days before maturity to 10 days before → exactly one live MATURITY_REMINDER per recipient role (`maturity:30`), and the 90/60 ones are SUPERSEDED. Then advance to 5 days before → `maturity:7` alerts live (incl. approver), `maturity:30` ones SUPERSEDED.
4. D1: a 30-day reminder creates both an institution alert and an officer alert (two rows, different dedupe keys).
5. Cascade: an ACTIVE instrument jumped 200 days past maturity ends LAPSED in one run, with three STATUS_ events.
6. LAPSED is not applied when a submitted successor exists; it is applied when only a DRAFT successor exists.
7. Escalation: an unacknowledged PENDING_VERIFICATION alert escalates to approver after 7 days (original ESCALATED, new level-2 alert OPEN) and to admin after 14; acknowledging does not stop it; institution copies of OVERDUE_RENEWAL never escalate.
8. Confirming a verification closes the matching PENDING_VERIFICATION alert (and its escalated copies) on the next run.
9. Manual resolve requires a note and records `MANUAL`.
10. Institution users only see their own institution's institution-role alerts.
11. `POST /clock/advance` returns the summary; non-admins get 403.
12. A 365-day jump on 500 generated instruments completes in under 5 s.
13. UI: clock buttons work, toast shows counts, bell count updates, alerts inbox groups by instrument.
