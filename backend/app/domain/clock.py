"""The one clock (CLAUDE.md rule 2). Business code reads time only through now()/today().

This file is the only place that reads wall time for business purposes. Times are millisecond
precision (like the JS Date the audit hashes were defined with).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, timezone
from typing import Literal

from ..db.pool import Db
from ..repositories.clock_repo import read_clock, write_clock

ClockMode = Literal["REAL", "SIMULATED"]

# India has no daylight saving time, so a fixed offset is exact.
IST = timezone(timedelta(hours=5, minutes=30), "Asia/Kolkata")


def _ms(dt: datetime) -> datetime:
    return dt.replace(microsecond=dt.microsecond // 1000 * 1000)


def mode(db: Db) -> ClockMode:
    return read_clock(db)["mode"]


def now(db: Db) -> datetime:
    """SIMULATED ? simulated_now : wall time (UTC, millisecond precision)."""
    row = read_clock(db)
    if row["mode"] == "SIMULATED" and row["simulated_now"] is not None:
        return _ms(row["simulated_now"].astimezone(UTC))
    return _ms(datetime.now(UTC))


def today(db: Db) -> str:
    """Business date 'YYYY-MM-DD' in Asia/Kolkata."""
    return ist_date(now(db))


def ist_date(d: datetime) -> str:
    """Calendar date of an instant in Asia/Kolkata."""
    return d.astimezone(IST).date().isoformat()


def set_simulated(db: Db, day: str) -> None:
    """Simulates `day` at 10:00 IST."""
    write_clock(db, "SIMULATED", datetime.fromisoformat(f"{day}T10:00:00+05:30").astimezone(UTC))


def advance_days(db: Db, n: int) -> None:
    """Moves n days from the current now() (keeps the time of day) and switches to SIMULATED."""
    write_clock(db, "SIMULATED", now(db) + timedelta(days=n))


def reset_to_real(db: Db) -> None:
    write_clock(db, "REAL", None)


def days_between(a: str, b: str) -> int:
    """Calendar days b - a for 'YYYY-MM-DD' strings (D22: no business-day logic)."""
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def add_days(day: str, n: int) -> str:
    """'YYYY-MM-DD' plus n calendar days."""
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()
