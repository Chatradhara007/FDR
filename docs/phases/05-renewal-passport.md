# Phase 05 — Renewal chain and instrument passport

**Goal:** renewed or replacement instruments link to what they replace, and every instrument has a
single page that tells its whole story. Covers requirement #5 (renewal and replacement monitoring,
complete change history) and makes requirement #9 (audit trail) visible per record.

Run with: `/phase 05`

## 5.1 Migration `005_renewal.sql`

```sql
ALTER TABLE instruments ADD CONSTRAINT no_self_parent CHECK (parent_instrument_id <> id);
CREATE UNIQUE INDEX one_successor_per_instrument ON instruments (parent_instrument_id)
  WHERE parent_instrument_id IS NOT NULL;
```
(`observations.visible_to_institution` already exists from Phase 3.) Drafts can be deleted
(Phase 2), so an abandoned replacement never blocks a new one.

Add rule `renewal_checks` (configurable):
`{ "requireLaterMaturity": true, "flagCoverageGapDays": 0, "flagLowerAmount": true }`.

## 5.2 Starting a renewal

`POST /instruments/:id/renew` (institution, own):
- Allowed when the parent is EXPIRING, MATURED or LAPSED, has no successor, and has no open release
  request (D6). Otherwise 409 with a clear reason.
- Creates a new DRAFT with `parent_instrument_id` set, copying institution, type, bank, branch,
  beneficiary name, purpose; amount defaults to the parent's; dates empty; `lien_marked` false.
- Writes `RENEWAL_STARTED` on both instruments (child: `after {parentId}`, parent: `after {childId}`).
- Returns the new instrument; it then goes through normal Phase 2 submission and Phase 3 scrutiny.

## 5.3 Rules for a replacement

Checked at submit and again at accept (shared function `checkReplacement(child, parent, rules)`):
- `maturity_date` must be later than the parent's `maturity_date`, else 422 on `maturity_date`
  ("Replacement must mature after the instrument it replaces (31 Mar 2027)").
- If `issue_date > parent.maturity_date` → coverage gap: create a system observation (author null),
  severity CONCERN, visible to institution: "Coverage gap of 12 days between maturity of CNRB-0042
  (31 Mar 2027) and issue of CNRB-0107 (12 Apr 2027)". Do not duplicate on resubmit (same text → skip).
- If amount is lower than the parent's → CONCERN observation naming both amounts. Officers decide.
- Lien marking on the replacement is confirmed exactly like other fields (D8).

## 5.4 Activating the chain

In the accept service's `afterAccept` hook, after the replacement becomes ACTIVE:
1. Load parent `FOR UPDATE`. D6: parent must be EXPIRING, MATURED or LAPSED — otherwise roll back the
   whole accept with 409 `PARENT_NOT_RENEWABLE` and a readable reason.
2. `transition(parent, 'RENEWED', actor, { renewedBy: child.id })`.
3. Events `RENEWED_BY` on the parent and `RENEWS` on the child.
4. Targeted auto-resolve for the parent right away (its reminders and overdue-renewal alerts close
   with SYSTEM_CONDITION_CLEARED) so screens are correct immediately; the next job run agrees.
5. Targeted sweep of the child (D20).
The parent is never edited otherwise — it keeps its original values forever.

## 5.5 Chain query

```sql
WITH RECURSIVE up AS (
  SELECT i.*, 0 AS depth FROM instruments i WHERE id = $1
  UNION ALL
  SELECT p.*, up.depth - 1 FROM instruments p JOIN up ON up.parent_instrument_id = p.id
), down AS (
  SELECT i.*, 0 AS depth FROM instruments i WHERE parent_instrument_id = $1
  UNION ALL
  SELECT c.*, down.depth + 1 FROM instruments c JOIN down ON c.parent_instrument_id = down.id
)
SELECT * FROM up UNION SELECT * FROM down ORDER BY depth;
```
(Order by depth, not issue_date — a draft successor has no issue date yet.) The service computes
between consecutive links: `gapDays = next.issue_date - prev.maturity_date`
(positive = gap, negative = overlap, null if not yet known).

