# Integration contract

How the FDR Portal connects to authorised systems: what exists today, what is mocked, and how each piece
plugs in for production. Requirement #10 (integration and data security).

## 1. Bank verification API

The portal asks the issuing bank to confirm what an institution claims. Today a **mock bank** (`mock-bank/`,
a separate FastAPI service with its own data file) plays the bank. Its contract is the one a real
integration must implement. The portal reaches it only through one adapter, `backend/app/services/bank_client.py`.

**Request**: `POST /verify`, JSON:

```json
{ "request_id": "<verification uuid>", "reference_no": "SBIN/FDR/2026/00731", "bank": "State Bank of India",
  "amount": "2000000.00", "issue_date": "2026-04-01", "maturity_date": "2027-04-01",
  "beneficiary_name": "Member Secretary, AICTE", "lien_marked": "true" }
```

Amounts are decimal strings (never floats) and dates are `YYYY-MM-DD`. `lien_marked` means "lien marked in
favour of AICTE".

**Response**: always JSON with a `result`:

| `result` | Meaning | Portal action |
|---|---|---|
| `CONFIRMED` | Every field matches a live deposit | Fields become *Bank-confirmed* |
| `MISMATCH` | At least one field differs, or the deposit is closed (`note`) | A discrepancy is opened per field. Confirmations the bank now disputes are demoted (D29) |
| `NOT_FOUND` | No deposit with this bank and reference | A "No record at bank" discrepancy |
| `PENDING` | The bank is still looking; `retry_after_seconds` says when to ask again | UI shows "retry in N s" |
| `UNAVAILABLE` (HTTP 503) | Bank system down | Officer falls back to document checks or the override path (D4) |

`CONFIRMED` and `MISMATCH` responses also carry the following fields:

- `response_id` and `responded_at`.
- `fields`: one entry per tracked field, `{ submitted, confirmed, match }`.

The portal stores every request and response in `verifications`, so the bank's own words stay on record.

**Rules the portal keeps:**
- **No call inside a database transaction** (CLAUDE.md rule 9). The call happens first. A transaction then
  re-locks the instrument and applies the result only if the instrument is unchanged. Otherwise the result is
  stored as `STALE` (D9).
- **Timeouts.** The call times out after 5 s. A timeout, network error or unreadable answer counts as `UNAVAILABLE`.
- **Retries.** `PENDING` is retried only when the officer asks, after `retry_after_seconds`. Nothing retries
  automatically against a bank.
- **Idempotency.** In production the request carries `request_id` (the `verifications` row id). A bank that
  sees the same `request_id` twice must return the first answer. The mock does not need it (verification is
  read-only), and today's client does not send it yet. Adding it is a one-line change in `bank_client.py`.

**Production hardening** (not built, by design of the demo):
- mutual TLS between the portal and each bank, or a bank-issued client certificate;
- signed requests (an HMAC or JWS over the body, with a timestamp) and verified signatures on responses;
- an IP allow-list at the bank;
- one adapter per bank behind the same `verify_with_bank()` signature, chosen by `issuing_bank`. Banks with
  different field names or SOAP/XML interfaces are translated inside their adapter. Services and the UI do
  not change.

## 2. Future integrations

| System | Purpose | How it plugs in |
|---|---|---|
| **AICTE approval portal** | Institution master data (name, region, state, contact) | `institutions.aicte_id` is the join key. A nightly sync (or a webhook) upserts institutions through `institution_repo.upsert_institution`, so the portal never keeps its own copy of an institution's identity. Institution user accounts can then be provisioned from the approval portal's contacts. |
| **PFMS / refund reference** | Proof that a released deposit was actually refunded | A release decision records `refund_reference` today, typed by the approver. Production fetches or validates it against PFMS, and attaches the PFMS transaction id to the `RELEASE_APPROVED` event. |
| **Email / SMS gateway** | Reminders and escalations reach people | Every alert already writes an `outbox` row: recipient, subject, body. A small dispatcher reads unsent rows and hands them to the gateway, marking each one sent or failed. Alerts and their dedupe keys (D1) stay as they are. Only delivery changes. |
| **SSO for officials** | Single sign-on for AICTE staff | Replace password sign-in for internal roles with OIDC/SAML. After the identity provider's callback, the backend maps the subject to a `users` row (by email), checks `active`, and issues the same short-lived JWT. `authenticate()`, roles and audit events are unchanged. Institution users can keep passwords or use the approval portal's identity. |

## 3. What is mocked today, and what is real

| Piece | Today | Production |
|---|---|---|
| Bank verification | Mock bank (`MOCK_BANK_URL`) with demo records; offline and slow banks via env vars | Per-bank adapters as above |
| Emails | `outbox` table, shown on **Outbox** | Gateway dispatcher (§2) |
| Clock | App clock that admins can move (`DEMO_MODE`), used by every business rule | `REAL` mode only. The daily job runs from the scheduler. |
| Demo routes | `/demo/users`, `/demo/tamper` (+ `/undo`), demo reset (Phase 9) | Absent: they are mounted only when `DEMO_MODE=true` |

## 4. Data security in place

- **Encryption at rest for documents.** Documents are encrypted with AES-256-GCM using `FILE_ENCRYPTION_KEY`
  (32 random bytes, base64). Generate a key with
  `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`. Stored files start
  with the marker `FDE1`, followed by a 12-byte IV, the ciphertext and a 16-byte tag. Checksums are computed
  on the plaintext. A file is decrypted, and its tag checked, before anything is served. Without a key, only a
  `DEMO_MODE` install starts, using a key derived from `JWT_SECRET`.
- **Secrets.** The API refuses to start with a `JWT_SECRET` shorter than 32 characters unless `DEMO_MODE` is on.
- **Transport and headers.** CORS is limited to the frontend origin. Every response carries a strict CSP
  (`default-src 'none'; frame-ancestors 'none'`), `nosniff`, `X-Frame-Options: DENY`, HSTS and
  `Referrer-Policy: no-referrer`. JSON bodies are limited to 1 MB and uploads to 10 MB.
- **Access.** Every `/api/v1` route except `/health`, `/auth/login` and `/demo/users` requires a valid token
  for an active user. A test walks the router to enforce this.
- **Audit.** Events are append-only (a database trigger) and hash-chained. `GET /audit/integrity` recomputes
  the chain. Request logs record method, path, status, time, request id and user id, never tokens or bodies.
