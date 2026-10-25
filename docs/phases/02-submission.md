# Phase 02 — Institution submission and documents

**Goal:** an institution creates an instrument, attaches documents, edits it and submits it for
scrutiny. Covers requirements #1 (centralised repository) and #2 (digital document management).

Run with: `/phase 02`

## 2.1 Migration `002_submission.sql`

Nothing structural is strictly required (tables exist from 001). Add only what you need, e.g. an
index `documents (instrument_id) WHERE deleted_at IS NULL`.

## 2.2 Endpoints

| Method and path | Who | Purpose |
|---|---|---|
| `POST /instruments` | institution | Create a DRAFT (all fields optional except `type`) |
| `PATCH /instruments/:id` | institution (own) | Edit while DRAFT or RETURNED; body includes `version` (D10) |
| `DELETE /instruments/:id` | institution (own) | Delete while DRAFT only (D7) — hard delete incl. provenance; files kept; event `INSTRUMENT_DRAFT_DELETED` |
| `POST /instruments/:id/documents` | institution (own) | Upload one document (multipart: `file`, `docType`) |
| `DELETE /instruments/:id/documents/:docId` | institution (own) | Soft delete while DRAFT or RETURNED (D15) |
| `GET /instruments/:id/documents/:docId/download` | institution (own), officer, approver, admin, auditor | Authorised download |
| `POST /instruments/:id/submit` | institution (own) | Submit for scrutiny |
| `GET /instruments` | all roles (scoped) | List: filters `status[]`, `type`, `bank`, `region`, `institutionId`, `q` (ref/beneficiary/institution), `maturityFrom/To`; sort; `page`, `pageSize` (default 25) → `{ items, total, page, pageSize }` |
| `GET /instruments/:id` | all roles (scoped) | Detail incl. documents (not deleted), provenance rows, computed `daysToMaturity`, `requiredDocs`, `missingDocs` |
| `GET /meta` | authenticated | Banks, doc types with labels, instrument types, regions, current `required_docs` and `lien_required` rules |

List items include: id, type, reference_no, issuing_bank, amount, issue/maturity dates, status,
verification_state, institution name/region, `daysToMaturity` (computed on the server from the app clock).

## 2.3 Validation (shared zod schemas in `shared/src/schemas.ts`)

- `reference_no`: 6–30 chars, letters, digits, hyphens, slashes; normalised with `normRef`.
- `issuing_bank`: one of `banks.ts`.
- `branch`: optional, ≤ 80 chars.
- `amount`: > 0 and ≤ 100 crore (1,000,000,000.00), max two decimals; accept `"25,00,000"` and normalise.
- `issue_date`: valid date, not after `today()` (server-side check uses the app clock).
- `maturity_date`: after `issue_date` and not before `today()` at submission (D25).
- `beneficiary_name`: required at submit, trimmed, internal spaces collapsed.
- `lien_marked`: boolean (institution declares whether lien is marked in favour of AICTE).
- `type`: enum. `purpose`: optional text ≤ 200.

Drafts may be incomplete. **Submit** runs the full schema plus business rules and returns 422 with
`details` listing every failing field and every missing document at once:
`details: { fields: [{field, message}], missingDocuments: ['BANK_LETTER'] }`.

## 2.4 Document upload

- multer disk storage (temp dir), 10 MB limit, single file field `file`.
- Allowed: PDF, PNG, JPEG. Detect the real type from magic bytes (`file-type`), not the
  extension or the browser's mime header. Wrong type → 422 `UNSUPPORTED_FILE_TYPE`.
- **All file IO goes through one module `services/storage.ts`** (`saveUpload(tmpPath, instrumentId, ext) →
  { storagePath, sha256, size }`, `openForRead(storagePath) → Readable`). Phase 8 adds encryption at rest
  inside this module without touching callers.
- Compute SHA-256 while saving; move to `STORAGE_DIR/<instrumentId>/<uuid>.<ext>`. Never build the
  path from the original filename. Keep the original name only in the DB, sanitised for display.
- If the same checksum already exists (not deleted) on the same instrument, accept but return
  `{ document, duplicateOf: <docId> }` so the UI can warn.
- Upload allowed only in DRAFT or RETURNED (release documents come in Phase 6).
- Events: `DOCUMENT_UPLOADED`, `DOCUMENT_REMOVED`, `DOCUMENT_ACCESSED` (on every download).
- Download: authorise first, then stream with `Content-Disposition: attachment; filename="<sanitised>"`
  and the stored mime type. Files are never served by a public static route.
