"""Entry point: wait for the database, apply migrations, then serve.

`python -m app.server` in Docker. `npm run dev` runs `python -m app.server --migrate-only` (wait for the
database, migrate, exit) and then `python -m uvicorn app.main:app --reload`.
"""

from __future__ import annotations

import sys
import time

import uvicorn

from .config import config
from .db.migrate import migrate
from .db.pool import close_pool, get_pool, maybe_one
from .domain.errors import AppError
from .seed.base import seed_base
from .seed.replay import reset_and_seed


def wait_for_db(timeout_seconds: float = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            maybe_one(get_pool(), "SELECT 1")
            return
        except Exception:
            close_pool()
            if time.monotonic() > deadline:
                raise
            print("waiting for database...")
            time.sleep(1)


def prepare() -> None:
    wait_for_db()
    applied = migrate()
    if applied:
        print(f"migrations applied: {', '.join(applied)}")
    if config.demo_mode:
        seed_empty_demo()


def seed_empty_demo(wait_seconds: float = 60) -> None:
    """DEMO_MODE on an empty database (a clean `docker compose up`): load the demo dataset once, so there is someone
    to sign in as. Waits for the mock bank (it starts alongside); without it, only the base users and rules."""
    if maybe_one(get_pool(), "SELECT 1 AS x FROM users LIMIT 1"):
        return
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            r = reset_and_seed()
            print(f"demo data loaded: {r['instruments']} instruments in {r['durationMs'] / 1000:.1f} s")
            return
        except AppError as err:
            if err.code != "BANK_UNREACHABLE" or time.monotonic() > deadline:
                print(f"demo data not loaded ({err.message}); base users and rules only")
                seed_base(get_pool())
                return
            print("waiting for the mock bank...")
            time.sleep(2)


def main(argv: list[str]) -> None:
    prepare()
    close_pool()  # the server process opens its own pool
    if "--migrate-only" in argv:
        return
    reload = "--reload" in argv
    uvicorn.run(
        "app.main:app", host="0.0.0.0", port=config.port, reload=reload, reload_dirs=["app"] if reload else None
    )


if __name__ == "__main__":
    main(sys.argv[1:])
