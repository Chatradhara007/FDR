"""`npm run seed`: migrations + base dataset. Phase 9 adds the demo instruments (docs/seed-spec.md)."""

from __future__ import annotations

from ..db.migrate import migrate
from ..db.pool import close_pool, get_pool
from .base import DEMO_PASSWORD, seed_base


def main() -> None:
    applied = migrate()
    if applied:
        print(f"migrations applied: {', '.join(applied)}")
    seed_base(get_pool())
    print(f"seed: base institutions, users (password {DEMO_PASSWORD}) and rules loaded")
    close_pool()


if __name__ == "__main__":
    main()
