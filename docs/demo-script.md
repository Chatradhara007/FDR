# Demo script (~6 minutes)

Follows the statement's own test scenarios in order: new FDR submission → verification and
discrepancy → validity tracking → approaching maturity → escalation → renewal → authorised release →
audit. Anchors (A1…A9) are defined in `docs/seed-spec.md`. Every phase must keep the steps it touches
runnable; Phase 9 automates the whole script as a test.

**Opening line (10 s):** "AICTE holds crores in deposits, and today nobody can say at a glance which
are proven, which are about to lapse, and who has to act. Our portal answers exactly those two
questions: trust tiers and the clock."

## Before you start

- Admin → Demo tools → **Reset demo data**. Clock shows `SIMULATED · <today>`.
- Browser tabs (or the quick "Sign in as" buttons): Institution 1, Officer, Approver, Auditor, Admin.
- `docs/demo-files/` open in a file picker for step 1.
- Zoom the browser to 110–125 % for the projector.

## 1. New FDR submission (Institution 1) — 45 s

Sign in as **Institution 1** → New instrument → FDR, `SBIN/FDR/2026/00731`, State Bank of India,
amount **₹25,00,000** (deliberately wrong — the bank holds ₹20 L), dates and beneficiary from the
sample letter, lien marked ✓ → Documents: upload FDR copy and bank letter (show the required-documents
checklist turning green) → Review → **Submit**.
*Say:* every value is now a **claim** — grey "Claimed by institution" badges.

## 2. Verification and discrepancy (Officer) — 75 s

Sign in as **Officer** → Scrutiny queue → claim A1 → **Verify with bank**.
Result: **MISMATCH** — discrepancy card "Institution claimed ₹25,00,000 · Bank confirmed ₹20,00,000",
the other six fields flip to green "Bank-confirmed". **Accept** is disabled and lists why.
→ **Return to institution** with reason "Amount does not match bank record".
*(If time allows: Institution 1 corrects the amount and resubmits; Officer verifies again → all green
→ Accept. Otherwise say "the corrected resubmission re-verifies only what changed".)*
*Say:* this is the statement's "distinguish institution-submitted from bank-confirmed" made visible.

## 3. Validity tracking (Officer/Approver dashboard) — 30 s

**Dashboard**: live amount held, % bank-confirmed, status bars (active, expiring, matured, lapsed,
renewed, release requested, released, pending), maturity buckets, region table.

## 4. Approaching maturity — the fast-forward clock (Admin) — 45 s

Header clock → **+7 days**. Toast: "N status changes · N alerts · N escalations".
A2 (`CNRB/FD/2025/11842`) flips ACTIVE → **EXPIRING**; 90-day reminders appear in the alerts inbox and
as emails in the Outbox. A4 crosses the 30-day mark. Officer's **My day** re-orders — A4 and A2 rise.
*Say:* a time-based problem demonstrated by time passing; the same job runs daily in real mode.

## 5. Escalation — 30 s

Approver home: A3's "verification pending" alert has **escalated to the competent authority (L2)**
because nobody acted for 7 days; acknowledging doesn't stop escalation — only fixing the cause does.
Show A6: lapsed and escalated to admin (L3).

## 6. Renewal (Institution 1 → Officer) — 60 s

Institution 1 → A4 passport → **Renew** → replacement `UBIN/FDR/2026/40977`, ₹35 L, dates from the
seed spec → upload → submit. Officer → claim → verify (all green) → accept.
A4 becomes **RENEWED**, the replacement ACTIVE, its alerts close. **Chain** tab shows both linked with
the overlap. Open A8's chain: a **12-day coverage gap** flagged on an earlier late renewal.

## 7. Authorised release — blocked, then approved — 75 s

Officer → Releases → A5 (`PUNB/FDR/2024/77015`): red banner **"Release blocked — open discrepancy on
amount"**; Recommend disabled. Admin → Demo tools → **Bank correction** for A5 (the bank updated its
record after the institution's representation) → Officer → **Re-verify with bank** → CONFIRMED,
discrepancy auto-resolved, conditions all green → **Recommend** with remarks.
Approver → decision page (banner: the decision rests with the competent authority) → **Approve** with
remarks and refund reference → instrument **RELEASED** → printable **Release Order**.
Mention A9: above ₹50 L needs a second, different approver.

## 8. Audit — 30 s

Auditor → **Audit log**: green "Log integrity verified · N events". Open A1's passport timeline —
every claim, verification, return and access is there. Admin → Demo tools → **Tamper** → auditor
refreshes → red "Integrity check failed at event #N". *Say:* hash-chained, tamper-evident.
(Reset demo data afterwards.)

**Close (20 s):** requirements map slide (`docs/requirements-map.md`) and the improvement panel
(`/reports/improvement`, clearly labelled simulated).

## If something goes wrong

- Bank call slow → it's the "slow bank" path: say "the bank is processing; the portal records PENDING
  and retries" and move on.
- Any screen stale after a clock jump → press the clock badge (refetches) or reload.
- Lost state → Demo tools → Reset (≈15 s) and jump to the step's anchor; every anchor exists at D0.
