# Phase 08 — Admin, audit trail, integrity and security

**Goal:** configurable rules editable by admins, user management, a tamper-evident audit trail with a
visible integrity check, and a security pass. Covers requirement #9 (audit trail and access control)
and #10 (integration and data security), and the strategy's "configurable rules screen" and
"tamper-evident audit log". (Specified from the strategy report; the build guide only references Phase 8.)

Run with: `/phase 08`

## 8.1 Rules administration

Endpoints (admin; auditor may read):
- `GET /rules` → all rules with config, active, updated_at/by.
- `PUT /rules/:key {config, active}` → validate `config` with the rule type's zod schema from `shared`
  (422 with field-level details on error); write `RULE_UPDATED` with before/after config. Takes effect
  on the next evaluation run / next operation (rules are read fresh).
- `POST /rules/:key/restore-default` → restore from `shared/src/ruleDefaults.ts`.

Semantic validation (in addition to shape):
- reminder offsets: positive, unique, at least one; recipients from allowed roles.
- escalation: levels strictly increasing in level and afterDays; roles officer/approver/admin.
- required_docs: known doc types; each type has ≥ 1.
- approval_levels: level 1 is RECOMMEND by officer; at least one DECIDE level; threshold ≥ 0.
- risk_weights: each 0..1, sum = 1 (± 0.001).
- release_conditions: codes unique; auto conditions must be known codes.

## 8.2 User management

- `GET /users` (admin), `POST /users {name, email, role, institutionId?, designation, password}`,
  `PATCH /users/:id {name?, designation?, active?}`, `POST /users/:id/reset-password {password}`.
- Password policy: ≥ 8 chars with a letter and a digit; bcrypt cost 10.
- Deactivated users cannot log in or use existing tokens (authenticate checks `active`).
- Events: `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `PASSWORD_RESET`.
- Also log `LOGIN_SUCCEEDED` / `LOGIN_FAILED` (entity_type `user`; for unknown emails use the nil UUID
  and put the email in after_json).

## 8.3 Audit trail and integrity

- `GET /audit/events` (admin, auditor): filters `actorId`, `action`, `entityType`, `instrumentId`,
  `from`, `to`, `q`; paging; `format=csv`. Each row has the human label from the label map.
- `GET /audit/integrity` (admin, auditor): runs `verifyChain` (Phase 1) →
  `{ ok, checked, firstBrokenId, verifiedAt }`. Cache for 30 s; `?fresh=1` forces.
- `GET /audit/document-access?instrumentId=` (admin, auditor): DOCUMENT_ACCESSED events — who
  viewed which document when.
- `POST /demo/tamper` (admin, DEMO_MODE only, D17): in one transaction
  `SET LOCAL fdr.allow_tamper = 'on'` and change one chosen event's `after_json` (e.g. an amount in an
  `INSTRUMENT_SUBMITTED` event) **without** recomputing the hash. Returns the event id. Used to show
  the integrity check catching it. `POST /demo/reset` (Phase 9) restores a clean chain.

## 8.4 Security pass

- `helmet` with a sensible CSP for the API; CORS restricted to the frontend origin.
- Refuse to start if `JWT_SECRET` is shorter than 32 chars unless `DEMO_MODE=true` (then warn).
- **Encryption at rest for documents:** implement inside `services/storage.ts` — AES-256-GCM with a key
  from `FILE_ENCRYPTION_KEY` (32-byte base64; generate one into `.env.example` comment instructions).
  Stored file = `[12-byte IV][ciphertext][16-byte tag]`; SHA-256 is computed on the plaintext;
  downloads decrypt on the fly. Existing unencrypted files (dev) are read as plaintext if a header
  marker is absent — store a 4-byte magic `FDE1` prefix on encrypted files.
- Every route has an explicit `requireRole` (add a test that walks the Express router and fails if a
  `/api/v1` route other than `/health`, `/auth/login` and `/demo/users` lacks authentication).
- Input sizes: JSON body limit 1 MB; upload 10 MB.
- No secrets or tokens in logs; request logging (method, path, status, ms, request id, user id).

## 8.5 Integration contract document

Write `docs/integration-contract.md` — the story for "integration with authorised systems":
- The bank verification API contract (request/response from Phase 3, result codes, idempotency via
  `request_id`, timeouts, retries with `retry_after_seconds`, signed requests/mTLS in production,
  per-bank adapters behind `bankClient`).
- Future integrations: AICTE approval portal (institution master data via `aicte_id`), PFMS/refund
  reference, email/SMS gateway replacing the outbox, SSO for officials.
- What is mocked today and how it plugs in. Keep it to ~2 pages.

## 8.6 Frontend

- **Rules** `/admin/rules`: friendly editors —
  reminder offsets as editable rows (days + recipient role checkboxes, add/remove);
  escalation ladder rows; required documents as a type × document checkbox matrix;
  lien required per type; release conditions (mandatory toggle, description); approval levels and the
  extra-approval threshold (₹ input); risk weights with sliders and a "sum = 1.00" indicator;
  improvement baseline numbers. "Advanced (JSON)" toggle for raw edit. Save shows field errors;
  "Restore default". After saving reminder rules, a hint: "Takes effect on the next evaluation —
  run now?" with a button calling `POST /jobs/evaluate`.
- **Users** `/admin/users`: table, create, deactivate, reset password.
- **Audit log** `/audit` (admin, auditor): integrity banner at the top — green shield
  "Log integrity verified · 1,284 events · checked 10:42" or red "Integrity check failed at event
  #812 — the log has been altered" with a link to that event; filters; table with expandable
  before/after diff; CSV export; tab "Document access".
- **Auditor home** = dashboard + audit log + reports in the sidebar, everything read-only (no action
  buttons rendered for auditors anywhere).
- Admin sidebar: Dashboard, Rules, Users, Clock (header), Outbox, Audit log, Demo tools (Phase 9).

## Acceptance checks

1. Changing reminder offsets to `[45, 15]` and running evaluate creates `maturity:45`/`maturity:15` alerts and no `maturity:30`; restore-default brings back 90/60/30/7.
2. Invalid configs are rejected with field details (e.g. weights summing to 1.2, decreasing escalation days, unknown doc type).
3. `RULE_UPDATED` events contain before and after config.
4. A deactivated user's existing token stops working (401) and login fails.
5. `/audit/integrity` is `ok: true` on a fresh system; after `POST /demo/tamper` it returns `ok: false` with the tampered id; the tamper route 404s when DEMO_MODE is off.
6. Uploaded files on disk are encrypted (bytes differ from the upload, start with `FDE1`); download returns the original bytes; SHA-256 in the DB matches the original.
7. Route guard test: every `/api/v1` route except the allow-list requires authentication.
8. Auditor can read audit/reports/dashboard but gets 403 on every mutation endpoint (spot-check one per module).
9. Login success/failure events are recorded.
10. UI: rules editor round-trip, integrity banner green then red after tamper, auditor sees no action buttons.
