"""Rules administration (Phase 8 §8.1). Every save is validated with the rule's own model (the same models the
evaluation job and the services load rules with), so a stored config can never be one the system cannot read."""

from __future__ import annotations

from typing import TypedDict, cast

from ..db.pool import get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of
from ..domain.audit import record_event
from ..domain.canonical_json import iso_ms
from ..domain.errors import Conflict, NotFound, ValidationFailed
from ..repositories import rule_repo
from ..repositories.rule_repo import RuleRow
from ..schemas import RULE_CONFIG_MODELS, FieldIssue, RuleUpdateInput, model_issues
from ..shared_constants import RULE_DEFAULTS

_DEFAULTS: dict[str, object] = {r["key"]: r["config"] for r in RULE_DEFAULTS}
_ORDER = {r["key"]: i for i, r in enumerate(RULE_DEFAULTS)}


class RuleView(TypedDict):
    key: str
    name: str
    type: str
    config: object
    defaultConfig: object
    active: bool
    version: int
    updatedAt: str | None
    updatedByName: str | None


def _view(r: RuleRow) -> RuleView:
    return {
        "key": r["key"],
        "name": r["name"],
        "type": r["type"],
        "config": r["config"],
        "defaultConfig": _DEFAULTS.get(r["key"]),
        "active": r["active"],
        "version": r["version"],
        "updatedAt": iso_ms(r["updatedAt"]) if r["updatedAt"] else None,
        "updatedByName": r["updatedByName"],
    }


def list_rules() -> list[RuleView]:
    rows = rule_repo.list_rules(get_pool())
    rows.sort(key=lambda r: (_ORDER.get(r["key"], len(_ORDER)), r["key"]))
    return [_view(r) for r in rows]


def validate_config(key: str, config: object) -> dict[str, object]:
    """The normalised config (API field names), or 422 listing every failing field as `config.<path>`."""
    model = RULE_CONFIG_MODELS.get(key)
    if model is None:
        if not isinstance(config, dict):
            raise ValidationFailed([{"field": "config", "message": "Enter a JSON object"}])
        return cast(dict[str, object], config)
    issues = model_issues(model, config, "body")
    if issues:
        raise ValidationFailed(
            [
                FieldIssue(field="config" if i["field"] == "body" else f"config.{i['field']}", message=i["message"])
                for i in issues
            ]
        )
    return model.model_validate(config).model_dump(mode="json", by_alias=True, exclude_none=True)


def _save(user: AuthUser, key: str, config: object, active: bool, version: int | None, restored: bool) -> RuleView:
    with transaction() as tx:
        rule = rule_repo.lock_rule(tx, key)
        if rule is None:
            raise NotFound("Rule not found")
        if version is not None and rule["version"] != version:
            raise Conflict(
                "This rule was changed by someone else — reload and try again",
                {"currentVersion": rule["version"]},
                "STALE_VERSION",
            )
        rule_repo.update_rule(tx, key, config, active, user.id, clock.now(tx))
        after: dict[str, object] = {"key": key, "config": config, "active": active}
        if restored:
            after["restoredDefault"] = True
        record_event(
            tx,
            actor=actor_of(user),
            action="RULE_UPDATED",
            entity_type="rule",
            entity_id=rule["id"],
            before={"key": key, "config": rule["config"], "active": rule["active"]},
            after=after,
        )
        saved = rule_repo.find_rule(tx, key)
    assert saved is not None
    return _view(saved)


def update_rule(user: AuthUser, key: str, data: RuleUpdateInput) -> RuleView:
    """Takes effect on the next operation / evaluation run: rules are read fresh each time (rule 11)."""
    if rule_repo.find_rule(get_pool(), key) is None:
        raise NotFound("Rule not found")
    config = validate_config(key, data.config)
    return _save(user, key, config, data.active, data.version, restored=False)


def restore_default(user: AuthUser, key: str) -> RuleView:
    if key not in _DEFAULTS:
        raise NotFound("Rule not found")
    return _save(user, key, validate_config(key, _DEFAULTS[key]), True, None, restored=True)