## 5.6 The passport endpoint

`GET /instruments/:id/passport` returns everything the page needs in **one** request:
- `instrument` + the 7 fields with tier, source, value and last-updated time; `weakestTier`.
- `chain`: links with status, ref, bank, amount, dates, `isCurrent`, and gap/overlap annotations.
- `documents` (metadata only), `verifications`, `discrepancies`, `observations`, `returns`, `alerts`,
  `releaseRequests` (Phase 6 fills; return `[]` until then).
- `summary`: `daysToMaturity`, `weakestTier`, `openProblems` (from `findGaps`), `acceptedWithOverride`
  + note, `openAlertCount`, `worstOpenAlertLevel`.
- `timeline`: events for this instrument (`events.instrument_id = $1`), newest first, each with
  `label` (from the single label map), `actor`, `at` (app-clock time), `before`, `after`, `icon` key.

Label map (`shared/src/eventLabels.ts`) — one place, e.g.:
`STATUS_ACTIVE → "Accepted by officer"`, `VERIFICATION_RESULT → "Bank verification: mismatch on amount"`
(built from `after`), `RENEWED_BY → "Replaced by CNRB-0107"`, `ALERT_ESCALATED → "Escalated to approver"`,
`DOCUMENT_ACCESSED → "Document viewed by <actor>"`.

Visibility by role (D24): institution users get their instrument, own documents, verification
outcomes (result + per-field match, no raw payloads), observations with `visible_to_institution`,
their institution-role alerts, release status, returns, and only events in
`INSTITUTION_VISIBLE_ACTIONS`. Internal observations, escalation details and document-access logs stay
hidden. Officers, approvers, admins and auditors see everything.

## 5.7 Passport page (`/instruments/:id`, all roles)

- **Header:** reference, bank, amount, status chip, verification chip, weakest-tier badge, days to
  maturity (red if past), "Accepted without bank confirmation" warning badge when applicable.
  Role-aware actions: institution — Renew (when allowed), Request release (Phase 6), Edit (DRAFT/RETURNED);
  officer — Open review.
- **Tabs:** Timeline (default), Fields, Documents, Verification, Chain, Alerts, Release.
- **Timeline:** vertical list — icon, human label, actor, app-clock time, expandable before/after
  diff (changed keys highlighted).
- **Chain:** horizontal nodes joined by arrows. Each node: reference, bank, amount, issue → maturity,
  status chip; current node highlighted; each arrow labelled "12-day gap" (red) / "5-day overlap"
  (green) / "continuous". Clicking a node opens that passport.
- **Fields:** each field with trust badge, source, last updated.
- The passport replaces the simple detail page from Phase 2; the institution home and all tables link here.

## Acceptance checks

1. Start a renewal from an EXPIRING instrument, submit, claim, verify, accept → parent RENEWED, child ACTIVE, chain endpoint returns both with the correct gap in days; parent's reminder alerts are resolved immediately.
2. A replacement maturing earlier than the parent is rejected (422 on `maturity_date`).
3. A second renewal on the same parent is refused (409); after deleting the draft successor, a new renewal is allowed.
4. Coverage gap and lower amount create CONCERN observations (once, not on every resubmit).
5. D6: renew is refused while a release request is open; child accept is refused (409, nothing changed) if the parent is no longer renewable.
6. Passport: an institution user does not see internal observations, raw bank payloads or DOCUMENT_ACCESSED events; an officer does.
7. Timeline labels come from the label map; every event type produced so far has a label (test iterates all actions used in the code base against the map).
8. Three-link chain (A → B → C) renders from any member with correct order and gaps.
9. UI: renew from the passport, chain visual, timeline expand.
