from __future__ import annotations

from ..db.pool import Db, exec_, maybe_one
from ..domain.canonical_json import js_json
from ..shared_constants import RuleDefault


def insert_rule_if_missing(db: Db, r: RuleDefault) -> None:
    exec_(
        db,
        "INSERT INTO rules (key, name, type, config) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (key) DO NOTHING",
        [r["key"], r["name"], r["type"], js_json(r["config"])],
    )


def get_rule_config(db: Db, key: str) -> object | None:
    """Current config of an active rule; None when missing or inactive. Read at the start of each operation (rule 11)."""
    row = maybe_one(db, "SELECT config FROM rules WHERE key = $1 AND active", [key])
    return row["config"] if row else None
