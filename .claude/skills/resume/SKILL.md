---
name: resume
description: Pick up interrupted work (e.g. after a usage-limit break) from git state and PROGRESS.md. Use only when the user runs /resume.
disable-model-invocation: true
---

Work was interrupted. Recover without redoing finished work.

1. Read `CLAUDE.md` and `docs/PROGRESS.md`.
2. Run `git status`, `git log --oneline -10` and `git diff --stat` to see uncommitted work.
3. Identify the phase in progress and read its file in `docs/phases/`.
4. Run `npm run typecheck` and `npm run test`.
5. Tell me in a short list: what is finished, what is half-done (with files), what fails, and the
   remaining steps. Then continue the phase from where it stopped, following the /phase procedure
   from step 5 onward.
