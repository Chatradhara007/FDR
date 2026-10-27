from __future__ import annotations

from datetime import datetime
from typing import TypedDict, cast

from ..db import memo
from ..db.pool import Db, exec_, many, maybe_one
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
    cache = memo.active()
    if cache is not None and f"rule:{key}" in cache:
        return cache[f"rule:{key}"]
    row = maybe_one(db, "SELECT config FROM rules WHERE key = $1 AND active", [key])
    config = row["config"] if row else None
    if cache is not None:
        cache[f"rule:{key}"] = config
    return config


class RuleRow(TypedDict):
    id: str
    key: str
    name: str
    type: str
    config: object
    active: bool
    version: int
    updatedAt: datetime | None
    updatedBy: str | None
    updatedByName: str | None


SELECT_RULE = """
  SELECT r.id, r.key, r.name, r.type, r.config, r.active, r.version, r.updated_at AS "updatedAt",
         r.updated_by AS "updatedBy", u.name AS "updatedByName"
    FROM rules r LEFT JOIN users u ON u.id = r.updated_by"""


def list_rules(db: Db) -> list[RuleRow]:
    return cast(list[RuleRow], many(db, f"{SELECT_RULE} ORDER BY r.key"))


def find_rule(db: Db, key: str) -> RuleRow | None:
    return cast(RuleRow | None, maybe_one(db, f"{SELECT_RULE} WHERE r.key = $1", [key]))


def lock_rule(tx: Db, key: str) -> RuleRow | None:
    row = maybe_one(tx, "SELECT id FROM rules WHERE key = $1 FOR UPDATE", [key])
    return find_rule(tx, key) if row else None


def update_rule(tx: Db, key: str, config: object, active: bool, user_id: str, at: datetime) -> None:
    exec_(
        tx,
        """UPDATE rules SET config = $2::jsonb, active = $3, updated_at = $4, updated_by = $5, version = version + 1
          WHERE key = $1""",
        [key, js_json(config), active, at, user_id],
    )
