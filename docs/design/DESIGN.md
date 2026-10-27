# UI design: "Mission Desk" (binding for all frontend work)

Chosen direction after reviewing three concepts. The two files next to this one are the reference:

- `mockup-officer-desk.html` — the officer's day (ranked queue on the left, selected item on the right)
- `mockup-institution-home.html` — the institution home (actions, parcel-style tracker, deposit list)

They are written in a small template format (`<sc-for>`, `{{holes}}`, a `renderVals()` block with sample data) and will not render by themselves. Read them for the exact structure, spacing, colours, wording and sample data, then rebuild them as React components. Screenshots of both, if present, are in this folder as `*.png`.

## Principle

Each role opens to **a work queue, not a dashboard**: at most 3 headline numbers, one main list, one primary action. Everything else is one click deeper (tabs, drawers, "Show more"). If a screen shows more than about four panels, it is wrong.

## Tokens

| Token | Value | Use |
|---|---|---|
| canvas | `#F4F6F6` | page background |
| surface | `#FFFFFF` | cards, header |
| border | `#DCE2E2` | card borders; hairline rows `#EAEEEE`; subtle fill `#FAFBFB` |
| ink | `#1F2933` | text, active nav pill, secondary dark buttons |
| muted | `#52606D` | secondary text (AA on canvas and surface) |
| primary | `#0F766E` (hover `#0B544F`, tint `#E6F4F2`) | primary buttons, links, selected row, bank-confirmed tier |
| attention | `#C2410C`, text `#8A3A0A`, tint `#FFF0E6` | urgent reasons, "needs your action" left border |
| danger | `#B42318`, tint `#FDECEA` | mismatches, errors |
| tiers | Bank-confirmed: solid `#0F766E`. Document-checked: half-filled `#7CC2BB` with `#3D9A91` border. Claimed: white with dashed `#8A96A3` border | the 7-square proof strip and tier labels; always icon/shape plus text, never colour alone |

- Font: **DM Sans** (400/500/600/700) for text, **DM Mono** for reference numbers and keys. Bundle via `@fontsource`; keep Noto Sans Devanagari for any Hindi text.
- Scale: body 16 px, page title 30–32 px / 700 / -0.02em, section title 18 px / 700, small labels 12–13 px / 700 / uppercase / 0.05em tracking. Nothing below 12 px; body text never below 14 px.
- Shape: cards radius 14, controls and buttons radius 10, chips 6–8, round avatars. **No shadows** except floating menus and drawers. No gradients, no glass.
- Space: generous; cards padding 22–26 px, page gutter 28 px, content max width 1400 (queue screens) or 1240 (institution screens).

## Shell

- Slim white header, 60 px: wordmark (small teal square + "FDR Portal"), a few role-aware nav items as pills (active = ink background, white text), spacer, search box ("Jump to a deposit: type a reference", also Ctrl+K), app-clock chip, alerts bell, user avatar menu.
- User menu holds: name and role, text size A-/A/A+, high contrast, Sign out. Keep the skip-to-content link (visible on focus) and strong focus rings.
- Demo-mode ribbon: slim, unobtrusive (keep `data-testid="demo-ribbon"`).
- One small footer line on app pages (prototype notice, synthetic data, Help, Accessibility, Privacy). Public pages (login, verify, policy pages) may carry a fuller footer.
- No sidebar, no tricolour bar, no navy full-width menu band, no utility bar, no national emblem or real AICTE logo.

## Components to build once and reuse

- **Queue row**: rank circle, institution, reference (mono) and amount, reason chips (attention tint for urgent reasons, grey for the rest), priority score on the right; selected row tinted with a 4 px teal left edge.
- **Proof strip**: 7 small squares in this order: reference, bank, amount, issue date, maturity date, beneficiary, lien. Tooltip lists the fields. Tier shapes as in the tokens table.
- **Score breakdown** bars ("Why it is ranked here"), with a link to the rule.
- **Action card**: white card, 5 px attention left border, kicker label, title, mono reference, one sentence, one dark button.
- **Tracker** (parcel-style stepper): done = filled teal circle with tick, current = ringed circle, next = dashed circle; title and one plain sentence per step; ends with a tinted note saying whether the user has to do anything.
- **Buttons**: primary teal 48 px for the one main action per screen, outlined secondary, dark for secondary-important; keyboard hint chip (`R`, `B`) inside buttons on staff screens.
- **Keyboard legend** under the queue: J/K move, R recommend, B ask bank, O open record. Actually implement J/K/R/B/O on the officer desk.
- Tables: no grid lines or zebra; hairline row dividers, roomy rows, status as a small flat label, secondary columns hidden behind a row drawer or "Columns" toggle; sticky header; search and pagination only for long lists.
- Forms: one column, labels above, red asterisk only for mandatory fields, inline help and errors, calm step indicator for the wizard.

## Role landing pages

- **Institution**: greeting; primary button "Submit a new deposit"; "Needs your action" cards; tracker for the most recent request; "All my deposits" table with proof strip and next step. (mockup-institution-home)
- **Scrutiny officer**: "My day" queue + selected-item panel with score breakdown, release conditions (manual conditions are the officer's to tick), next-action buttons. (mockup-officer-desk)
- **Approver**: same layout as the officer desk, queue titled "Awaiting your decision"; selected panel shows the recommendation, conditions and the approve/reject actions; separation of duties message.
- **Admin**: greeting, 3 numbers, "Needs attention" list, then tabs for the detail panels that exist today (Status, Maturity, Verification, Regions, Banks, Alerts). Keep the clock controls reachable.
- **Auditor**: a prominent audit-integrity card (intact / broken with link), 3 numbers, recent audit events, link to reports. Read-only everywhere.

## Wording

Short, plain, specific sentences. Say what happened and what the user should do next. No marketing taglines. Dates as `27 Oct 2026`, money with the rupee sign and Indian grouping (L / Cr where already used).

## Non-negotiables carried over

Keep every `data-testid`, role, button name and string the e2e scripts rely on. Keep print layouts for the release order and passport. Respect `prefers-reduced-motion`. WCAG AA contrast. No backend, API, constants, migration or test changes.
