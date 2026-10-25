"""Postgres access (psycopg 3, no ORM). SQL keeps the `$1` placeholder style; it is translated to
psycopg's named placeholders, so a parameter may be referenced more than once.

DATE, NUMERIC and UUID come back as strings ('YYYY-MM-DD', '2500000.00', ids); INT8 as int.
"""

from __future__ import annotations

import re
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import DictRow, dict_row
from psycopg.types.string import TextLoader
from psycopg_pool import ConnectionPool

from ..config import config
from ..domain.errors import NotFound

Conn = psycopg.Connection[DictRow]
Db = Conn | ConnectionPool[Conn]
Row = dict[str, Any]

_pool: ConnectionPool[Conn] | None = None

_PLACEHOLDER = re.compile(r"\$(\d+)")


def _configure(conn: Conn) -> None:
    for name in ("date", "numeric", "uuid"):
        conn.adapters.register_loader(name, TextLoader)


def get_pool() -> ConnectionPool[Conn]:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            config.database_url,
            min_size=1,
            max_size=20,
            timeout=10,
            open=True,
            configure=_configure,
            kwargs={"row_factory": dict_row, "connect_timeout": 2},
            connection_class=psycopg.Connection[DictRow],
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        p = _pool
        _pool = None
        p.close()


def _translate(sql: str, params: Sequence[object]) -> tuple[str, dict[str, object]]:
    text = _PLACEHOLDER.sub(lambda m: f"%(p{m.group(1)})s", sql.replace("%", "%%"))
    return text, {f"p{i + 1}": v for i, v in enumerate(params)}


def _execute(conn: Conn, sql: str, params: Sequence[object]) -> tuple[list[Row], int]:
    text, named = _translate(sql, params)
    cur = conn.execute(text, named)
    rows = cur.fetchall() if cur.description is not None else []
    return rows, cur.rowcount


def _run(db: Db, sql: str, params: Sequence[object]) -> tuple[list[Row], int]:
    if isinstance(db, ConnectionPool):
        with db.connection() as conn:
            return _execute(conn, sql, params)
    return _execute(db, sql, params)


def many(db: Db, sql: str, params: Sequence[object] = ()) -> list[Row]:
    return _run(db, sql, params)[0]


def maybe_one(db: Db, sql: str, params: Sequence[object] = ()) -> Row | None:
    rows = many(db, sql, params)
    return rows[0] if rows else None


def one(db: Db, sql: str, params: Sequence[object] = (), not_found_message: str | None = None) -> Row:
    row = maybe_one(db, sql, params)
    if row is None:
        raise NotFound(not_found_message or "Not found")
    return row


def exec_(db: Db, sql: str, params: Sequence[object] = ()) -> int:
    return _run(db, sql, params)[1]


def exec_script(db: Db, sql: str) -> None:
    """Runs SQL as-is (no placeholders), e.g. a migration file."""
    if isinstance(db, ConnectionPool):
        with db.connection() as conn:
            conn.execute(sql.encode())
    else:
        db.execute(sql.encode())


@contextmanager
def transaction() -> Iterator[Conn]:
    """One connection, one transaction: committed when the block exits normally, rolled back on error."""
    with get_pool().connection() as conn, conn.transaction():
        yield conn
