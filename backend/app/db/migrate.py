"""Applies db/migrations/*.sql in filename order, each in its own transaction.

applied_at comes from the app clock once app_clock exists (wall time only for the very first migration,
when the clock is REAL anyway); callers may pass applied_at explicitly.
CLI: `python -m app.db.migrate [--reset]`.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

from ..domain import clock
from .pool import Db, close_pool, exec_, exec_script, get_pool, many, maybe_one, transaction

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def migrate(directory: Path | None = None, applied_at: datetime | None = None) -> list[str]:
    folder = directory or MIGRATIONS_DIR
    pool = get_pool()
    exec_(pool, "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL)")
    done = {r["name"] for r in many(pool, "SELECT name FROM schema_migrations")}
    files = sorted(p.name for p in folder.glob("*.sql")) if folder.exists() else []
    applied: list[str] = []
    for name in files:
        if name in done:
            continue
        sql = (folder / name).read_text(encoding="utf-8")
        with transaction() as tx:
            at = applied_at or _clock_now_if_available(tx)
            exec_script(tx, sql)
            exec_(tx, "INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [name, at])
        applied.append(name)
    return applied


def _clock_now_if_available(db: Db) -> datetime:
    exists = maybe_one(db, "SELECT to_regclass('public.app_clock') AS t")
    return clock.now(db) if exists and exists["t"] else datetime.now(UTC)


def reset_schema(db: Db | None = None) -> None:
    target = db or get_pool()
    exec_(target, "DROP SCHEMA IF EXISTS public CASCADE")
    exec_(target, "CREATE SCHEMA public")


def main(argv: list[str]) -> None:
    if "--reset" in argv:
        reset_schema()
        print("schema public dropped and recreated")
    applied = migrate()
    print(f"applied: {', '.join(applied)}" if applied else "no pending migrations")
    close_pool()


if __name__ == "__main__":
    main(sys.argv[1:])
