"""shared/constants.json is the single source of constants for Python and the frontend."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from app.shared_constants import (
    ALLOWED,
    DOC_TYPES,
    EVENT_LABELS,
    INSTITUTION_VISIBLE_ACTIONS,
    INSTRUMENT_STATUSES,
    INSTRUMENT_TYPES,
    ROLES,
    STATUS_LABELS,
    TERMINAL_STATUSES,
    TRUST_TIERS,
    VERIFICATION_STATES,
    can_transition,
)

ROOT = Path(__file__).resolve().parents[2]
INIT_SQL = (ROOT / "backend" / "app" / "db" / "migrations" / "001_init.sql").read_text(encoding="utf-8")


def sql_enum(name: str) -> tuple[str, ...]:
    m = re.search(rf"CREATE TYPE {name} AS ENUM \(([^)]*)\)", INIT_SQL)
    assert m, name
    return tuple(re.findall(r"'([^']+)'", m.group(1)))


def test_transitions_table_covers_every_status_and_only_names_known_statuses() -> None:
    assert sorted(ALLOWED) == sorted(INSTRUMENT_STATUSES)
    for targets in ALLOWED.values():
        assert set(targets) <= set(INSTRUMENT_STATUSES)


def test_terminal_statuses_have_no_exits() -> None:
    for s in TERMINAL_STATUSES:
        assert ALLOWED[s] == ()


def test_can_transition() -> None:
    assert can_transition("DRAFT", "SUBMITTED")
    assert not can_transition("DRAFT", "ACTIVE")
    assert can_transition("RELEASE_REQUESTED", "LAPSED")


def test_sql_enums_match_the_json() -> None:
    assert sql_enum("user_role") == ROLES
    assert sql_enum("instrument_type") == INSTRUMENT_TYPES
    assert sql_enum("instrument_status") == INSTRUMENT_STATUSES
    assert sql_enum("trust_tier") == TRUST_TIERS
    assert sql_enum("verification_state") == VERIFICATION_STATES
    assert len(DOC_TYPES) == len(set(DOC_TYPES))


def test_every_status_has_a_label_and_a_status_event_label() -> None:
    for s in INSTRUMENT_STATUSES:
        assert STATUS_LABELS[s]
        assert EVENT_LABELS[f"STATUS_{s}"] == f"Status changed to {STATUS_LABELS[s]}"
        assert f"STATUS_{s}" in INSTITUTION_VISIBLE_ACTIONS


def test_generated_typescript_types_are_up_to_date() -> None:
    res = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "gen_shared_types.py"), "--check"], capture_output=True, text=True
    )
    assert res.returncode == 0, res.stderr
