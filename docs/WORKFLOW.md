# How to build this with Claude Code

This repo is set up so Claude Code can build the whole portal phase by phase, with the same rules
every session. You drive; Claude Code writes, runs and tests the code.

## Prerequisites (on your machine)

- Node.js 22, npm 10, Git
- Docker Desktop (for Postgres; also runs the full stack)
- Claude Code, logged in with your Claude account (Pro covers it; usage is shared with claude.ai)

## First-time setup

```bash
# inside your empty repo
unzip fdr-portal-starter.zip -d .        # puts CLAUDE.md, docs/, .claude/, compose files at the root
cp .env.example .env
git add -A && git commit -m "chore: project spec pack" && git push
docker compose up -d db                  # Postgres for dev + tests
claude                                   # start Claude Code in the repo root
```

## The loop (one phase per session)

1. Start a fresh session (`/clear` or a new `claude`) — keeps context small and stretches your limits.
2. Type **`/phase 00`** (then `01`, `02` … `09`).
3. Claude reads CLAUDE.md, PROGRESS.md, DECISIONS.md and the phase file, checks the tests are green,
   and shows a plan. **Read the plan** — check it lists a test for every acceptance check. Approve.
4. It builds, runs tests until green, updates PROGRESS.md and commits. Push when you like.
5. Optional but recommended for Phases 03, 04 and 06: **`/verify-phase 03`** — an audit against the
   spec that reports gaps before you move on.
6. Open the app (`npm run dev`) and click through the phase's UI checks yourself for 2–3 minutes.

Other commands:
- **`/resume`** — after a usage-limit break or a crash mid-phase; it reconstructs state from git and PROGRESS.md.
- **`/fix-tests`** — when the suite is red and you want it fixed without weakening tests.

If the slash commands don't show up, paste this instead (replace NN):

```
Read CLAUDE.md, docs/PROGRESS.md, docs/DECISIONS.md and docs/phases/NN-*.md.
Implement Phase NN exactly as specified. First run npm run test and npm run typecheck, then show me
a plan (migrations, shared types, repositories, services, routes, frontend, one test per acceptance
check) and wait for my approval. After approval: implement, run tests and typecheck until green,
update docs/PROGRESS.md, commit "phase NN: <summary>", and stop. Do not start the next phase.
```

## Suggested schedule for 1–2 days

| Block | Phases | Why this order |
|---|---|---|
| Day 1, morning | 00, 01 | Foundation everything depends on |
| Day 1, afternoon | 02, 03 | Submission + the signature trust-tier feature |
| Day 1, evening | 04 | The clock and alerts — the demo's "wow" |
| Day 2, morning | 05, 06 | Renewal chain and release workflow |
| Day 2, afternoon | 07, 08 | Dashboard, my day, rules screen, audit integrity |
| Day 2, evening | 09 | Seed, demo tools, rehearsal, polish |

## If you run short of time — cut in this order

Never cut 01–04 or the release block in 06. Cut from the end:
1. Phase 09: skip Playwright; seed only the anchors A1–A9 plus ~15 filler instruments.
2. Phase 08: keep audit integrity + tamper demo + reminder/escalation rule editing; skip the other rule
   editors (JSON "Advanced" view covers them), skip encryption at rest (mention it as next step).
3. Phase 07: keep dashboard + my day; reports = register CSV only; improvement panel can be a slide.
4. Phase 06: drop the extra approver above ₹50 L and the printable release order.
Tell Claude Code explicitly: "Phase NN, reduced scope: skip X and Y" and it records the deviation.

## Managing usage limits

- One phase per session; `/clear` between phases. Avoid re-reading the PDFs (the phase files hold
  everything).
- Check what's left with `/status` in Claude Code before starting a big phase (03, 04, 06, 09).
- If you hit the limit mid-phase, nothing is lost: run `/resume` when it resets.
- Keep long chats on claude.ai to a minimum during the build — the allowance is shared.

## Tips for good results

- When Claude proposes a plan that skips an acceptance check or a DECISIONS item, say so before approving.
- If a UI looks generic, ask: "Polish this page per the design direction in docs/phases/00-environment.md §0.6".
- After each phase, quickly run the relevant demo steps from `docs/demo-script.md`.
- Commit often; push at least after every phase so you have a backup.
