---
name: verify-phase
description: Audit a finished phase against its spec and DECISIONS.md and report gaps. Use only when the user runs /verify-phase.
argument-hint: [phase-number e.g. 03]
disable-model-invocation: true
---

Audit Phase $ARGUMENTS. Do not write new features.

1. Read `docs/phases/$ARGUMENTS-*.md` and `docs/DECISIONS.md`.
2. For every endpoint, rule, schema element, screen and acceptance check in the phase file, find
   where it is implemented and whether a test covers it. Check the architecture rules in CLAUDE.md
   (one clock, transitions only via transition(), audit event in every mutation, 404-not-403 scoping,
   errors shaped { code, message, details }).
3. Run `npm run test` and `npm run typecheck`.
4. Report a table: item | status (done / partial / missing / wrong) | file:line | fix needed.
5. Ask me before fixing anything. When I say go, fix, re-run tests, update PROGRESS.md and commit
   as "phase $ARGUMENTS: fixes from verification".
