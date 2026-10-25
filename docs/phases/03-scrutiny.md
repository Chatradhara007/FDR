# Phase 03 — Scrutiny, mock bank and trust tiers

**Goal:** officers review instruments, request bank verification, and see claimed against confirmed
values. This is the product's signature idea — requirement #3 and the statement's "distinguish
between information submitted by an institution and information independently confirmed by an
authorized bank". Make it look excellent.

Run with: `/phase 03`

## 3.1 The mock bank service (`mock-bank/`)

A separate Express process with its own data. Clearly a **stand-in for authorised bank
integrations**; its request/response contract is what a real integration would implement.

Endpoints:
- `POST /verify` body `{ reference_no, bank, amount, issue_date, maturity_date, beneficiary_name, lien_marked }`.
- `GET /records` (list current records), `POST /records/load {records}` (replace all records and
  persist to `data/records.json`; used by the seed and demo reset), `POST /reload` (re-read file),
  `GET /health`. `GET /records` and the load/reload endpoints are dev/demo only.

Record shape: `{ bank, reference_no, amount, issue_date, maturity_date, beneficiary_name, lien_marked, lien_in_favour_of, status: 'LIVE'|'CLOSED' }`.

Behaviour, in order:
1. Bank in `MOCK_BANK_OFFLINE_BANKS` → HTTP 503 `{ result: 'UNAVAILABLE', bank, responded_at }`.
2. Look up `(bank, normRef(reference_no))`. Absent → `{ result: 'NOT_FOUND', response_id, bank, responded_at }`.
3. Bank in `MOCK_BANK_SLOW_BANKS`: first call for a reference → `{ result: 'PENDING', retry_after_seconds: MOCK_BANK_SLOW_SECONDS }`
   and remember the wall-clock time (D19). Calls after the interval return the real result.
4. Otherwise compare each submitted field with the record (normalised with `shared/normalize`) and return:

```json
{
  "result": "MISMATCH",
  "bank": "Canara Bank",
  "response_id": "rsp_8f3a1c...",
  "responded_at": "2026-10-26T10:15:00Z",
  "fields": {
    "amount":        { "submitted": "2500000.00", "confirmed": "2000000.00", "match": false },
    "maturity_date": { "submitted": "2027-03-31", "confirmed": "2027-03-31", "match": true }
  }
}
```
`result` is `CONFIRMED` when every field matches. All 7 tracked fields appear in `fields`
(`lien_marked` confirmed is true only if `lien_marked && lien_in_favour_of` contains "AICTE").
A record with `status: 'CLOSED'` returns MISMATCH with a top-level `note: 'Deposit closed at bank'`.

Ship `mock-bank/data/records.example.json` with ~6 records for development; the seed (Phase 9)
loads the full set via `POST /records/load`.

Backend client `services/bankClient.ts`: `verifyWithBank(payload, { timeoutMs: 5000 })` → typed
result; network error/timeout → `{ result: 'UNAVAILABLE', reason }`.

## 3.2 Migration `003_scrutiny.sql`

```sql
CREATE TABLE verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  source text NOT NULL,                -- 'mock-bank:<bank>'
  request_payload jsonb NOT NULL,
  response_payload jsonb,
  result text NOT NULL,                -- CONFIRMED | MISMATCH | NOT_FOUND | PENDING | UNAVAILABLE | STALE (D9)
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL,
  responded_at timestamptz
);
CREATE INDEX ON verifications (instrument_id, requested_at DESC);

CREATE TABLE discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  verification_id uuid REFERENCES verifications(id),
  field_name text NOT NULL,
  claimed_value text NOT NULL,
  confirmed_value text,
  reason text NOT NULL,                -- 'Amount mismatch' | 'Wrong beneficiary name' | 'Date inconsistency' | 'No record at bank' | 'Lien not marked in favour of AICTE' | ...
  status text NOT NULL DEFAULT 'OPEN', -- OPEN | RESOLVED
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE UNIQUE INDEX one_open_discrepancy_per_field
  ON discrepancies (instrument_id, field_name) WHERE status = 'OPEN';

CREATE TABLE observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  author_id uuid REFERENCES users(id),           -- null when raised by the system (Phase 5)
  text text NOT NULL,
  severity text NOT NULL DEFAULT 'INFO',          -- INFO | CONCERN | BLOCKING
  visible_to_institution boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'OPEN',            -- D3: OPEN | RESOLVED
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE TABLE returns (               -- why an instrument was sent back (shown to the institution)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  officer_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);
```

## 3.3 Verification service

```ts
async function requestVerification(instrumentId, officer) {
  const inst = await repo.getInstrument(pool, instrumentId);       // read, no lock
  requireStatus(inst, VERIFIABLE_STATUSES);  // UNDER_SCRUTINY + live statuses (re-verification)
  const payload = buildPayload(inst);                              // normalised values
  const res = await verifyWithBank(payload, { timeoutMs: 5000 });  // network, no transaction
  return withTransaction(async tx => {
    const locked = await repo.getInstrumentForUpdate(tx, instrumentId);
    if (locked.status !== inst.status || locked.version !== inst.version) {   // D9
      await insertVerification(tx, inst, payload, { ...res, result: 'STALE' }, officer);
      throw new Conflict('INSTRUMENT_CHANGED', 'The instrument changed during verification. Verify again.');
    }
    const v = await insertVerification(tx, locked, payload, res, officer);
    await applyResult(tx, locked, v, res, officer);
    return summary;
  });
}
```

