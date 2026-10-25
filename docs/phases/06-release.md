# Phase 06 — Release, discharge and refund workflow

**Goal:** release requests pass through prescribed conditions and a multi-level approval chain, and
can never get past an open problem. Covers requirement #6 and the statement's insistence that release
happens only "subject to applicable regulations… authorization by the competent authority".

Run with: `/phase 06`

## 6.1 Migration `006_release.sql`

```sql
CREATE TABLE release_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_CONDITIONS',
    -- PENDING_CONDITIONS | PENDING_APPROVAL | APPROVED | REJECTED | RETURNED | CANCELLED
  required_levels jsonb NOT NULL,      -- snapshot of the approval chain for this request (6.4)
  current_level int NOT NULL DEFAULT 1,
  return_message text,                 -- latest message to the institution when RETURNED
  refund_reference text,
  requested_at timestamptz NOT NULL,
  closed_at timestamptz
);
CREATE UNIQUE INDEX one_open_release_per_instrument ON release_requests (instrument_id)
  WHERE status IN ('PENDING_CONDITIONS','PENDING_APPROVAL','RETURNED');

CREATE TABLE release_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_request_id uuid NOT NULL REFERENCES release_requests(id) ON DELETE CASCADE,
  code text NOT NULL,
  description text NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  auto boolean NOT NULL DEFAULT false,
  met boolean NOT NULL DEFAULT false,   -- manual conditions only; auto ones are evaluated live
  checked_by uuid REFERENCES users(id),
  checked_at timestamptz,
  remarks text
);

CREATE TABLE release_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_request_id uuid NOT NULL REFERENCES release_requests(id) ON DELETE CASCADE,
  level int NOT NULL,
  role user_role NOT NULL,
  approver_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL,              -- RECOMMEND | APPROVE | REJECT | RETURN
  remarks text NOT NULL,
  conditions_snapshot jsonb NOT NULL,  -- every condition and its state at decision time
  decided_at timestamptz NOT NULL
);

ALTER TABLE documents ADD COLUMN release_request_id uuid REFERENCES release_requests(id);
```

Rules:

```jsonc
// key 'release_conditions'
{ "conditions": [
  { "code": "NO_OPEN_DISCREPANCY",        "auto": true,  "mandatory": true, "description": "No open discrepancy on the instrument" },
  { "code": "NO_BLOCKING_OBSERVATION",    "auto": true,  "mandatory": true, "description": "No unresolved blocking observation" },
  { "code": "INSTRUMENT_VERIFIED",        "auto": true,  "mandatory": true, "description": "Bank-confirmed, or accepted with a recorded override" },
  { "code": "REQUEST_DOCUMENTS_ATTACHED", "auto": true,  "mandatory": true, "description": "At least one release document attached" },
  { "code": "COMPLIANCE_CONFIRMED",       "auto": false, "mandatory": true, "description": "The obligation the deposit secured is confirmed as fulfilled" },
  { "code": "LIEN_REMOVAL_DOCUMENT",      "auto": false, "mandatory": true, "description": "Bank letter or request for lien removal is on file" } ] }
// key 'approval_levels'
{ "levels": [ { "level": 1, "role": "officer",  "action": "RECOMMEND", "label": "Scrutiny officer recommendation" },
              { "level": 2, "role": "approver", "action": "DECIDE",    "label": "Competent authority decision" } ],
  "extraApprovalAbove": "5000000.00",
  "extraLevel": { "role": "approver", "action": "DECIDE", "label": "Second competent authority (amount above ₹50 L)" } }
```

## 6.2 Conditions

- When a request is created, copy the configured conditions into `release_conditions`.
- **Auto conditions are evaluated live every time they are read, never stored as met.** This is what
  lets the system block a decision when something changes after a recommendation.
  - `NO_OPEN_DISCREPANCY`: no OPEN discrepancy on the instrument (failing → link to the discrepancy).
  - `NO_BLOCKING_OBSERVATION`: no OPEN observation with severity BLOCKING (D3).
  - `INSTRUMENT_VERIFIED`: `verification_state = 'CONFIRMED'` or `accepted_with_override` (D13).
  - `REQUEST_DOCUMENTS_ATTACHED`: ≥ 1 non-deleted document with this `release_request_id`.
