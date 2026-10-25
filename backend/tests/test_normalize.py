from __future__ import annotations

import pytest
from app.domain.normalize import norm_amount, norm_bool, norm_date, norm_name, norm_ref


def test_norm_amount_strips_commas_rupee_sign_and_spaces() -> None:
    assert norm_amount("25,00,000") == "2500000.00"
    assert norm_amount("₹25,00,000") == "2500000.00"
    assert norm_amount("₹ 25,00,000.5") == "2500000.50"
    assert norm_amount("Rs. 1,50,000") == "150000.00"
    assert norm_amount("INR 2500000") == "2500000.00"
    assert norm_amount(2500000) == "2500000.00"
    assert norm_amount("0025000.10") == "25000.10"
    assert norm_amount("100.") == "100.00"
    assert norm_amount("100.500") == "100.50"


@pytest.mark.parametrize("bad", ["", "abc", "-500", "12.345", "1e6", "12,3a"])
def test_norm_amount_rejects_non_amounts_and_sub_paise_precision(bad: str) -> None:
    with pytest.raises(ValueError):
        norm_amount(bad)


def test_norm_date_normalises_iso_and_indian_day_first_formats() -> None:
    assert norm_date("2027-03-31") == "2027-03-31"
    assert norm_date("2027-3-1") == "2027-03-01"
    assert norm_date("31/03/2027") == "2027-03-31"
    assert norm_date("1-4-2027") == "2027-04-01"
    assert norm_date("31.03.2027") == "2027-03-31"
    assert norm_date("2027-03-31T10:00:00Z") == "2027-03-31"
    assert norm_date("29/02/2028") == "2028-02-29"


@pytest.mark.parametrize("bad", ["2027-02-29", "31/04/2027", "2027-13-01", "March 31", ""])
def test_norm_date_rejects_impossible_dates(bad: str) -> None:
    with pytest.raises(ValueError):
        norm_date(bad)


def test_norm_name_uppercases_strips_dots_and_commas_collapses_spaces() -> None:
    assert norm_name("  Vasavi College of Engg., Hyderabad ") == "VASAVI COLLEGE OF ENGG HYDERABAD"
    assert norm_name("A.I.C.T.E.") == "A I C T E"
    assert norm_name("Member   Secretary,AICTE") == "MEMBER SECRETARY AICTE"
    assert norm_name("Member Secretary, AICTE") == norm_name("member secretary aicte")


def test_norm_ref_uppercases_and_strips_all_whitespace() -> None:
    assert norm_ref(" sbi fd 0042 17 ") == "SBIFD004217"
    assert norm_ref("HDFC/FD/2026\t001") == "HDFC/FD/2026001"


def test_norm_bool_maps_common_truthy_and_falsy_forms() -> None:
    assert norm_bool(True) == "true"
    assert norm_bool("Yes") == "true"
    assert norm_bool("1") == "true"
    assert norm_bool(False) == "false"
    assert norm_bool("no") == "false"
    assert norm_bool(None) == "false"
    with pytest.raises(ValueError):
        norm_bool("maybe")
