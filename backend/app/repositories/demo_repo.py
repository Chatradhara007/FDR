"""SQL for the demo tools (Phase 9): wiping the data before a reset, and the counts it reports."""

from __future__ import annotations

from typing import cast

from ..db.pool import Db, exec_, many, maybe_one, one


def try_lock(db: Db, key: int) -> bool:
    """Transaction-level advisory lock without waiting; False when another transaction holds it."""
    return bool(one(db, "SELECT pg_try_advisory_xact_lock($1) AS ok", [key])["ok"])


def lock(db: Db, key: int) -> None:
    many(db, "SELECT pg_advisory_xact_lock($1)", [key])


def truncate_all(db: Db) -> None:
    """Empties every table except schema_migrations (row triggers, incl. the events append-only one, do not fire
    on TRUNCATE) and puts back the app clock row."""
    tables = many(
        db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
    )
    names = ", ".join(f'"{t["tablename"]}"' for t in tables)
    exec_(db, f"TRUNCATE {names} RESTART IDENTITY CASCADE")
    exec_(db, "INSERT INTO app_clock (id, mode) VALUES (1, 'REAL')")


def count(db: Db, table: str) -> int:
    assert table in ("instruments", "events", "alerts")
    return cast(int, one(db, f"SELECT count(*)::int AS n FROM {table}")["n"])


def find_instrument_id(db: Db, bank: str, reference_no: str) -> str | None:
    """The newest instrument with this bank and (normalised) reference, if any."""
    row = maybe_one(
        db,
        """SELECT id FROM instruments WHERE issuing_bank = $1 AND reference_no = $2
            ORDER BY created_at DESC, id LIMIT 1""",
        [bank, reference_no],
    )
    return cast(str, row["id"]) if row else None
