from __future__ import annotations

from typing import Any

from app.domain.fields import same_tracked_value, tracked_value
from app.schemas import InstrumentCreate, InstrumentListQuery, InstrumentPatch, model_issues, submission_issues
from pydantic import ValidationError

COMPLETE: dict[str, Any] = {
    "referenceNo": "SBIN/FDR/2026/00731",
    "issuingBank": "State Bank of India",
    "branch": None,
    "amount": "2500000.00",
    "issueDate": "2026-04-01",
    "maturityDate": "2027-04-01",
    "beneficiaryName": "Member Secretary, AICTE",
    "lienMarked": True,
    "purpose": None,
}


def ok(model: type[Any], data: dict[str, Any]) -> bool:
    try:
        model.model_validate(data)
    except ValidationError:
        return False
    return True


def test_normalises_create_input() -> None:
    r = InstrumentCreate.model_validate(
        {"type": "FDR", "referenceNo": " sbin/fdr 2026/00731 ", "amount": "25,00,000",
         "beneficiaryName": "  Member   Secretary ", "branch": ""}
    )  # fmt: skip
    assert r.provided() == {
        "type": "FDR",
        "referenceNo": "SBIN/FDR2026/00731",
        "amount": "2500000.00",
        "beneficiaryName": "Member Secretary",
        "branch": None,
    }


def test_drafts_may_be_empty_except_type() -> None:
    assert ok(InstrumentCreate, {"type": "SECURITY_DEPOSIT"})
    assert not ok(InstrumentCreate, {})


def test_lists_every_failing_field() -> None:
    issues = model_issues(
        InstrumentCreate,
        {"type": "FDR", "referenceNo": "AB", "issuingBank": "Bank of Nowhere", "amount": "0",
         "issueDate": "2026-02-30", "branch": "x" * 81},
    )  # fmt: skip
    assert sorted(i["field"] for i in issues) == ["amount", "branch", "issueDate", "issuingBank", "referenceNo"]


def test_amount_bounds_use_exact_decimal_comparison() -> None:
    assert ok(InstrumentCreate, {"type": "FDR", "amount": "1000000000.00"})
    assert not ok(InstrumentCreate, {"type": "FDR", "amount": "1000000000.01"})
    assert not ok(InstrumentCreate, {"type": "FDR", "amount": "12.345"})
    assert not ok(InstrumentCreate, {"type": "FDR", "amount": "abc"})


def test_patch_requires_version() -> None:
    assert not ok(InstrumentPatch, {"amount": "1"})
    assert ok(InstrumentPatch, {"amount": "1", "version": 2})


def test_submission_issues_passes_a_complete_valid_record() -> None:
    assert submission_issues(COMPLETE, "2026-10-25") == []


def test_submission_issues_reports_required_fields_and_d25_date_rules_together() -> None:
    issues = submission_issues(
        {
            **COMPLETE,
            "referenceNo": None,
            "beneficiaryName": None,
            "issueDate": "2026-11-01",
            "maturityDate": "2026-10-01",
        },
        "2026-10-25",
    )
    assert sorted(i["field"] for i in issues) == ["beneficiaryName", "issueDate", "maturityDate", "referenceNo"]


def test_submission_issues_maturity_in_the_past_fails_on_maturity_date() -> None:
    issues = submission_issues({**COMPLETE, "issueDate": "2025-01-01", "maturityDate": "2026-01-01"}, "2026-10-25")
    assert issues == [{"field": "maturityDate", "message": "Maturity date has already passed"}]


def test_list_query_accepts_repeated_bracketed_and_comma_separated_status() -> None:
    assert InstrumentListQuery.model_validate({"status": ["DRAFT", "ACTIVE"]}).status == ["DRAFT", "ACTIVE"]
    assert InstrumentListQuery.model_validate({"status": "DRAFT,RETURNED"}).status == ["DRAFT", "RETURNED"]
    assert InstrumentListQuery.model_validate({}).status is None
    q = InstrumentListQuery.model_validate({"page": "2", "pageSize": "10"})
    assert (q.page, q.page_size, q.sort) == (2, 10, "maturityDate")
    assert not ok(InstrumentListQuery, {"status": "NOPE"})
    assert not ok(InstrumentListQuery, {"pageSize": "500"})


def test_tracked_values_canonical_forms() -> None:
    assert tracked_value("amount", {**COMPLETE, "amount": "2500000"}) == "2500000.00"
    assert tracked_value("lien_marked", COMPLETE) == "true"
    assert same_tracked_value("beneficiary_name", "Member Secretary, AICTE", "MEMBER SECRETARY AICTE")
    assert not same_tracked_value("amount", "2500000.00", "2000000.00")
