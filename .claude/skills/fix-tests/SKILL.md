---
name: fix-tests
description: Make the test suite and typecheck green without weakening tests. Use only when the user runs /fix-tests.
disable-model-invocation: true
---

1. Run `npm run typecheck` and `npm run test`. Collect every failure.
2. For each failure decide whether the code or the test is wrong, using the phase files and
   `docs/DECISIONS.md` as the source of truth. Never delete, skip or loosen an assertion just to
   pass; if a test really is wrong, explain why before changing it.
3. Fix, re-run, repeat until green. Then summarise the root causes in a few lines and commit
   "fix: <summary>".
