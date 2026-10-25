"""Source guards: only state_machine.py changes instruments.status; only the clock (and listed
infrastructure) reads wall time."""

from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

FILES = {
    p.relative_to(APP).as_posix(): p.read_text(encoding="utf-8")
    for p in sorted(APP.rglob("*"))
    if p.suffix in (".py", ".sql") and "__pycache__" not in p.parts
}


def test_ac10_only_domain_state_machine_py_updates_instruments_status() -> None:
    offenders = [
        rel
        for rel, text in FILES.items()
        if rel != "domain/state_machine.py"
        and (
            re.search(r"\bSET\s+status\b", text, re.IGNORECASE)
            or re.search(r"UPDATE\s+instruments\b[^;`\"']*?[\s,]status\s*=", text, re.IGNORECASE | re.DOTALL)
        )
    ]
    assert offenders == []
    assert re.search(r"SET status = \$1", FILES["domain/state_machine.py"])


def test_only_the_clock_and_listed_infrastructure_reads_wall_time() -> None:
    # Infrastructure exceptions: health timestamp, the first migration before app_clock exists, server
    # startup wait, JWT expiry and login rate limiting (CLAUDE.md rule 2).
    allowed = {
        "domain/clock.py",
        "services/health_service.py",
        "db/migrate.py",
        "server.py",
        "domain/token.py",
        "middleware/rate_limit.py",
    }
    wall_time = re.compile(
        r"datetime\.now\(|datetime\.utcnow\(|date\.today\(|datetime\.today\(|time\.time\(|time\.monotonic\("
        r"|\bnow\(\)|CURRENT_DATE|CURRENT_TIMESTAMP|LOCALTIMESTAMP",
        re.IGNORECASE,
    )
    offenders = [
        rel for rel, text in FILES.items() if rel not in allowed and wall_time.search(text.replace("clock.now(", ""))
    ]
    assert offenders == []
