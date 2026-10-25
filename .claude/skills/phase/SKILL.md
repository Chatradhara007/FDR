---
name: phase
description: Build one phase of the FDR Portal from its spec in docs/phases. Use only when the user runs /phase.
argument-hint: [phase-number e.g. 03]
disable-model-invocation: true
---

You are building **Phase $ARGUMENTS** of the FDR Portal.

1. Read, in this order: `CLAUDE.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, then the phase file
   `docs/phases/$ARGUMENTS-*.md`. Skim the code that earlier phases produced where this phase
   touches it. Do not read the PDFs in `docs/spec/` unless the phase file is unclear.
2. Check that every earlier phase is marked done in PROGRESS.md. If one is not, stop and tell me.
3. Run `npm run test` and `npm run typecheck` first, so we know the starting state is green.
4. Produce a plan (use plan mode): migrations, shared types, repositories, services, routes,
   frontend pages/components, and one test per acceptance check. Note anything ambiguous and the
   choice you propose. Wait for my approval.
5. After approval, implement in this order: migration → shared → repositories → services →
   routes → tests → frontend. Run the tests as you go, not only at the end.
6. Done means: every acceptance check in the phase file has a passing automated test (or, for
   UI-only checks, you have run the app and confirmed it), `npm run test` and `npm run typecheck`
   pass, and `docs/demo-script.md` steps covered so far still work.
7. Update `docs/PROGRESS.md`: mark the phase done, list endpoints/pages added, deviations and
   known issues.
8. Commit: `git add -A && git commit -m "phase $ARGUMENTS: <one-line summary>"`.
9. Stop. Do not start the next phase. Tell me in a few lines what was built and anything I
   should check by hand.
