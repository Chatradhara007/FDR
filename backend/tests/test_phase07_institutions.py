"""Phase 07 acceptance check 6: the institution-wise view."""

from __future__ import annotations

import pytest
from helpers import institution_id, make_instrument, reset_db, set_today, user_for
from phase07_helpers import add_discrepancy, get, ok

D0 = "2026-10-25"


@pytest.fixture(autouse=True)
def _db() -> None:
    reset_db()
    set_today(D0)


def test_ac6_profile_lists_every_instrument_and_scopes_institution_users() -> None:
    inst1, inst2 = institution_id("inst1@demo.in"), institution_id("inst2@demo.in")
    own = [make_instrument(s, "2027-06-01") for s in ("DRAFT", "ACTIVE", "LAPSED", "RETURNED")]
    add_discrepancy(own[1])
    make_instrument("ACTIVE", "2027-06-01", institution_email="inst2@demo.in")

    profile = ok(get(user_for("officer@demo.in"), f"/institutions/{inst1}"))
    assert {i["id"] for i in profile["instruments"]} == set(own)
    assert profile["institution"]["name"].startswith("Vasavi Institute")
    problems = profile["institution"]["openProblems"]
    assert (problems["openDiscrepancies"], problems["overdue"], problems["returned"]) == (1, 1, 1)
    assert profile["institution"]["liveCount"] == 2

    assert len(ok(get(user_for("inst1@demo.in"), f"/institutions/{inst1}"))["instruments"]) == 4
    assert get(user_for("inst1@demo.in"), f"/institutions/{inst2}").status_code == 404
    assert get(user_for("auditor@demo.in"), "/institutions/00000000-0000-0000-0000-000000000000").status_code == 404
    assert get(user_for("officer@demo.in"), "/institutions/not-a-uuid").status_code == 404


def test_institution_list_filters_and_access() -> None:
    make_instrument("ACTIVE", "2027-06-01", amount="3000000.00")
    data = ok(get(user_for("approver@demo.in"), "/institutions"))
    assert data["total"] == 12
    vasavi = next(i for i in data["items"] if i["name"].startswith("Vasavi"))
    assert vasavi["byStatus"]["ACTIVE"] == {"count": 1, "amount": "3000000.00"}
    assert vasavi["liveAmount"] == "3000000.00"
    assert [i["region"] for i in ok(get(user_for("admin@demo.in"), "/institutions?region=Southern"))["items"]] == [
        "Southern",
        "Southern",
    ]
    assert ok(get(user_for("admin@demo.in"), "/institutions?q=godavari"))["total"] == 1
    assert get(user_for("inst1@demo.in"), "/institutions").status_code == 403
