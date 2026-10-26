"""Request validation (pydantic v2). Same rules and messages as the original zod schemas.

Field names are the API's camelCase names (aliases); `middleware/validate.py` turns errors into
`[{ field, message }]`, one entry per failing field.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from itertools import pairwise
from typing import Any, ClassVar, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, ValidationError, ValidationInfo, field_validator, model_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from .domain.normalize import norm_amount, norm_date, norm_ref
from .repositories.instrument_repo import InstrumentSort
from .repositories.scrutiny_repo import AssignedFilter
from .shared_constants import (
    ALERT_KINDS,
    ALERT_STATUSES,
    BANKS,
    DOC_TYPES,
    INSTRUMENT_TYPES,
    OBSERVATION_SEVERITIES,
    RELEASE_AUTO_CONDITIONS,
    RELEASE_DOC_TYPES,
    RELEASE_LEVEL_ACTIONS,
    RELEASE_REQUEST_STATUSES,
    REMINDER_RECIPIENT_ROLES,
    ROLES,
    VERIFICATION_STATES,
    AlertKind,
    DocType,
    InstrumentStatus,
    InstrumentType,
    ObservationSeverity,
    ReleaseLevelAction,
    ReleaseRequestStatus,
    Role,
    VerificationState,
)


class FieldIssue(TypedDict):
    """One failing field; validation errors always list every one (CLAUDE.md rule 7)."""

    field: str
    message: str


def fail(message: str) -> PydanticCustomError:
    return PydanticCustomError("custom", message)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    # Message for a required field that is absent, by API field name.
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {}

    def provided(self) -> dict[str, Any]:
        """The fields the client actually sent (API names), so PATCH can tell "absent" from "null"."""
        data = self.model_dump(by_alias=True)
        return {to_camel(name): data[to_camel(name)] for name in self.model_fields_set}


Part = Literal["body", "query"]


def issues_from(model: type[ApiModel], err: ValidationError, part: Part) -> list[FieldIssue]:
    """pydantic errors -> `[{ field, message }]`; query fields are prefixed `query.`, model-level errors use the part."""
    issues: list[FieldIssue] = []
    for e in err.errors():
        field = ".".join(str(x) for x in e["loc"])
        message = model.MISSING_MESSAGES.get(field, "Required") if e["type"] == "missing" else e["msg"]
        if not field:
            field = part
        elif part != "body":
            field = f"{part}.{field}"
        issues.append({"field": field, "message": message})
    return issues


def model_issues(model: type[ApiModel], data: object, part: Part = "body") -> list[FieldIssue]:
    try:
        model.model_validate(data)
    except ValidationError as err:
        return issues_from(model, err, part)
    return []


# ---- primitives -------------------------------------------------------------------------------

_EMAIL = re.compile(r"^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$")
_DATE_FORMAT = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

# Largest accepted amount: ₹100 crore, compared in paise as integers (never floats).
MAX_AMOUNT = "1000000000.00"


def _paise(amount: str) -> int:
    return int(amount.replace(".", ""))


def _blank_to_none(v: object) -> object:
    return None if isinstance(v, str) and v.strip() == "" else v


def _require_str(v: object) -> str:
    if not isinstance(v, str):
        raise fail("Enter text")
    return v


def date_string(v: object) -> str:
    """Strict calendar date 'YYYY-MM-DD'."""
    s = _require_str(v)
    if not _DATE_FORMAT.match(s):
        raise fail("Use the format YYYY-MM-DD")
    try:
        ok = norm_date(s) == s
    except ValueError:
        ok = False
    if not ok:
        raise fail("Not a valid calendar date")
    return s


def _optional_date(v: object) -> str | None:
    v = _blank_to_none(v)
    return None if v is None else date_string(v)


def _optional_text(v: object, max_len: int, label: str) -> str | None:
    v = _blank_to_none(v)
    if v is None:
        return None
    s = re.sub(r"\s+", " ", _require_str(v).strip())
    if len(s) > max_len:
        raise fail(f"{label} must be at most {max_len} characters")
    return s


def _positive_int(v: object, message: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int | float) or not float(v).is_integer():
        raise fail(message)
    return int(v)


# ---- auth and clock ---------------------------------------------------------------------------


class LoginInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {
        "email": "Enter a valid email address",
        "password": "Enter your password",
    }

    email: str
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v: object) -> str:
        if not isinstance(v, str) or not _EMAIL.match(v.strip().lower()):
            raise fail("Enter a valid email address")
        return v.strip().lower()

    @field_validator("password", mode="before")
    @classmethod
    def _password(cls, v: object) -> str:
        if not isinstance(v, str) or len(v) < 1:
            raise fail("Enter your password")
        return v


class ClockAdvanceInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"days": "Enter a number of days"}

    days: int

    @field_validator("days", mode="before")
    @classmethod
    def _days(cls, v: object) -> int:
        if isinstance(v, bool) or not isinstance(v, int | float):
            raise fail("Enter a number of days")
        if not float(v).is_integer():
            raise fail("Whole days only")
        if v < 1:
            raise fail("At least 1 day")
        if v > 730:
            raise fail("At most 730 days")
        return int(v)


class ClockSetInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"date": "Use the format YYYY-MM-DD"}

    date: str

    @field_validator("date", mode="before")
    @classmethod
    def _date(cls, v: object) -> str:
        return date_string(v)


# ---- Phase 02: instrument submission ----------------------------------------------------------


class InstrumentFields(ApiModel):
    """Every editable field; drafts may leave any of them empty."""

    reference_no: str | None = None
    issuing_bank: str | None = None
    branch: str | None = None
    amount: str | None = None
    issue_date: str | None = None
    maturity_date: str | None = None
    beneficiary_name: str | None = None
    lien_marked: bool | None = None
    purpose: str | None = None

    @field_validator("reference_no", mode="before")
    @classmethod
    def _reference_no(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        s = norm_ref(_require_str(v))
        if not 6 <= len(s) <= 30:
            raise fail("Reference number must be 6–30 characters")
        if not re.fullmatch(r"[A-Z0-9/-]+", s):
            raise fail("Use only letters, digits, hyphens and slashes")
        return s

    @field_validator("issuing_bank", mode="before")
    @classmethod
    def _issuing_bank(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if v not in BANKS:
            raise fail("Choose a bank from the list")
        return str(v)

    @field_validator("amount", mode="before")
    @classmethod
    def _amount(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, str | int | float):
            raise fail("Enter an amount in rupees with at most two decimals, e.g. 25,00,000")
        try:
            a = norm_amount(v)
        except ValueError:
            raise fail("Enter an amount in rupees with at most two decimals, e.g. 25,00,000") from None
        if _paise(a) <= 0:
            raise fail("Amount must be more than zero")
        if _paise(a) > _paise(MAX_AMOUNT):
            raise fail("Amount cannot exceed ₹100 crore")
        return a

    @field_validator("issue_date", "maturity_date", mode="before")
    @classmethod
    def _dates(cls, v: object) -> str | None:
        return _optional_date(v)

    @field_validator("branch", mode="before")
    @classmethod
    def _branch(cls, v: object) -> str | None:
        return _optional_text(v, 80, "Branch")

    @field_validator("beneficiary_name", mode="before")
    @classmethod
    def _beneficiary_name(cls, v: object) -> str | None:
        return _optional_text(v, 120, "Beneficiary name")

    @field_validator("purpose", mode="before")
    @classmethod
    def _purpose(cls, v: object) -> str | None:
        return _optional_text(v, 200, "Purpose")

    @field_validator("lien_marked", mode="before")
    @classmethod
    def _lien_marked(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Lien marked must be true or false")
        return v


def _instrument_type(v: object) -> InstrumentType:
    if v not in INSTRUMENT_TYPES:
        raise fail("Choose FDR or security deposit")
    return v


class InstrumentCreate(InstrumentFields):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"type": "Choose FDR or security deposit"}

    type: InstrumentType

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v: object) -> InstrumentType:
        return _instrument_type(v)


class InstrumentPatch(InstrumentFields):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"version": "version is required"}

    type: InstrumentType | None = None
    version: int

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v: object) -> InstrumentType:
        return _instrument_type(v)

    @field_validator("version", mode="before")
    @classmethod
    def _version(cls, v: object) -> int:
        n = _positive_int(v, "version is required")
        if n <= 0:
            raise fail("version must be a positive whole number")
        return n


REQUIRED_AT_SUBMIT: tuple[tuple[str, str], ...] = (
    ("referenceNo", "Enter the reference number"),
    ("issuingBank", "Choose the issuing bank"),
    ("amount", "Enter the amount"),
    ("issueDate", "Enter the issue date"),
    ("maturityDate", "Enter the maturity date"),
    ("beneficiaryName", "Enter the beneficiary name"),
)


def date_order_issue(issue_date: object, maturity_date: object) -> FieldIssue | None:
    """Maturity after issue: checked on every save (also a DB constraint)."""
    if (
        isinstance(issue_date, str)
        and isinstance(maturity_date, str)
        and issue_date
        and maturity_date
        and maturity_date <= issue_date
    ):
        return {"field": "maturityDate", "message": "Maturity date must be after the issue date"}
    return None


def submission_issues(v: Mapping[str, object], today: str) -> list[FieldIssue]:
    """Full check at submit (2.3 + D25): field formats, required fields, date rules against the app's `today`.

    Returns every failing field (one message per field).
    """
    issues: list[FieldIssue] = []
    seen: set[str] = set()

    def add(i: FieldIssue) -> None:
        if i["field"] in seen:
            return
        seen.add(i["field"])
        issues.append(i)

    keys = ("referenceNo", "issuingBank", "branch", "amount", "issueDate", "maturityDate", "beneficiaryName",
            "lienMarked", "purpose")  # fmt: skip
    for i in model_issues(InstrumentFields, {k: v.get(k) for k in keys}, "body"):
        add(i)
    for field, message in REQUIRED_AT_SUBMIT:
        if v.get(field) is None or v.get(field) == "":
            add({"field": field, "message": message})
    issue_date, maturity_date = v.get("issueDate"), v.get("maturityDate")
    if isinstance(issue_date, str) and issue_date and issue_date > today:
        add({"field": "issueDate", "message": "Issue date cannot be in the future"})
    order = date_order_issue(issue_date, maturity_date)
    if order:
        add(order)
    if isinstance(maturity_date, str) and maturity_date and maturity_date < today:
        add({"field": "maturityDate", "message": "Maturity date has already passed"})
    return issues


# ---- list query -------------------------------------------------------------------------------


def _optional_query_text(v: object) -> str | None:
    v = _blank_to_none(v)
    if v is None:
        return None
    s = _require_str(v).strip()
    if len(s) > 100:
        raise fail("At most 100 characters")
    return s


def _coerce_int(v: object, low: int, high: int | None) -> int:
    try:
        n = float(str(v).strip() or "0")
    except ValueError:
        raise fail("Enter a number") from None
    if not n.is_integer():
        raise fail("Enter a whole number")
    if n < low:
        raise fail(f"Must be at least {low}")
    if high is not None and n > high:
        raise fail(f"Must be at most {high}")
    return int(n)


class InstrumentListQuery(ApiModel):
    status: list[InstrumentStatus] | None = None
    type: InstrumentType | None = None
    bank: str | None = None
    region: str | None = None
    institution_id: str | None = None
    q: str | None = None
    maturity_from: str | None = None
    maturity_to: str | None = None
    sort: InstrumentSort = "maturityDate"
    page: int = 1
    page_size: int = Field(default=25)

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, v: object) -> list[str] | None:
        """Accepts `status=A&status=B`, `status[]=A` and `status=A,B`."""
        if v is None or v == "":
            return None
        values = v if isinstance(v, list) else [v]
        out = [s.strip() for x in values for s in str(x).split(",")]
        return [s for s in out if s]

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v: object) -> object:
        return _blank_to_none(v)

    @field_validator("bank", "region", "q", mode="before")
    @classmethod
    def _text(cls, v: object) -> str | None:
        return _optional_query_text(v)

    @field_validator("institution_id", mode="before")
    @classmethod
    def _institution_id(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if not isinstance(v, str) or not _UUID.match(v):
            raise fail("Not a valid id")
        return v

    @field_validator("maturity_from", "maturity_to", mode="before")
    @classmethod
    def _dates(cls, v: object) -> str | None:
        return _optional_date(v)

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: object) -> int:
        return _coerce_int(v, 1, None)

    @field_validator("page_size", mode="before")
    @classmethod
    def _page_size(cls, v: object) -> int:
        return _coerce_int(v, 1, 100)


def doc_type_or_none(v: object) -> DocType | None:
    return v if v in DOC_TYPES else None


# ---- Phase 03: scrutiny ----------------------------------------------------------------------


def _required_text(v: object, max_len: int, empty_message: str, label: str) -> str:
    if not isinstance(v, str) or not v.strip():
        raise fail(empty_message)
    s = v.strip()
    if len(s) > max_len:
        raise fail(f"{label} must be at most {max_len} characters")
    return s


class NoteInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"note": "Enter a note"}

    note: str

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, v: object) -> str:
        return _required_text(v, 1000, "Enter a note", "Note")


class ReasonInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"reason": "Enter the reason for returning the instrument"}

    reason: str

    @field_validator("reason", mode="before")
    @classmethod
    def _reason(cls, v: object) -> str:
        return _required_text(v, 1000, "Enter the reason for returning the instrument", "Reason")


class AcceptInput(ApiModel):
    override_note: str | None = None

    @field_validator("override_note", mode="before")
    @classmethod
    def _override_note(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        return None if v is None else _required_text(v, 1000, "Enter an override note", "Override note")


class ObservationCreate(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"text": "Enter the observation"}

    text: str
    severity: ObservationSeverity = "INFO"
    visible_to_institution: bool = False

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, v: object) -> str:
        return _required_text(v, 2000, "Enter the observation", "Observation")

    @field_validator("severity", mode="before")
    @classmethod
    def _severity(cls, v: object) -> ObservationSeverity:
        if v not in OBSERVATION_SEVERITIES:
            raise fail("Choose Info, Concern or Blocking")
        return v

    @field_validator("visible_to_institution", mode="before")
    @classmethod
    def _visible(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Must be true or false")
        return v


class DocumentCheckInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"documentId": "Choose the document you checked"}

    document_id: str
    note: str | None = None

    @field_validator("document_id", mode="before")
    @classmethod
    def _document_id(cls, v: object) -> str:
        if not isinstance(v, str) or not _UUID.match(v):
            raise fail("Choose the document you checked")
        return v.lower()

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, v: object) -> str | None:
        return _optional_text(v, 1000, "Note")


class QueueQuery(ApiModel):
    region: str | None = None
    bank: str | None = None
    verification_state: VerificationState | None = None
    assigned: AssignedFilter = "all"
    page: int = 1
    page_size: int = Field(default=25)

    @field_validator("region", "bank", mode="before")
    @classmethod
    def _text(cls, v: object) -> str | None:
        return _optional_query_text(v)

    @field_validator("verification_state", mode="before")
    @classmethod
    def _verification_state(cls, v: object) -> VerificationState | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if v not in VERIFICATION_STATES:
            raise fail("Unknown verification state")
        return v

    @field_validator("assigned", mode="before")
    @classmethod
    def _assigned(cls, v: object) -> AssignedFilter:
        v = _blank_to_none(v) or "all"
        if v not in ("me", "unassigned", "all"):
            raise fail("Use me, unassigned or all")
        return v

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: object) -> int:
        return _coerce_int(v, 1, None)

    @field_validator("page_size", mode="before")
    @classmethod
    def _page_size(cls, v: object) -> int:
        return _coerce_int(v, 1, 100)


# ---- Phase 04: rule configs (reused by the Phase 8 rules editor) and alert queries ----


def _recipients(v: object) -> list[Role]:
    if not isinstance(v, list) or not v:
        raise fail("Choose at least one recipient")
    if any(r not in ROLES for r in v):
        raise fail("Unknown recipient role")
    if len(set(v)) != len(v):
        raise fail("Each recipient once")
    return v


def _whole_days(v: object, low: int = 0) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise fail("Enter a whole number of days")
    if v < low:
        raise fail(f"Must be at least {low}")
    return v


class ReminderOffset(ApiModel):
    days: int
    recipients: list[Role]

    @field_validator("days", mode="before")
    @classmethod
    def _days(cls, v: object) -> int:
        return _whole_days(v, 1)

    @field_validator("recipients", mode="before")
    @classmethod
    def _recipients(cls, v: object) -> list[Role]:
        roles = _recipients(v)
        if any(r not in REMINDER_RECIPIENT_ROLES for r in roles):
            raise fail("Reminders go to institution, officer, approver or admin")
        return roles


class ReminderRule(ApiModel):
    """key 'reminder': maturity reminder offsets (days before maturity)."""

    offsets: list[ReminderOffset]

    @field_validator("offsets", mode="after")
    @classmethod
    def _offsets(cls, v: list[ReminderOffset]) -> list[ReminderOffset]:
        if not v:
            raise fail("Add at least one reminder offset")
        if len({o.days for o in v}) != len(v):
            raise fail("Each offset once")
        return sorted(v, key=lambda o: -o.days)


class AfterDaysRule(ApiModel):
    """keys 'pending_verification', 'discrepancy_open'."""

    after_days: int
    recipients: list[Role]

    @field_validator("after_days", mode="before")
    @classmethod
    def _after_days(cls, v: object) -> int:
        return _whole_days(v)

    @field_validator("recipients", mode="before")
    @classmethod
    def _recipients(cls, v: object) -> list[Role]:
        return _recipients(v)


class ReleasePendingRule(ApiModel):
    """key 'release_pending': the alert always goes to the role whose turn it is, so recipients cannot be set."""

    after_days: int
    recipients: None = None

    @field_validator("after_days", mode="before")
    @classmethod
    def _after_days(cls, v: object) -> int:
        return _whole_days(v)

    @field_validator("recipients", mode="before")
    @classmethod
    def _no_recipients(cls, v: object) -> None:
        raise fail("Release-pending alerts go to whoever must act at the current level; recipients cannot be set")


class OverdueRenewalRule(ApiModel):
    """key 'overdue_renewal': grace after maturity before an un-renewed instrument lapses."""

    grace_days: int
    recipients: list[Role]

    @field_validator("grace_days", mode="before")
    @classmethod
    def _grace_days(cls, v: object) -> int:
        return _whole_days(v)

    @field_validator("recipients", mode="before")
    @classmethod
    def _recipients(cls, v: object) -> list[Role]:
        return _recipients(v)


def _level_role(v: object) -> Role:
    if v not in ("officer", "approver", "admin"):
        raise fail("Choose officer, approver or admin")
    return v


class EscalationLevel(ApiModel):
    level: int
    role: Role
    after_days: int

    @field_validator("level", mode="before")
    @classmethod
    def _level(cls, v: object) -> int:
        return _whole_days(v, 1)

    @field_validator("role", mode="before")
    @classmethod
    def _role(cls, v: object) -> Role:
        return _level_role(v)

    @field_validator("after_days", mode="before")
    @classmethod
    def _after_days(cls, v: object) -> int:
        return _whole_days(v)


class EscalationRule(ApiModel):
    """key 'escalation' (D11): cumulative thresholds from the root alert."""

    levels: list[EscalationLevel]
    kinds: list[AlertKind]

    @field_validator("levels", mode="after")
    @classmethod
    def _levels(cls, v: list[EscalationLevel]) -> list[EscalationLevel]:
        if [x.level for x in v] != list(range(1, len(v) + 1)):
            raise fail("Levels must be numbered 1, 2, 3 … in order")
        if any(b.after_days <= a.after_days for a, b in pairwise(v)):
            raise fail("Each level must start more days after the root alert than the one before")
        return v

    @field_validator("kinds", mode="before")
    @classmethod
    def _kinds(cls, v: object) -> list[AlertKind]:
        if not isinstance(v, list) or any(k not in ALERT_KINDS for k in v):
            raise fail("Unknown alert kind")
        if len(set(v)) != len(v):
            raise fail("Each alert kind once")
        return v


class RenewalChecksRule(ApiModel):
    """key 'renewal_checks' (Phase 5): what is checked when a replacement is submitted and accepted."""

    require_later_maturity: bool
    flag_coverage_gap_days: int
    flag_lower_amount: bool

    @field_validator("require_later_maturity", "flag_lower_amount", mode="before")
    @classmethod
    def _flag(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Choose yes or no")
        return v

    @field_validator("flag_coverage_gap_days", mode="before")
    @classmethod
    def _gap_days(cls, v: object) -> int:
        return _whole_days(v)


_CONDITION_CODE = re.compile(r"^[A-Z][A-Z0-9_]{1,59}$")


class ReleaseConditionConfig(ApiModel):
    code: str
    auto: bool
    mandatory: bool
    description: str

    @field_validator("code", mode="before")
    @classmethod
    def _code(cls, v: object) -> str:
        if not isinstance(v, str) or not _CONDITION_CODE.match(v):
            raise fail("Use an UPPER_SNAKE code")
        return v

    @field_validator("auto", "mandatory", mode="before")
    @classmethod
    def _flag(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Choose yes or no")
        return v

    @field_validator("description", mode="before")
    @classmethod
    def _description(cls, v: object) -> str:
        return _required_text(v, 300, "Describe the condition", "Description")


class ReleaseConditionsRule(ApiModel):
    """key 'release_conditions' (Phase 6): copied into every new release request. Auto conditions are evaluated live,
    so only the codes the system knows how to evaluate may be marked auto."""

    conditions: list[ReleaseConditionConfig]

    @field_validator("conditions", mode="after")
    @classmethod
    def _conditions(cls, v: list[ReleaseConditionConfig]) -> list[ReleaseConditionConfig]:
        if len({c.code for c in v}) != len(v):
            raise fail("Each condition code once")
        unknown = [c.code for c in v if c.auto and c.code not in RELEASE_AUTO_CONDITIONS]
        if unknown:
            raise fail(f"No automatic check exists for {', '.join(unknown)}")
        return v


def _level_action(v: object) -> ReleaseLevelAction:
    if v not in RELEASE_LEVEL_ACTIONS:
        raise fail("Use RECOMMEND or DECIDE")
    return v


class ApprovalLevelConfig(ApiModel):
    role: Role
    action: ReleaseLevelAction
    label: str

    @field_validator("role", mode="before")
    @classmethod
    def _role(cls, v: object) -> Role:
        return _level_role(v)

    @field_validator("action", mode="before")
    @classmethod
    def _action(cls, v: object) -> ReleaseLevelAction:
        return _level_action(v)

    @field_validator("label", mode="before")
    @classmethod
    def _label(cls, v: object) -> str:
        return _required_text(v, 200, "Name the level", "Label")


class NumberedApprovalLevel(ApprovalLevelConfig):
    level: int

    @field_validator("level", mode="before")
    @classmethod
    def _level(cls, v: object) -> int:
        return _whole_days(v, 1)


class ApprovalLevelsRule(ApiModel):
    """key 'approval_levels' (Phase 6 §6.4): the release chain; `extraLevel` is appended above `extraApprovalAbove`."""

    levels: list[NumberedApprovalLevel]
    extra_approval_above: str | None = None
    extra_level: ApprovalLevelConfig | None = None

    @field_validator("levels", mode="after")
    @classmethod
    def _levels(cls, v: list[NumberedApprovalLevel]) -> list[NumberedApprovalLevel]:
        if [x.level for x in v] != list(range(1, len(v) + 1)):
            raise fail("Levels must be numbered 1, 2, 3 … in order")
        if v[0].role != "officer" or v[0].action != "RECOMMEND":
            raise fail("Level 1 must be the scrutiny officer's recommendation")
        if v[-1].action != "DECIDE":
            raise fail("The last level must decide")
        return v

    @field_validator("extra_approval_above", mode="before")
    @classmethod
    def _above(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        try:
            return norm_amount(str(v))
        except ValueError:
            raise fail("Enter an amount") from None


_INSTRUMENT_DOC_TYPES = tuple(d for d in DOC_TYPES if d not in RELEASE_DOC_TYPES)


def _doc_list(v: object) -> list[DocType]:
    if not isinstance(v, list) or not v:
        raise fail("Require at least one document")
    if any(d not in _INSTRUMENT_DOC_TYPES for d in v):
        raise fail("Unknown document type")
    if len(set(v)) != len(v):
        raise fail("Each document once")
    return v


class RequiredDocsRule(ApiModel):
    """key 'required_docs': documents each instrument type must carry before submit and accept (D4)."""

    fdr: list[DocType] = Field(alias="FDR")
    security_deposit: list[DocType] = Field(alias="SECURITY_DEPOSIT")

    @field_validator("fdr", "security_deposit", mode="before")
    @classmethod
    def _docs(cls, v: object) -> list[DocType]:
        return _doc_list(v)


class LienRequiredRule(ApiModel):
    """key 'lien_required' (D8): whether a lien in favour of AICTE is required, per instrument type."""

    fdr: bool = Field(alias="FDR")
    security_deposit: bool = Field(alias="SECURITY_DEPOSIT")

    @field_validator("fdr", "security_deposit", mode="before")
    @classmethod
    def _flag(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Choose yes or no")
        return v


RULE_CONFIG_MODELS: dict[str, type[ApiModel]] = {
    "required_docs": RequiredDocsRule,
    "lien_required": LienRequiredRule,
    "reminder": ReminderRule,
    "pending_verification": AfterDaysRule,
    "discrepancy_open": AfterDaysRule,
    "overdue_renewal": OverdueRenewalRule,
    "release_pending": ReleasePendingRule,
    "escalation": EscalationRule,
    "renewal_checks": RenewalChecksRule,
    "release_conditions": ReleaseConditionsRule,
    "approval_levels": ApprovalLevelsRule,
}

AlertStatusFilter = Literal["open", "OPEN", "ACKNOWLEDGED", "ESCALATED", "RESOLVED", "all"]


class AlertListQuery(ApiModel):
    status: AlertStatusFilter = "open"
    kind: AlertKind | None = None
    instrument_id: str | None = None
    mine: bool = False
    level: int | None = None
    page: int = 1
    page_size: int = Field(default=50)

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, v: object) -> AlertStatusFilter:
        v = _blank_to_none(v) or "open"
        if v not in ("open", "all", *ALERT_STATUSES):
            raise fail("Use open, all, OPEN, ACKNOWLEDGED, ESCALATED or RESOLVED")
        return v  # type: ignore[return-value]

    @field_validator("kind", mode="before")
    @classmethod
    def _kind(cls, v: object) -> AlertKind | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if v not in ALERT_KINDS:
            raise fail("Unknown alert kind")
        return v

    @field_validator("instrument_id", mode="before")
    @classmethod
    def _instrument_id(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if not isinstance(v, str) or not _UUID.match(v):
            raise fail("Not a valid id")
        return v

    @field_validator("mine", mode="before")
    @classmethod
    def _mine(cls, v: object) -> bool:
        v = _blank_to_none(v)
        if v in (None, False, "false", "0"):
            return False
        if v in (True, "true", "1"):
            return True
        raise fail("Use true or false")

    @field_validator("level", mode="before")
    @classmethod
    def _level(cls, v: object) -> int | None:
        v = _blank_to_none(v)
        return None if v is None else _coerce_int(v, 1, 10)

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: object) -> int:
        return _coerce_int(v, 1, None)

    @field_validator("page_size", mode="before")
    @classmethod
    def _page_size(cls, v: object) -> int:
        return _coerce_int(v, 1, 100)


class PageQuery(ApiModel):
    page: int = 1
    page_size: int = Field(default=25)

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: object) -> int:
        return _coerce_int(v, 1, None)

    @field_validator("page_size", mode="before")
    @classmethod
    def _page_size(cls, v: object) -> int:
        return _coerce_int(v, 1, 100)


# ---- Phase 06: release requests ----------------------------------------------------------------


class ReleaseRequestCreate(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"reason": "Enter the reason for the release"}

    reason: str

    @field_validator("reason", mode="before")
    @classmethod
    def _reason(cls, v: object) -> str:
        return _required_text(v, 2000, "Enter the reason for the release", "Reason")


class ConditionUpdate(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"met": "Say whether the condition is met"}

    met: bool
    remarks: str | None = Field(default=None, validate_default=True)

    @field_validator("met", mode="before")
    @classmethod
    def _met(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Say whether the condition is met")
        return v

    @field_validator("remarks", mode="before")
    @classmethod
    def _remarks(cls, v: object, info: ValidationInfo) -> str | None:
        remarks = _optional_text(v, 1000, "Remarks")
        if remarks is None and info.data.get("met") is True:
            raise fail("Enter remarks: what did you check?")
        return remarks


def _expected_level(v: object) -> int:
    v = _blank_to_none(v)
    if v is None:
        raise fail("Reload the request: the level you are acting at is required")
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise fail("Not a valid level")
    return v


class RecommendInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {
        "remarks": "Enter your remarks",
        "level": "Reload the request: the level you are acting at is required",
    }

    remarks: str
    level: int  # the level the client saw; a different current level means someone acted first

    @field_validator("remarks", mode="before")
    @classmethod
    def _remarks(cls, v: object) -> str:
        return _required_text(v, 2000, "Enter your remarks", "Remarks")

    @field_validator("level", mode="before")
    @classmethod
    def _level(cls, v: object) -> int:
        return _expected_level(v)


ReleaseDecisionInput = Literal["APPROVE", "REJECT", "RETURN"]


class DecideInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {
        "decision": "Choose Approve, Return or Reject",
        "remarks": "Enter your remarks",
        "level": "Reload the request: the level you are acting at is required",
    }

    decision: ReleaseDecisionInput
    remarks: str
    refund_reference: str | None = None
    level: int

    @field_validator("decision", mode="before")
    @classmethod
    def _decision(cls, v: object) -> ReleaseDecisionInput:
        if v not in ("APPROVE", "REJECT", "RETURN"):
            raise fail("Choose Approve, Return or Reject")
        return v

    @field_validator("remarks", mode="before")
    @classmethod
    def _remarks(cls, v: object) -> str:
        return _required_text(v, 2000, "Enter your remarks", "Remarks")

    @field_validator("refund_reference", mode="before")
    @classmethod
    def _refund(cls, v: object) -> str | None:
        return _optional_text(v, 100, "Refund reference")

    @field_validator("level", mode="before")
    @classmethod
    def _level(cls, v: object) -> int:
        return _expected_level(v)


class ReleaseListQuery(ApiModel):
    status: list[ReleaseRequestStatus] | None = None
    awaiting_me: bool = False
    instrument_id: str | None = None
    page: int = 1
    page_size: int = Field(default=25)

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, v: object) -> list[ReleaseRequestStatus] | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        items = [x for part in (v if isinstance(v, list) else [v]) for x in str(part).split(",") if x]
        if any(x not in RELEASE_REQUEST_STATUSES for x in items):
            raise fail("Unknown release request status")
        return items or None  # type: ignore[return-value]

    @field_validator("awaiting_me", mode="before")
    @classmethod
    def _awaiting(cls, v: object) -> bool:
        v = _blank_to_none(v)
        if v in (None, False, "false", "0"):
            return False
        if v in (True, "true", "1"):
            return True
        raise fail("Use true or false")

    @field_validator("instrument_id", mode="before")
    @classmethod
    def _instrument_id(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if not isinstance(v, str) or not _UUID.match(v):
            raise fail("Not a valid id")
        return v

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: object) -> int:
        return _coerce_int(v, 1, None)

    @field_validator("page_size", mode="before")
    @classmethod
    def _page_size(cls, v: object) -> int:
        return _coerce_int(v, 1, 100)


# ---- Phase 07: dashboard, my day, reports ------------------------------------------------------


def _weight(v: object) -> float:
    if isinstance(v, bool) or not isinstance(v, int | float) or not 0 <= v <= 1:
        raise fail("Enter a weight between 0 and 1")
    return float(v)


class RiskWeightsRule(ApiModel):
    """key 'risk_weights' (Phase 7): how My day ranks work (D26)."""

    amount: float
    urgency: float
    verification: float
    discrepancy: float
    escalation: float
    amount_cap: str
    urgency_horizon_days: int

    @field_validator("amount", "urgency", "verification", "discrepancy", "escalation", mode="before")
    @classmethod
    def _weights(cls, v: object) -> float:
        return _weight(v)

    @field_validator("amount_cap", mode="before")
    @classmethod
    def _cap(cls, v: object) -> str:
        if not isinstance(v, str) or not re.fullmatch(r"\d{1,12}\.\d{2}", v) or _paise(v) <= 0:
            raise fail("Enter an amount like 10000000.00")
        return v

    @field_validator("urgency_horizon_days", mode="before")
    @classmethod
    def _horizon(cls, v: object) -> int:
        return _whole_days(v, 1)

    @model_validator(mode="after")
    def _sum_is_one(self) -> RiskWeightsRule:
        total = self.amount + self.urgency + self.verification + self.discrepancy + self.escalation
        if abs(total - 1) > 0.001:
            raise fail(f"Weights must add up to 1.00 (now {total:.2f})")
        return self


class ImprovementBaselineRule(ApiModel):
    """key 'improvement_baseline' (Phase 7): assumed figures for the manual process (illustrative, D26)."""

    manual_steps_per_case: int
    portal_steps_per_case: int
    manual_verification_days: int
    manual_lapse_detection_days: int
    manual_caught_before_expiry_pct: int
    note: str

    @field_validator(
        "manual_steps_per_case", "portal_steps_per_case", "manual_verification_days", "manual_lapse_detection_days",
        mode="before",
    )  # fmt: skip
    @classmethod
    def _count(cls, v: object) -> int:
        return _whole_days(v)

    @field_validator("manual_caught_before_expiry_pct", mode="before")
    @classmethod
    def _pct(cls, v: object) -> int:
        n = _whole_days(v)
        if n > 100:
            raise fail("Must be at most 100")
        return n

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, v: object) -> str:
        return _required_text(v, 500, "Note is required", "Note")


RULE_CONFIG_MODELS.update({"risk_weights": RiskWeightsRule, "improvement_baseline": ImprovementBaselineRule})


class DashboardQuery(ApiModel):
    region: str | None = None
    type: InstrumentType | None = None

    @field_validator("region", mode="before")
    @classmethod
    def _region(cls, v: object) -> str | None:
        return _optional_query_text(v)

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v: object) -> object:
        return _blank_to_none(v)


class InstitutionListQuery(ApiModel):
    region: str | None = None
    state: str | None = None
    q: str | None = None
    page: int = 1
    page_size: int = Field(default=25)

    @field_validator("region", "state", "q", mode="before")
    @classmethod
    def _text(cls, v: object) -> str | None:
        return _optional_query_text(v)

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: object) -> int:
        return _coerce_int(v, 1, None)

    @field_validator("page_size", mode="before")
    @classmethod
    def _page_size(cls, v: object) -> int:
        return _coerce_int(v, 1, 100)


class ReportQuery(ApiModel):
    """Every preset's filters; each preset reads the ones it supports (the rest are ignored)."""

    format: Literal["json", "csv"] = "json"
    status: list[InstrumentStatus] | None = None
    type: InstrumentType | None = None
    region: str | None = None
    bank: str | None = None
    institution_id: str | None = None
    maturity_from: str | None = None
    maturity_to: str | None = None
    days: int = 90
    all: bool = False
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None

    @field_validator("format", mode="before")
    @classmethod
    def _format(cls, v: object) -> object:
        v = _blank_to_none(v)
        return "json" if v is None else v

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, v: object) -> list[str] | None:
        if v is None or v == "":
            return None
        values = v if isinstance(v, list) else [v]
        out = [s.strip() for x in values for s in str(x).split(",")]
        return [s for s in out if s] or None

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v: object) -> object:
        return _blank_to_none(v)

    @field_validator("region", "bank", mode="before")
    @classmethod
    def _text(cls, v: object) -> str | None:
        return _optional_query_text(v)

    @field_validator("institution_id", mode="before")
    @classmethod
    def _institution_id(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if not isinstance(v, str) or not _UUID.match(v):
            raise fail("Not a valid id")
        return v

    @field_validator("maturity_from", "maturity_to", "from_", "to", mode="before")
    @classmethod
    def _dates(cls, v: object) -> str | None:
        return _optional_date(v)

    @field_validator("days", mode="before")
    @classmethod
    def _days(cls, v: object) -> int:
        v = _blank_to_none(v)
        return 90 if v is None else _coerce_int(v, 1, 3650)

    @field_validator("all", mode="before")
    @classmethod
    def _all(cls, v: object) -> bool:
        return v in (True, "true", "1")


# ---- Phase 08: rules administration, users, audit ----------------------------------------------


def _version_value(v: object) -> int:
    n = _positive_int(v, "version is required")
    if n <= 0:
        raise fail("version must be a positive whole number")
    return n


class RuleUpdateInput(ApiModel):
    """PUT /rules/:key. `config` is validated with the rule's own model by the service (field paths `config.…`)."""

    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"config": "config is required", "version": "version is required"}

    config: object
    active: bool = True
    version: int

    @field_validator("active", mode="before")
    @classmethod
    def _active(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Choose yes or no")
        return v

    @field_validator("version", mode="before")
    @classmethod
    def _version(cls, v: object) -> int:
        return _version_value(v)


_PASSWORD_LETTER = re.compile(r"[A-Za-z]")
_PASSWORD_DIGIT = re.compile(r"\d")


def password_policy(v: object) -> str:
    """At least 8 characters with a letter and a digit (§8.2)."""
    if not isinstance(v, str) or len(v) < 8 or not _PASSWORD_LETTER.search(v) or not _PASSWORD_DIGIT.search(v):
        raise fail("Use at least 8 characters with a letter and a digit")
    if len(v) > 200:
        raise fail("Password must be at most 200 characters")
    return v


class UserCreateInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {
        "name": "Enter the name",
        "email": "Enter a valid email address",
        "role": "Choose a role",
        "password": "Use at least 8 characters with a letter and a digit",
    }

    name: str
    email: str
    role: Role
    institution_id: str | None = None
    designation: str | None = None
    password: str

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v: object) -> str:
        return _required_text(v, 200, "Enter the name", "Name")

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v: object) -> str:
        if not isinstance(v, str) or not _EMAIL.match(v.strip().lower()) or len(v.strip()) > 200:
            raise fail("Enter a valid email address")
        return v.strip().lower()

    @field_validator("role", mode="before")
    @classmethod
    def _role(cls, v: object) -> Role:
        if v not in ROLES:
            raise fail("Choose a role")
        return v

    @field_validator("institution_id", mode="before")
    @classmethod
    def _institution_id(cls, v: object) -> str | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        if not isinstance(v, str) or not _UUID.match(v):
            raise fail("Choose an institution")
        return v

    @field_validator("designation", mode="before")
    @classmethod
    def _designation(cls, v: object) -> str | None:
        return _optional_text(v, 200, "Designation")

    @field_validator("password", mode="before")
    @classmethod
    def _password(cls, v: object) -> str:
        return password_policy(v)


class UserPatchInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"version": "version is required"}

    name: str | None = None
    designation: str | None = None
    active: bool | None = None
    version: int

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v: object) -> str:
        return _required_text(v, 200, "Enter the name", "Name")

    @field_validator("designation", mode="before")
    @classmethod
    def _designation(cls, v: object) -> str | None:
        return _optional_text(v, 200, "Designation")

    @field_validator("active", mode="before")
    @classmethod
    def _active(cls, v: object) -> bool:
        if not isinstance(v, bool):
            raise fail("Choose yes or no")
        return v

    @field_validator("version", mode="before")
    @classmethod
    def _version(cls, v: object) -> int:
        return _version_value(v)


class PasswordResetInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {"password": "Use at least 8 characters with a letter and a digit"}

    password: str

    @field_validator("password", mode="before")
    @classmethod
    def _password(cls, v: object) -> str:
        return password_policy(v)


def _optional_uuid(v: object) -> str | None:
    v = _blank_to_none(v)
    if v is None:
        return None
    if not isinstance(v, str) or not _UUID.match(v):
        raise fail("Not a valid id")
    return v


class AuditEventsQuery(ApiModel):
    """GET /audit/events. `from` / `to` are business dates (IST, inclusive)."""

    actor_id: str | None = None
    action: str | None = None
    entity_type: str | None = None
    instrument_id: str | None = None
    event_id: int | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    q: str | None = None
    include_sign_ins: bool = True
    format: Literal["json", "csv"] = "json"
    page: int = 1
    page_size: int = Field(default=50)

    @field_validator("actor_id", "instrument_id", mode="before")
    @classmethod
    def _ids(cls, v: object) -> str | None:
        return _optional_uuid(v)

    @field_validator("action", "entity_type", "q", mode="before")
    @classmethod
    def _text(cls, v: object) -> str | None:
        return _optional_query_text(v)

    @field_validator("from_", "to", mode="before")
    @classmethod
    def _dates(cls, v: object) -> str | None:
        return _optional_date(v)

    @field_validator("event_id", mode="before")
    @classmethod
    def _event_id(cls, v: object) -> int | None:
        v = _blank_to_none(v)
        return None if v is None else _coerce_int(v, 1, None)

    @field_validator("include_sign_ins", mode="before")
    @classmethod
    def _sign_ins(cls, v: object) -> bool:
        return v not in (False, "false", "0")

    @field_validator("format", mode="before")
    @classmethod
    def _format(cls, v: object) -> object:
        v = _blank_to_none(v)
        return "json" if v is None else v

    @field_validator("page", mode="before")
    @classmethod
    def _page(cls, v: object) -> int:
        return _coerce_int(v, 1, None)

    @field_validator("page_size", mode="before")
    @classmethod
    def _page_size(cls, v: object) -> int:
        return _coerce_int(v, 1, 200)


