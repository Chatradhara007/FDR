"""Rules for the evaluation job, read at the start of each run (CLAUDE.md rule 11).

A rule missing from the table falls back to its default in shared/constants.json; a stored config that does not
validate raises, because the Phase 8 editor validates every save with the same models.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from ..db.pool import Db
from ..repositories.rule_repo import get_rule_config
from ..schemas import AfterDaysRule, EscalationRule, OverdueRenewalRule, ReminderRule, RenewalChecksRule
from ..shared_constants import RULE_DEFAULTS
from .errors import AppError

_DEFAULTS = {r["key"]: r["config"] for r in RULE_DEFAULTS}


@dataclass(frozen=True)
class Rules:
    reminder: ReminderRule
    pending_verification: AfterDaysRule
    discrepancy_open: AfterDaysRule
    overdue_renewal: OverdueRenewalRule
    release_pending: AfterDaysRule
    escalation: EscalationRule

    @property
    def expiring_window(self) -> int:
        """ACTIVE -> EXPIRING when maturity is this many days away or closer (largest reminder offset)."""
        return max(o.days for o in self.reminder.offsets)

    @property
    def grace_days(self) -> int:
        return self.overdue_renewal.grace_days


def _load[M: (ReminderRule, AfterDaysRule, OverdueRenewalRule, EscalationRule, RenewalChecksRule)](
    db: Db, key: str, model: type[M]
) -> M:
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
        release_pending=_load(db, "release_pending", AfterDaysRule),
        escalation=_load(db, "escalation", EscalationRule),
    )


def load_renewal_checks(db: Db) -> RenewalChecksRule:
    """Rule 'renewal_checks' (Phase 5), read at the start of each submit / accept of a replacement."""
    return _load(db, "renewal_checks", RenewalChecksRule)
