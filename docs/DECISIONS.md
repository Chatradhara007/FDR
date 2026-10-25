# Binding design decisions

These decisions fix bugs, contradictions and gaps found in the original build guide
(`docs/spec/build-guide.pdf`). Where the PDF and this file disagree, **this file wins**.
The phase files already apply them; this list exists so nothing is "re-fixed" back to the PDF.

---

### D1 — Alert dedupe key includes recipient and subject
PDF key `instrument_id|rule_key|due_date|level` collapses alerts sent to several roles (the
second role's insert is silently dropped) and collapses several discrepancies on one instrument.
**Decision:** `dedupe_key = instrument_id|kind|rule_key|subject_id|due_date|level|recipient_role`
where `subject_id` is the discrepancy id / release request id / `-`.

### D2 — Superseding updates existing open reminders
When a tighter maturity offset is crossed, **existing** OPEN/ACKNOWLEDGED/ESCALATED alerts for
looser offsets of the same instrument are updated to `RESOLVED` with `resolution='SUPERSEDED'`.
Looser offsets that never existed are inserted already-superseded (as in the PDF), so a clock
jump from 100 to 10 days still produces exactly one live reminder per recipient role.

### D3 — Observations can be resolved
`observations` gains `status ('OPEN'|'RESOLVED')`, `resolved_by`, `resolved_at`, `resolution_note`.
Endpoint `POST /observations/:id/resolve {note}` (officer). Accept and release guards look at
OPEN observations with severity `BLOCKING` only.

### D4 — Accept rule
`POST /instruments/:id/accept` succeeds only when **all** hold:
- every required document present (rules `required_docs`),
- no OPEN discrepancy, no OPEN BLOCKING observation,
- lien marked in favour of AICTE when the instrument type requires it (D8),
- `verification_state = 'CONFIRMED'` **or** the officer supplies `overrideNote` (non-empty).
Resolving a discrepancy does **not** by itself make the instrument confirmed. The normal path
after a mismatch is: return to institution → institution corrects → resubmit → re-verify →
CONFIRMED. The override path sets `accepted_with_override = true` and `override_note`, and the
passport shows "Accepted without bank confirmation". (PDF check 3.10 is reworded accordingly.)

### D5 — Submission only resets fields that changed
On submit/resubmit, for each tracked field: if no provenance row exists, insert it as CLAIMED;
if the value differs from the stored provenance value, set value, tier `CLAIMED`, source
`institution`; if unchanged, **keep its tier**. `verification_state` becomes `UNVERIFIED` on first
submission and whenever any field changed; otherwise it is kept.

### D6 — Renewal and release are mutually exclusive
- `POST /instruments/:id/renew` is refused (409) while the instrument has an open release request.
- `POST /instruments/:id/release-requests` is refused (409) while the instrument has a successor
  that is not in a terminal state.
- At child accept, the parent must be in `EXPIRING`, `MATURED` or `LAPSED`; otherwise 409 with a
  readable reason (no half-applied accept).

### D7 — Reference number uniqueness is a service rule
No plain `UNIQUE (issuing_bank, reference_no)`. Service rule at create, edit and submit: conflict
(409) if another instrument with the same bank and normalised reference exists whose status is not
`RENEWED`/`RELEASED`, excluding the instrument itself and its own parent (a bank may renew under the
same number). Drafts can be deleted (`DELETE /instruments/:id` while DRAFT), so an abandoned draft
never blocks anyone.

### D8 — Lien marking is a tracked field
Tracked fields are **seven**: `reference_no, issuing_bank, amount, issue_date, maturity_date,
beneficiary_name, lien_marked` (`lien_marked` stored as `'true'|'false'`). The institution declares
it, the mock bank confirms it, an officer can document-check it. Rule `lien_required` (config
`{ "FDR": true, "SECURITY_DEPOSIT": false }`) makes "lien marked in favour of AICTE" a gap for
`findGaps` and the accept guard.

### D9 — Bank result is applied under lock with a re-check
Bank call happens outside any transaction. Then, inside a transaction: `SELECT ... FOR UPDATE` the
instrument, check status is unchanged (verification is allowed in UNDER_SCRUTINY and, as re-verification, in live statuses) and `version` equals the version used to build the
payload. If not, store the verification with `result='STALE'` and apply nothing; respond 409
"instrument changed during verification, verify again".

### D10 — App clock everywhere; integer version for optimistic locking
No `DEFAULT now()` on business tables; every timestamp is written from the app clock.
`instruments.version int NOT NULL DEFAULT 1`, incremented on every UPDATE (including transitions).
`PATCH` requires `version` in the body; mismatch → 409 `STALE_VERSION`.

### D11 — Escalation is measured from the root alert
Alerts carry `root_alert_id` (self for the first one). Age for escalation = `asOf - root.created_at`
in days. Level thresholds are cumulative from the root (officer 0, approver 7, admin 14).
Escalation applies only to alert kinds listed in the escalation rule's `kinds` (default:
`PENDING_VERIFICATION, DISCREPANCY_OPEN, OVERDUE_RENEWAL, RELEASE_PENDING`; maturity reminders go to
their configured recipients and don't climb). Auto-resolution closes OPEN, ACKNOWLEDGED **and**
ESCALATED alerts whose condition cleared — the whole chain.

### D12 — verification_state is an enum
`CREATE TYPE verification_state AS ENUM ('UNVERIFIED','PENDING','CONFIRMED','MISMATCH','UNAVAILABLE')`.
Verification `result` additionally allows `NOT_FOUND` and `STALE` (stored in `verifications.result`).

### D13 — Override acceptance is a column
`instruments.accepted_with_override boolean NOT NULL DEFAULT false`, `override_note text`.
Release condition `INSTRUMENT_VERIFIED` reads these columns, not the event log.

### D14 — Release request can be cancelled
`POST /release-requests/:id/cancel` (institution, while `PENDING_CONDITIONS` or `RETURNED`):
request → `CANCELLED`, instrument restored from `status_before_release`, then a targeted sweep (D20).

### D15 — Documents are soft-deleted
`documents.deleted_at`, `deleted_by`. Delete hides the document and writes `DOCUMENT_REMOVED`; the
file stays on disk as evidence. Duplicate checksum detection ignores deleted documents.

### D16 — Hash-chained audit log from Phase 1
`recordEvent` takes `pg_advisory_xact_lock(7001)`, reads the last event's `hash`, reserves the id
with `nextval`, and stores
`hash = sha256(prev_hash ?? 'GENESIS' + '|' + canonicalJson({id, actor_id, actor_label, action,
entity_type, entity_id, instrument_id, before_json, after_json, created_at_iso}))`.
`canonicalJson` sorts object keys recursively (JSONB reorders keys, so never hash raw stringify).
`GET /audit/integrity` recomputes the chain and returns `{ ok, checked, firstBrokenId }`.
Events are append-only: no UPDATE/DELETE on `events` in application code (a DB trigger rejects them,
except the DEMO_MODE tamper tool which disables it inside its own transaction — Phase 8).

### D17 — Demo mode
`DEMO_MODE=true` enables: `POST /demo/reset` (admin; reload seed, reset clock), quick user switch on
the login page, `POST /demo/tamper` (admin; alters one event to show integrity failure). All demo
routes 404 when DEMO_MODE is off.

### D18 — Evaluation job scale
Per-row `transition()` calls inside the job are fine (target < 2,000 instruments). Selection of
candidate rows is set-based SQL. A 365-day jump must finish in under 5 seconds on the seed data.

### D19 — Mock bank uses real time for its PENDING delay
The mock bank is an external system; its `retry_after_seconds` uses wall-clock time.

### D20 — Targeted sweep
`sweepInstrument(tx, id, asOf)` applies the same status rules as the job to one instrument. Called
after accept, after release rejection/cancellation restores a status, and after renewal activation,
so screens are correct immediately without waiting for the daily job.

### D21 — Returned release requests are resubmitted explicitly
`POST /release-requests/:id/resubmit {note}` (institution) moves `RETURNED → PENDING_CONDITIONS`;
history stays in `release_approvals` and events.

### D22 — Calendar days only
No business-day or holiday logic anywhere.

### D23 — Alert recipients
`officer` alerts go to `assigned_officer_id` if set, else to the officer pool (`recipient_user_id`
null). `institution` alerts are visible only to users of that instrument's institution.
`approver`/`admin` alerts go to the role pool.

### D24 — What institutions see on the passport
Instrument, own documents, verification outcomes (result + per-field match, not raw payloads),
observations with `visible_to_institution = true`, their alerts, release request status and
remarks addressed to them, and events whose action is in the institution whitelist
(`shared/constants.json` → `institutionVisibleActions`).

### D25 — Submission date rules
At submit: `issue_date <= today`, `maturity_date > issue_date`, `maturity_date >= today`.
At accept, if maturity has already passed the targeted sweep (D20) moves it on immediately.

### D26 — Risk score (Phase 7) and improvement metrics are labelled
Risk weights come from the `risk_weights` rule. All "improvement" figures shown in the UI are
labelled "Simulated on demo data".

### D27 — Separation of duties across every level
In the release chain no user may act at more than one level of the same request.

### D28 — Backend and mock bank are Python (decided after Phase 02)
The backend and the mock bank are Python 3.12 (FastAPI + Uvicorn, psycopg 3 with raw parameterised SQL,
pydantic v2, bcrypt, PyJWT, python-multipart, `filetype` for magic bytes, APScheduler, pytest, ruff, mypy).
The frontend stays React + TypeScript. Phases 00–02 were ported with identical behaviour: same layering,
one clock, one `transition()`, hash-chained events (hashes byte-compatible with the TypeScript version),
unchanged SQL migrations and the same API contract. Shared constants live in `shared/constants.json`
(read by Python at startup, imported by the frontend). **Where a phase file names a TypeScript stack piece
or a `.ts` file, use the Python equivalent** (see CLAUDE.md, "Phase files written for TypeScript").


### D29 — Re-verification demotes contradicted bank confirmations (decided after Phase 03)
When a bank verification (including re-verification of a live instrument) reports a mismatch on a field whose
provenance tier is `BANK_CONFIRMED`, that field drops back to `CLAIMED` (source `institution`) in the same
transaction that opens the discrepancy. Keeping a confirmation the bank now disputes would overstate what is proven.
Fields that were `CLAIMED` or `DOCUMENT` keep their tier, as Phase 03 specifies. This is a deliberate departure from
`docs/phases/03-scrutiny.md`, which keeps every existing tier on mismatch; it was implemented in Phase 03 and is
recorded in `docs/PROGRESS.md` under "Deviations / choices".