class DocumentAccessQuery(ApiModel):
    instrument_id: str | None = None

    @field_validator("instrument_id", mode="before")
    @classmethod
    def _id(cls, v: object) -> str | None:
        return _optional_uuid(v)


class IntegrityQuery(ApiModel):
    fresh: bool = False

    @field_validator("fresh", mode="before")
    @classmethod
    def _fresh(cls, v: object) -> bool:
        return v in (True, "true", "1")


class TamperInput(ApiModel):
    event_id: int | None = None

    @field_validator("event_id", mode="before")
    @classmethod
    def _event_id(cls, v: object) -> int | None:
        v = _blank_to_none(v)
        if v is None:
            return None
        n = _positive_int(v, "Enter an event number")
        if n <= 0:
            raise fail("Enter an event number")
        return n


# ---- Phase 9: demo tools ----


class BankCorrectionFields(InstrumentFields):
    """The bank-side values a demo correction may change (same validation as the instrument's fields)."""

    @model_validator(mode="after")
    def _something(self) -> BankCorrectionFields:
        allowed = {"amount", "issue_date", "maturity_date", "beneficiary_name", "lien_marked"}
        if not self.model_fields_set & allowed:
            raise fail("Give at least one of amount, issueDate, maturityDate, beneficiaryName, lienMarked")
        return self


class BankCorrectionInput(ApiModel):
    MISSING_MESSAGES: ClassVar[dict[str, str]] = {
        "bank": "Choose the bank",
        "referenceNo": "Enter the reference number",
        "fields": "Give the corrected values",
    }

    bank: str
    reference_no: str
    fields: BankCorrectionFields

    @field_validator("bank", mode="before")
    @classmethod
    def _bank(cls, v: object) -> str:
        if v not in BANKS:
            raise fail("Choose a bank from the list")
        return v

    @field_validator("reference_no", mode="before")
    @classmethod
    def _reference_no(cls, v: object) -> str:
        v = _blank_to_none(v)
        if v is None:
            raise fail("Enter the reference number")
        return norm_ref(_require_str(v))
