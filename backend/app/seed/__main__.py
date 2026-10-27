"""`npm run seed`: migrations, then the demo dataset (docs/seed-spec.md) replayed through the services.

Needs the mock bank running (`npm run dev:bank`, or `docker compose up`). Leaves the app clock SIMULATED at today's
date; Admin → clock → "Reset to today" (or POST /clock/reset) switches to REAL. Also writes demo step 1's sample PDFs
to docs/demo-files/.
"""

from __future__ import annotations

import sys

from ..config import REPO_ROOT
from ..db.migrate import migrate
from ..db.pool import close_pool
from ..domain.errors import AppError
from .base import DEMO_PASSWORD
from .replay import a1_sample, reset_and_seed


def main() -> None:
    applied = migrate()
    if applied:
        print(f"migrations applied: {', '.join(applied)}")
    try:
        result = reset_and_seed()
    except AppError as err:
        print(f"seed failed: {err.args[0] if err.args else err.code}", file=sys.stderr)
        close_pool()
        sys.exit(1)
    out = REPO_ROOT / "docs" / "demo-files"
    out.mkdir(parents=True, exist_ok=True)
    for doc_type, name, amount_on_copy in (
        ("FDR_COPY", "A1-fdr-copy.pdf", "claimed"),
        ("FDR_COPY", "A1-fdr-copy-different-amount.pdf", "bank"),
        ("BANK_LETTER", "A1-bank-letter.pdf", "claimed"),
    ):
        (out / name).write_bytes(a1_sample(doc_type, result["d0"], amount_on_copy=amount_on_copy))
    print(
        f"seed: {result['instruments']} instruments, {result['events']} events, {result['alerts']} alerts "
        f"in {result['durationMs'] / 1000:.1f} s; app clock SIMULATED at {result['d0']}; users' password {DEMO_PASSWORD}"
    )
    print(f"seed: sample files for demo step 1 written to {out}")
    close_pool()


if __name__ == "__main__":
    main()
