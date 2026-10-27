from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict, cast

from ..db import memo
from ..db.pool import Db, exec_, one


class ClockRow(TypedDict):
    mode: Literal["REAL", "SIMULATED"]
    simulated_now: datetime | None


def read_clock(db: Db, for_update: bool = False) -> ClockRow:
    cache = memo.active()
    if cache is not None and not for_update and "clock" in cache:
        return cast(ClockRow, cache["clock"])
    sql = f"SELECT mode, simulated_now FROM app_clock WHERE id = 1{' FOR UPDATE' if for_update else ''}"
    row = cast(ClockRow, one(db, sql, [], "app_clock row missing (run migrations)"))
    if cache is not None:
        cache["clock"] = row
    return row


def write_clock(db: Db, mode: Literal["REAL", "SIMULATED"], simulated_now: datetime | None) -> None:
    """Inside a replay memo session (db/memo.py) the clock is kept in memory; the replay writes the row at the end."""
    cache = memo.active()
    if cache is not None:
        cache["clock"] = ClockRow(mode=mode, simulated_now=simulated_now)
        return
    exec_(db, "UPDATE app_clock SET mode = $1, simulated_now = $2 WHERE id = 1", [mode, simulated_now])