`VERIFIABLE_STATUSES = ['UNDER_SCRUTINY','ACTIVE','EXPIRING','MATURED','LAPSED','RELEASE_REQUESTED']`.
Verifying a live instrument is **re-verification** (banks are re-asked before a release, or when an
officer has doubts). It never changes the lifecycle status; it only updates tiers, discrepancies and
`verification_state`.

`applyResult` by outcome (always bump `version`, always write `VERIFICATION_RESULT` with the result and mismatched fields):
- **CONFIRMED**: all 7 fields → tier `BANK_CONFIRMED`, source `bank:<response_id>`;
  `verification_state = 'CONFIRMED'`; auto-resolve open discrepancies with note
  `Confirmed by bank response <id>`.
- **MISMATCH**: each `match=false` field → insert an OPEN discrepancy (skip if one is open for that
  field) with a reason from a field→reason map; that field keeps its tier. Matching fields →
  `BANK_CONFIRMED`. `verification_state = 'MISMATCH'`.
- **NOT_FOUND**: OPEN discrepancy on `reference_no`, confirmed value empty, reason `No record at bank`. `verification_state = 'MISMATCH'`.
- **PENDING**: `verification_state = 'PENDING'`; response carries `retryAfterSeconds`.
- **UNAVAILABLE / timeout**: `verification_state = 'UNAVAILABLE'`; the case needs manual confirmation (document checks + override).
Store full request and response every time. Events: `VERIFICATION_REQUESTED`, `VERIFICATION_RESULT`,
`DISCREPANCY_OPENED` (one per discrepancy), `DISCREPANCY_RESOLVED`.

## 3.4 Comparison and normalisation

Normalise both sides before comparing (shared normalisers): amounts to two decimals as strings,
dates ISO, names uppercase/trim/collapse spaces/strip dots and commas, references uppercase without
spaces, booleans `'true'|'false'`. The mock bank decides `match`; the main app normalises again
defensively when building discrepancy card values.

## 3.5 Trust tier rules

- **CLAIMED**: only the institution provided the value.
- **DOCUMENT**: an officer confirmed the value against an attached document —
  `POST /instruments/:id/fields/:field/check-document {documentId, note?}` (officer, UNDER_SCRUTINY).
  Raises CLAIMED → DOCUMENT (source `document:<docId>`); never lowers BANK_CONFIRMED (returns 200 with
  `unchanged: true`). Event `FIELD_DOCUMENT_CHECKED`.
- **BANK_CONFIRMED**: a bank response matched the value.
- Changing a value resets it to CLAIMED at resubmission (D5).
- The instrument's headline tier = the **lowest** tier among the 7 fields
  (`CLAIMED < DOCUMENT < BANK_CONFIRMED`). Expose it as `weakestTier` on detail and list endpoints.

## 3.6 Officer endpoints

| Method and path | Purpose |
|---|---|
| `GET /scrutiny/queue` | Filterable queue (region, bank, verification_state, assigned: `me`/`unassigned`/`all`), ageing in days, open discrepancy count, paging |
| `POST /instruments/:id/claim` | Officer takes the case: SUBMITTED → UNDER_SCRUTINY, sets `assigned_officer_id` |
| `POST /instruments/:id/verify` | Request bank verification (also re-verification of live instruments) |
| `POST /instruments/:id/fields/:field/check-document` | Document check (3.5) |
| `POST /instruments/:id/observations` | `{text, severity, visibleToInstitution}` |
| `POST /observations/:id/resolve` | `{note}` (D3) |
| `POST /instruments/:id/return` | `{reason}` mandatory → RETURNED; inserts `returns` row; reason shown to the institution |
| `POST /instruments/:id/accept` | → ACTIVE per D4: body `{ overrideNote? }` |
| `POST /discrepancies/:id/resolve` | `{note}` mandatory |
| `GET /instruments/:id/review` | Everything the review page needs in one call: instrument, fields with tiers/sources, documents, verifications (newest first), discrepancies, observations, returns, `gaps` (from findGaps), `canAccept` + `acceptBlockers` |

Accept guard (D4) returns 409 `ACCEPT_BLOCKED` with `details.reasons: string[]` listing every
blocker. On success: `accepted_at`, `accepted_by`, `accepted_with_override`/`override_note` set,
`transition → ACTIVE`, event `INSTRUMENT_ACCEPTED` (+ `ACCEPTED_WITH_OVERRIDE` when overriding).
Leave a hook `afterAccept(tx, inst)` that Phase 4 fills with the targeted sweep (D20) and Phase 5
with renewal activation.

## 3.7 Queue query (base)

