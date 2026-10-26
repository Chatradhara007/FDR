"""Rules for the evaluation job, read at the start of each run (CLAUDE.md rule 11).

A rule missing from the table falls back to its default in shared/constants.json; a stored config that does not
validate raises, because the Phase 8 editor validates every save with the same models.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from ..db.pool import Db
from ..repositories.rule_repo import get_rule_config
from ..schemas import (
    AfterDaysRule,
    ApprovalLevelsRule,
    EscalationRule,
    ImprovementBaselineRule,
    OverdueRenewalRule,
    ReleaseConditionsRule,
    ReleasePendingRule,
    ReminderRule,
    RenewalChecksRule,
    RiskWeightsRule,
)
from ..shared_constants import RULE_DEFAULTS
from .errors import AppError

_DEFAULTS = {r["key"]: r["config"] for r in RULE_DEFAULTS}


@dataclass(frozen=True)
class Rules:
    reminder: ReminderRule
    pending_verification: AfterDaysRule
    discrepancy_open: AfterDaysRule
    overdue_renewal: OverdueRenewalRule
    release_pending: ReleasePendingRule
    escalation: EscalationRule

    @property
    def expiring_window(self) -> int:
        """ACTIVE -> EXPIRING when maturity is this many days away or closer (largest reminder offset)."""
        return max(o.days for o in self.reminder.offsets)

    @property
    def grace_days(self) -> int:
        return self.overdue_renewal.grace_days


def _load[
    M: (
        ReminderRule, AfterDaysRule, OverdueRenewalRule, EscalationRule, RenewalChecksRule, ReleaseConditionsRule,
        ApprovalLevelsRule, RiskWeightsRule, ImprovementBaselineRule, ReleasePendingRule,
    )
](db: Db, key: str, model: type[M]) -> M:  # fmt: skip
    config = get_rule_config(db, key)
    try:
        return model.model_validate(_DEFAULTS[key] if config is None else config)
    except ValidationError as err:
        raise AppError("RULE_INVALID", f"Rule '{key}' has an invalid configuration", str(err), 500) from None


def load_rules(db: Db) -> Rules:
    return Rules(
        reminder=_load(db, "reminder", ReminderRule),
        pending_verification=_load(db, "pending_verification", AfterDaysRule),
        discrepancy_open=_load(db, "discrepancy_open", AfterDaysRule),
        overdue_renewal=_load(db, "overdue_renewal", OverdueRenewalRule),
        release_pending=_load(db, "release_pending", ReleasePendingRule),
        escalation=_load(db, "escalation", EscalationRule),
    )


def load_renewal_checks(db: Db) -> RenewalChecksRule:
    """Rule 'renewal_checks' (Phase 5), read at the start of each submit / accept of a replacement."""
    return _load(db, "renewal_checks", RenewalChecksRule)


def load_release_conditions(db: Db) -> ReleaseConditionsRule:
    """Rule 'release_conditions' (Phase 6), read when a release request is created."""
    return _load(db, "release_conditions", ReleaseConditionsRule)


def load_approval_levels(db: Db) -> ApprovalLevelsRule:
    """Rule 'approval_levels' (Phase 6), read when a release request is created (the chain is then snapshotted)."""
    return _load(db, "approval_levels", ApprovalLevelsRule)


def load_risk_weights(db: Db) -> RiskWeightsRule:
    """Rule 'risk_weights' (Phase 7), read at the start of each My day request."""
    return _load(db, "risk_weights", RiskWeightsRule)


def load_improvement_baseline(db: Db) -> ImprovementBaselineRule:
    """Rule 'improvement_baseline' (Phase 7): the manual-process figures; changed only through the rules table."""
    return _load(db, "improvement_baseline", ImprovementBaselineRule)