- Manual conditions are ticked by an officer with remarks and stored.
- `evaluateConditions(tx, request)` → `[{ id, code, description, mandatory, auto, met, reason?, link? }]`
  where `link` points at the cause (e.g. `{ type: 'discrepancy', id, field: 'amount' }`).

## 6.3 Flow

1. **Request** — `POST /instruments/:id/release-requests {reason}` (institution, own). Allowed when
   the instrument is ACTIVE, EXPIRING, MATURED or LAPSED, has no open request, and has no non-terminal
   successor (D6). Snapshot `required_levels` (6.4), `transition → RELEASE_REQUESTED` (stores
   `status_before_release`), create the request in PENDING_CONDITIONS, copy conditions.
   Release documents: `POST /release-requests/:id/documents` (multipart, same upload rules as Phase 2,
   doc types RELEASE_LETTER, COMPLIANCE_CERTIFICATE, LIEN_REMOVAL_REQUEST, OTHER), allowed while
   PENDING_CONDITIONS or RETURNED.
2. **Conditions** — `PATCH /release-conditions/:id {met, remarks}` (officer, manual conditions only,
   remarks mandatory when `met=true`). `GET /release-requests/:id` returns the request, instrument
   summary, documents, conditions with live state, approvals history, `canRecommend`/`canDecide` and
   blocker reasons for the current user.
3. **Recommend** — `POST /release-requests/:id/recommend {remarks}` (officer). Refused 409
   `RELEASE_BLOCKED` with reasons unless every mandatory condition is met. Records level-1 RECOMMEND
   with a conditions snapshot, request → PENDING_APPROVAL, `current_level = 2`.
4. **Decide** — `POST /release-requests/:id/decide {decision: APPROVE|REJECT|RETURN, remarks, refundReference?}`
   (role of the current level). Remarks mandatory for every decision.
   - **Recompute all auto conditions first.** If any mandatory condition fails → 409 `RELEASE_BLOCKED`
     with reasons. This is the block (applies to APPROVE; REJECT and RETURN remain possible).
   - **APPROVE** at a non-final level → record, `current_level++`, stays PENDING_APPROVAL.
     At the final level → request APPROVED, `closed_at`, store `refund_reference`,
     `transition(instrument, 'RELEASED')`, event `RELEASE_APPROVED` whose `after_json` is the snapshot of
     every condition and the whole approval chain; resolve all open alerts on the instrument.
   - **REJECT** → request REJECTED, `closed_at`; restore `status_before_release` via `transition`;
     targeted sweep (D20) in case time passed.
   - **RETURN** → request RETURNED with `return_message`; instrument stays RELEASE_REQUESTED.
     Institution adds information and calls `POST /release-requests/:id/resubmit {note}` (D21) →
     PENDING_CONDITIONS, `current_level = 1`; history stays in `release_approvals`.
5. **Cancel** — `POST /release-requests/:id/cancel` (institution, while PENDING_CONDITIONS or RETURNED)
   → CANCELLED, instrument restored, targeted sweep (D14).
