"""Request validation (pydantic v2). Same rules and messages as the original zod schemas.

Field names are the API's camelCase names (aliases); `middleware/validate.py` turns errors into
`[{ field, message }]`, one entry per failing field.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, ClassVar, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from .domain.normalize import norm_amount, norm_date, norm_ref
from .repositories.instrument_repo import InstrumentSort
from .shared_constants import BANKS, DOC_TYPES, INSTRUMENT_TYPES, DocType, InstrumentStatus, InstrumentType


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
