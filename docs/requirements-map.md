# Requirement map (for the closing slide and the judges' checklist)

## The ten expected capabilities (SIH26265)

| # | Requirement | Where it lives | Phase |
|---|---|---|---|
| 1 | Centralised repository | Instrument register, institution-wise profiles, passport per instrument | 2, 5, 7 |
| 2 | Digital document management | Upload with magic-byte type check, SHA-256, duplicate detection, authorised download, access log, encryption at rest | 2, 8 |
| 3 | Verification and discrepancy detection | Mock bank service, per-field trust tiers, discrepancy cards, completeness checklist (`findGaps`), re-verification | 3 |
| 4 | Automated validity and maturity tracking | App clock + daily evaluation job, status sweeps, configurable 90/60/30/7-day reminders | 1, 4 |
| 5 | Renewal and replacement monitoring | Renewal chain with gap/overlap, replacement rules, full timeline | 5 |
| 6 | Release and refund workflow | Request → conditions (live auto + manual) → recommendation → approval chain → release order; blocks on open problems | 6 |
| 7 | Automated alerts and escalation | Alerts inbox, bell, outbox (email stand-in), officer → approver → admin ladder, auto-resolution | 4 |
| 8 | Dashboard and management reports | Dashboard (active, expiring, matured, renewed, released, pending), my-day queue, report presets with CSV | 7 |
| 9 | Audit trail and access control | Five roles, 404-scoped institution access, hash-chained event log with integrity check, document access log | 1, 8 |
| 10 | Integration and data security | Bank verification contract (`docs/integration-contract.md`), JWT + RBAC, helmet, rate-limited login, AES-256-GCM files | 3, 8 |

## The six named test scenarios → demo steps

| Scenario | Demo step |
|---|---|
| New FDR submission | 1 |
| Validity tracking | 3 |
| Approaching maturity | 4 |
| Renewal | 6 |
| Discrepancy identification | 2 (and 7) |
| Authorised release | 7 |

## Hidden signals in the statement → how we answer them

| Signal | Answer |
|---|---|
| "Distinguish institution-submitted from bank-confirmed" | Trust tier on every field; weakest tier in every header |
| "Wherever supported / formally authorised" | Mock bank labelled as a stand-in; documented integration contract; UNAVAILABLE path + recorded override |
| "Configurable reminders" | Rules screen (offsets, ladder, documents, conditions, approval levels, risk weights) |
| "Authorisation by the competent authority" | Human-only decisions, separation of duties, extra approver above ₹50 L |
| "Demonstrate measurable improvements" | Improvement panel computed from portal data vs stated manual baseline, labelled simulated |
