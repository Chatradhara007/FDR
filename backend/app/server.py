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
from .logging_setup import configure_logging
from .repositories import demo_repo
from .security import InsecureConfig, check_startup_config
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


# Advisory lock key: only one process seeds a showcase database, however many start at once.
SHOWCASE_SEED_LOCK = 7002


def prepare() -> None:
    configure_logging()
    check_startup_config()  # before touching data: SHOWCASE_MODE refuses placeholder secrets
    wait_for_db()
    applied = migrate()
    if applied:
        print(f"migrations applied: {', '.join(applied)}")
    if config.showcase_mode:
        seed_showcase_once()
    elif config.demo_mode:
        seed_empty_demo()


def seed_showcase_once(wait_seconds: float = 120) -> None:
    """SHOWCASE_MODE: load the sample dataset once, on a database with no instruments, holding an advisory lock so two
    instances starting together cannot both seed. Never seeds again once instruments exist. Without the mock bank the
    process refuses to start (a restart retries) rather than serve a half-empty product."""
    with get_pool().connection() as conn:
        conn.autocommit = True
        demo_repo.session_lock(conn, SHOWCASE_SEED_LOCK)
        try:
            if demo_repo.has_instruments(conn):
                print("showcase data present; not seeding")
                return
            deadline = time.monotonic() + wait_seconds
            while True:
                try:
                    r = reset_and_seed()
                    print(f"showcase data loaded: {r['instruments']} instruments in {r['durationMs'] / 1000:.1f} s")
                    return
                except AppError as err:
                    if err.code != "BANK_UNREACHABLE" or time.monotonic() > deadline:
                        raise SystemExit(f"showcase data not loaded: {err.message}") from err
                    print("waiting for the mock bank...")
                    time.sleep(2)
        finally:
            demo_repo.session_unlock(conn, SHOWCASE_SEED_LOCK)
            conn.autocommit = False


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
    try:
        prepare()
    except InsecureConfig as err:
        raise SystemExit(f"refusing to start: {err}") from None
    close_pool()  # the server process opens its own pool
    if "--migrate-only" in argv:
        return
    reload = "--reload" in argv
    uvicorn.run(
        "app.main:app", host="0.0.0.0", port=config.port, reload=reload, reload_dirs=["app"] if reload else None
    )


if __name__ == "__main__":
    main(sys.argv[1:])