6. `GET /release-requests` — scoped list: institution (own), officer (PENDING_CONDITIONS + all),
   approver (PENDING_APPROVAL where current level's role is approver), admin/auditor (all). Filters by status.

## 6.4 Controls

- **Approval chain from the rule, built generally:** `required_levels` = configured `levels`, plus
  `extraLevel` appended as level 3 when `amount > extraApprovalAbove`. Code loops over levels; no
  special-casing of "level 2".
- **Separation of duties (D27):** a user may act at only one level of a given request — the second
  approver cannot be the first, and the approver cannot be the recommending officer → 403
  `SEPARATION_OF_DUTIES`.
- **Concurrency:** lock the request and instrument rows `FOR UPDATE` in every step; a decision on a
  request no longer at that level/status → 409 `ALREADY_DECIDED` ("This request was already decided by …").
- **Human decision only:** nothing approves a release automatically. Decision screens say so.

## 6.5 Interaction with other phases

- Implement the `RELEASE_PENDING` alert kind in the Phase 4 job: requests in PENDING_CONDITIONS or
  PENDING_APPROVAL older than `afterDays` → alert to the role of the current level (`subject_id` =
  request id); escalates per D11; auto-resolves when the request leaves those states.
- Maturity reminders for an instrument in RELEASE_REQUESTED stay visible (Phase 4 rule).
- On RELEASED, auto-resolution closes every open alert on the instrument.
- A RENEWED instrument cannot be released (terminal); only the live successor can.
- Passport `releaseRequests` and the Release tab are filled now; release events get labels.

## 6.6 Frontend

- **Institution:** "Request release" on eligible passports → modal with reason + document upload.
  The passport's Release tab shows request status, conditions (read-only, plain wording), the latest
  return message, and actions Resubmit / Cancel when allowed.
- **Officer:** a "Re-verify with bank" action on the release review page (re-verification, Phase 3) —
  good practice before recommending, and how a late discrepancy surfaces in the demo.
  `/officer/releases` list and `/officer/releases/:id` review page: conditions checklist —
  auto conditions live green ✓ / red ✗ with a link to the cause ("Open discrepancy on amount →" opens
  the discrepancy card); manual conditions are checkboxes with a remarks field. "Recommend" button is
  disabled while mandatory conditions fail and lists why.
- **Approver:** `/approver` home lists pending decisions (and escalated alerts); decision page shows the
  summary, passport link, the approval chain (level, who, decision, remarks, when), the live conditions,
  and the conditions snapshot from the recommendation with differences highlighted ("changed since
  recommendation"). Approve / Return / Reject with mandatory remarks. Banner: "The portal supports the
  decision; the decision rests with the competent authority."
- **Blocked state:** a clear red banner listing failing conditions, shown to everyone with access.
- **Release order:** after approval, a printable "Release / Discharge Order" view (browser print to PDF)
  with order number, instrument details, conditions met, approval chain and refund reference. Plain
  government-letter styling; clearly marked "Generated by FDR Portal (demo)".

## 6.7 Edge cases

- A discrepancy opened after the recommendation blocks the decision, and the approver sees why.
- An instrument that matures or lapses while the request is open keeps its request; on rejection the
  restored status is corrected by the targeted sweep.
- Two approvers clicking at once: the second gets "already decided".
- A request returned and resubmitted keeps its full history.
- Amount above ₹50 L needs two distinct approvers.

## Acceptance checks

1. A request cannot be recommended while an auto condition fails; the 409 names it. Ticking manual conditions and attaching a release document makes recommend succeed.
2. Open a discrepancy after recommendation (re-verify against a changed mock-bank record): the approver's APPROVE is refused with the reason; after resolution + re-verification it succeeds.
3. After approval the instrument is RELEASED, all its open alerts are resolved, and the `RELEASE_APPROVED` event contains the condition snapshot and approval chain.
4. Rejection restores the earlier status (and the targeted sweep corrects it if maturity passed meanwhile).
5. The recommending officer cannot approve; for an amount above ₹50 L the same approver cannot decide both levels.
6. Concurrent decisions: the second returns 409 `ALREADY_DECIDED`.
7. Return → resubmit → recommend again works and keeps history; cancel restores status.
8. Release requests are refused for RENEWED instruments and while a non-terminal successor exists (D6).
9. RELEASE_PENDING alert appears after `afterDays` and escalates.
10. UI: institution request with upload; officer checklist with live links; approver decision with banner; blocked banner; printable release order.