```sql
SELECT i.id, i.reference_no, i.issuing_bank, i.amount, i.maturity_date, i.verification_state,
       i.status, i.assigned_officer_id, inst.name AS institution, inst.region,
       (SELECT count(*) FROM discrepancies d WHERE d.instrument_id = i.id AND d.status = 'OPEN') AS open_discrepancies,
       i.submitted_at
FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
WHERE i.status IN ('SUBMITTED','UNDER_SCRUTINY')
  AND ($1::text IS NULL OR inst.region = $1)
  AND ($2::text IS NULL OR i.issuing_bank = $2)
  AND ($3::verification_state IS NULL OR i.verification_state = $3)
ORDER BY i.submitted_at ASC
LIMIT $4 OFFSET $5;
```
Ageing (days since submission) is computed against `clock.today()`.

## 3.8 Completeness check (`domain/gaps.ts`)

Pure function `findGaps(instrument, fields, documents, discrepancies, observations, rules): Gap[]`
with `Gap = { code, message, severity: 'blocker'|'warning', ref? }`. Examples:
`Missing document: Bank letter`, `Field not bank-confirmed: amount`,
`Open discrepancy: beneficiary_name (Wrong beneficiary name)`, `Lien not marked in favour of AICTE`,
`Blocking observation: <text>`. Used by the review checklist, the accept guard, the passport
(Phase 5), release conditions (Phase 6) and reports (Phase 7). Unit-test it.

## 3.9 Frontend (officer)

- **Scrutiny queue** `/officer/queue`: filters (region, bank, verification, assigned to me /
  unassigned), columns: institution, reference, bank, amount, submitted, ageing (days, amber > 5,
  red > 10), verification chip, discrepancy count, assigned officer. "Claim" action on unassigned rows.
- **Review page** `/officer/review/:id` — the hero screen:
  - Header: reference, bank, amount, institution, status chip, verification chip, weakest-tier badge.
  - Left: the 7 fields, each with a `TrustBadge` and its source ("Bank response rsp_8f3a · 26 Oct",
    "Checked against FDR copy", "Claimed by institution").
  - Right tabs: **Documents** (inline preview, per-field "Checked against this document" actions),
    **Verification history** (each call: time, result chip, mismatched fields; raw JSON expandable),
    **Observations** (add with severity + visible-to-institution toggle; resolve).
  - **Discrepancy cards** above the fields when any are open: two columns "Institution claimed" vs
    "Bank confirmed", the differing value highlighted, reason label, buttons "Resolve with note" and
    "Return to institution".
  - **Completeness checklist** from `gaps`.
  - **Action bar**: Verify with bank (shows spinner; PENDING shows "Bank is processing — retry in Ns"
    with a countdown; UNAVAILABLE shows a neutral banner "Bank verification unavailable — confirm
    against documents and use override"), Add observation, Return (reason modal), Accept (disabled
    with the blocker list from `acceptBlockers`; an "Accept with override" path requires a note and
    shows a warning).
- `TrustBadge`: three states with icon + text — Claimed (grey, outline circle), Document-checked
  (blue, file-check icon), Bank-confirmed (green, shield-check icon). Never colour alone.
- Institution side: RETURNED instruments show the return reason and any observations marked visible.

## Acceptance checks

1. A clean instrument: claim → verify → every field BANK_CONFIRMED, `verification_state` CONFIRMED, `weakestTier` BANK_CONFIRMED.
2. A tampered amount (bank record differs) produces exactly one OPEN discrepancy for `amount`; the review payload shows claimed and confirmed values; other fields are BANK_CONFIRMED.
3. Verifying the tampered instrument again does not create a second open discrepancy for `amount`.
4. Offline bank → `UNAVAILABLE`, request returns 200 with that state, page still works.
5. Slow bank → first call PENDING with `retryAfterSeconds`; a call after the interval returns the real result (use a short interval in tests, e.g. env 1 s).
6. NOT_FOUND → discrepancy on `reference_no` with reason "No record at bank".
7. D4: accept is refused (409 with reasons) while a discrepancy is open; after resolving it, accept is **still** refused while `verification_state` is MISMATCH unless `overrideNote` is given; with an override note it succeeds and sets `accepted_with_override`.
8. D4 normal path: mismatch → return (reason stored, visible to institution) → institution corrects amount and resubmits → `amount` CLAIMED, others keep BANK_CONFIRMED (D5) → claim → verify → CONFIRMED → accept → ACTIVE.
9. Accept refused while an OPEN BLOCKING observation exists; allowed after it is resolved (D3).
10. Accept refused for an FDR without lien marked (D8).
11. Document check raises CLAIMED → DOCUMENT and does not lower BANK_CONFIRMED.
12. D9: if the instrument's version changes between payload build and apply (simulate by stubbing the bank client to update the row before returning), the verification is stored as STALE and the call returns 409.
13. Institution users cannot call officer endpoints (403) and do not see internal observations.
14. Re-verifying an ACTIVE instrument whose bank record has changed opens a discrepancy and sets MISMATCH without changing its status.
15. UI: the review page shows trust badges, discrepancy card side by side, and the Accept button lists blockers.
