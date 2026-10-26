from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest
from helpers import VALID_FDR, SeededUser, api, bearer, create_draft_via_api, ready_fdr, reset_db, set_today, user_for
from httpx import Response


@dataclass(frozen=True)
class Users:
    inst1: SeededUser
    inst2: SeededUser
    officer: SeededUser


@pytest.fixture(scope="module")
def users() -> Users:
    reset_db()
    set_today("2026-10-25")
    u = Users(user_for("inst1@demo.in"), user_for("inst2@demo.in"), user_for("officer@demo.in"))
    # inst1: 3 instruments (one submitted), inst2: 2.
    submitted = ready_fdr(u.inst1, {**VALID_FDR, "referenceNo": "SBIN/FDR/2026/00001", "maturityDate": "2026-12-01"})
    assert api().post(f"/api/v1/instruments/{submitted}/submit", headers=bearer(u.inst1)).status_code == 200
    create_draft_via_api(
        u.inst1,
        {**VALID_FDR, "referenceNo": "HDFC/FD/2026/00002", "issuingBank": "HDFC Bank", "maturityDate": "2027-06-30"},
    )
    create_draft_via_api(u.inst1, {"type": "SECURITY_DEPOSIT"})
    create_draft_via_api(
        u.inst2,
        {
            **VALID_FDR,
            "referenceNo": "CNRB/FD/2026/00003",
            "issuingBank": "Canara Bank",
            "beneficiaryName": "AICTE Southern",
        },
    )
    create_draft_via_api(u.inst2, {**VALID_FDR, "referenceNo": "CNRB/FD/2026/00004", "issuingBank": "Canara Bank"})
    return u


def list_(u: SeededUser, query: str = "") -> Response:
    return api().get(f"/api/v1/instruments{query}", headers=bearer(u))


def body(res: Response) -> Any:
    return res.json()


def test_ac10_an_institution_sees_only_its_own_instruments(users: Users) -> None:
    res = list_(users.inst1)
    assert res.status_code == 200
    assert (body(res)["total"], body(res)["page"], body(res)["pageSize"]) == (3, 1, 25)
    assert all(i["institutionId"] == users.inst1.institutionId for i in body(res)["items"])
    # A filter for another institution cannot widen the scope.
    assert body(list_(users.inst1, f"?institutionId={users.inst2.institutionId}"))["total"] == 0
    assert body(list_(users.officer))["total"] == 5


def test_ac10_items_carry_days_to_maturity_and_institution_default_sort_by_maturity(users: Users) -> None:
    items = body(list_(users.inst1))["items"]
    first = items[0]
    expected = {
        "referenceNo": "SBIN/FDR/2026/00001",
        "status": "SUBMITTED",
        "verificationState": "UNVERIFIED",
        "amount": "2500000.00",
        "maturityDate": "2026-12-01",
        "daysToMaturity": 37,
        "region": "South-Central",
    }
    assert {k: first[k] for k in expected} == expected
    assert "Vasavi" in first["institutionName"]
    assert items[2]["maturityDate"] is None
    assert items[2]["daysToMaturity"] is None


def test_ac10_filters_work(users: Users) -> None:
    o = users.officer
    assert body(list_(o, "?status=DRAFT"))["total"] == 4
    assert body(list_(o, "?status[]=SUBMITTED&status[]=DRAFT"))["total"] == 5
    assert body(list_(o, "?type=SECURITY_DEPOSIT"))["total"] == 1
    assert body(list_(o, "?bank=Canara%20Bank"))["total"] == 2
    assert body(list_(o, "?region=Southern"))["total"] == 2
    assert body(list_(o, f"?institutionId={users.inst2.institutionId}"))["total"] == 2
    assert body(list_(o, "?q=hdfc"))["total"] == 1
    assert body(list_(o, "?q=southern"))["total"] == 1
    assert body(list_(o, "?q=godavari"))["total"] == 2
    assert body(list_(o, "?q=%25"))["total"] == 0
    assert body(list_(o, "?maturityFrom=2027-01-01&maturityTo=2027-12-31"))["total"] == 3
    bad = list_(o, "?status=NOPE&pageSize=0")
    assert bad.status_code == 422
    assert sorted(d["field"] for d in body(bad)["details"]) == ["query.pageSize", "query.status.0"]


def test_ac10_paging_and_sorting(users: Users) -> None:
    o = users.officer
    p1 = body(list_(o, "?pageSize=2&page=1&sort=referenceNo"))
    p3 = body(list_(o, "?pageSize=2&page=3&sort=referenceNo"))
    assert (p1["total"], p1["page"], p1["pageSize"]) == (5, 1, 2)
    assert [i["referenceNo"] for i in p1["items"]] == ["CNRB/FD/2026/00003", "CNRB/FD/2026/00004"]
    assert len(p3["items"]) == 1
    past = body(list_(o, "?pageSize=2&page=9"))
    assert past["total"] == 5 and past["items"] == []


def test_meta_returns_banks_doc_types_regions_and_the_current_rules(users: Users) -> None:
    res = api().get("/api/v1/meta", headers=bearer(users.inst1))
    assert res.status_code == 200
    meta = body(res)
    assert "State Bank of India" in meta["banks"]
    assert {"value": "FDR_COPY", "label": "FDR copy"} in meta["docTypes"]
    assert meta["regions"] == [
        "Central", "Eastern", "North-West", "Northern", "South-Central", "South-West", "Southern", "Western"
    ]  # fmt: skip
    assert meta["requiredDocs"] == {"FDR": ["FDR_COPY", "BANK_LETTER"], "SECURITY_DEPOSIT": ["DEPOSIT_CONFIRMATION"]}
    assert meta["lienRequired"] == {"FDR": True, "SECURITY_DEPOSIT": False}
    assert api().get("/api/v1/meta").status_code == 401
