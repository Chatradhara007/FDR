from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict, cast

from ..db.pool import Db, exec_, one


class ClockRow(TypedDict):
    mode: Literal["REAL", "SIMULATED"]
    simulated_now: datetime | None


def read_clock(db: Db, for_update: bool = False) -> ClockRow:
    sql = f"SELECT mode, simulated_now FROM app_clock WHERE id = 1{' FOR UPDATE' if for_update else ''}"
    return cast(ClockRow, one(db, sql, [], "app_clock row missing (run migrations)"))


def write_clock(db: Db, mode: Literal["REAL", "SIMULATED"], simulated_now: datetime | None) -> None:
    exec_(db, "UPDATE app_clock SET mode = $1, simulated_now = $2 WHERE id = 1", [mode, simulated_now])