- Also `GET .../documents/:docId/preview` returning `inline` for PDF/images (same auth, also logs
  `DOCUMENT_ACCESSED`) so officers can preview in Phase 3.

## 2.5 Submit logic (`services/submission.ts`)

Inside `withTransaction`:
1. Load the instrument `FOR UPDATE`.
2. `assertCanSee` + ownership; status must be DRAFT or RETURNED (else `InvalidTransition`).
3. Full validation + D7 duplicate rule + missing documents from `required_docs` → 422 with everything at once.
   Duplicate bank+reference → 409 `DUPLICATE_REFERENCE` with a readable message naming the other record's status.
4. Provenance per D5 for all 7 tracked fields: insert if missing; if the normalised value changed,
   update value, tier `CLAIMED`, source `institution`; unchanged → keep tier.
5. `submitted_at = clock.now()`; `verification_state = 'UNVERIFIED'` on first submit or if any field changed (D5).
6. `transition(..., 'SUBMITTED')` (writes `STATUS_SUBMITTED`) and also record `INSTRUMENT_SUBMITTED`
   with the submitted values (after_json).

A second submit of an already submitted instrument fails with `INVALID_TRANSITION` (safe against
double clicks).

## 2.6 Editing rules

- Only the owning institution, only in DRAFT or RETURNED, with the current `version` (else 409 `STALE_VERSION`).
- Every edit records `INSTRUMENT_EDITED` with before/after values of the changed fields only.
- Tier reset happens at the next submit (D5), so a confirmation never survives a changed value.

## 2.7 Frontend (institution)

- **Institution home** `/institution`: summary tiles (Active, Expiring ≤ 90 d, Returned — needs action,
  Drafts) and a table: reference, type, bank, amount, maturity date, days remaining (server value),
  status chip, verification chip. Rows with `RETURNED` show a clear "Action needed — returned by
  officer" call to action. "New instrument" button.
- **New / edit wizard** `/institution/instruments/:id/edit`, three steps:
  1. Details — type, reference, bank (searchable select), branch, amount (Indian formatting as you
     type, shows words e.g. "Twenty-five lakh rupees"), issue date, maturity date, beneficiary name
     (prefilled "Member Secretary, AICTE" as a hint, not forced), lien marked checkbox, purpose.
  2. Documents — required list for the chosen type with ✓/✗, picker for doc type, upload with
     progress, list with size and checksum prefix, duplicate warning, remove while editable.
  3. Review and submit — read-only summary, a checklist of anything still missing, Submit button.
  "Save draft" on every step (creates on first save, PATCH afterwards with version). Server errors
  appear next to the exact fields; missing documents are listed on step 2/3.
- When status is RETURNED, show the officer's return reason (Phase 3 provides it) at the top of the wizard.
- Instrument detail page (simple for now; becomes the passport in Phase 5).

## 2.8 Edge cases to handle

- Upload after submission → 409 `INVALID_STATE`.
- A `.pdf` that is really a text/exe file → 422.
- Duplicate bank + reference (live) → 409 with readable message.
- Editing in two tabs → second save gets 409 `STALE_VERSION`; UI says "This record changed in another tab — reload".
- Maturity date in the past at submit → 422 on `maturity_date`.

## Acceptance checks

1. Submit with a missing document fails with 422 and names the document (`missingDocuments`), together with any invalid fields in the same response.
2. A full submission creates seven provenance rows (CLAIMED, source `institution`), one `STATUS_SUBMITTED` event, one `INSTRUMENT_SUBMITTED` event, status SUBMITTED, `verification_state` UNVERIFIED.
3. Submitting twice → second call 409 `INVALID_TRANSITION`.
4. Institution 2 cannot download institution 1's file (404); officer can; every download writes `DOCUMENT_ACCESSED`.
5. Renamed non-PDF with `.pdf` extension is rejected (422).
6. Duplicate checksum upload returns `duplicateOf`.
7. PATCH with an old `version` → 409 `STALE_VERSION`.
8. Duplicate bank + reference against a live instrument → 409; against a RELEASED one → allowed (D7).
9. D5: (set up via repository) an instrument with `amount` at BANK_CONFIRMED and `issue_date` at BANK_CONFIRMED is RETURNED; institution changes only `amount` and resubmits → `amount` is CLAIMED, `issue_date` still BANK_CONFIRMED, `verification_state` UNVERIFIED.
10. List endpoint: an institution sees only its own instruments; filters and paging work.
11. UI: create → upload → submit works end to end; field errors show next to fields.
