"""Phase 07 acceptance checks 1–2: dashboard figures equal direct SQL, and move with the app clock."""

from __future__ import annotations

from decimal import Decimal

import pytest
from app.db.pool import get_pool, one
from app.shared_constants import DASHBOARD_STATUS_GROUPS, INSTRUMENT_STATUSES
from helpers import api, bearer, evaluate_on, make_instrument, reset_db, set_today, user_for
from phase07_helpers import get, ok

D0 = "2026-10-25"


@pytest.fixture(autouse=True)
def _db() -> None:
    reset_db()
    set_today(D0)


def seed_every_status() -> None:
    """At least one instrument in every status (two institutions, different amounts), DRAFT included."""
    for n, status in enumerate(INSTRUMENT_STATUSES):
        for k, email in enumerate(("inst1@demo.in", "inst2@demo.in")):
            make_instrument(status, "2027-06-01", institution_email=email, amount=f"{(n + 1) * 100000 + k * 7}.50")


def sql_group(statuses: list[str], region: str | None = None) -> tuple[int, Decimal]:
    row = one(
        get_pool(),
        """SELECT count(*)::int AS n, coalesce(sum(i.amount), 0)::text AS amount
       FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
      WHERE i.status = ANY($1::instrument_status[]) AND ($2::text IS NULL OR inst.region = $2)""",
        [statuses, region],
    )
    return int(row["n"]), Decimal(row["amount"])


def test_ac1_every_status_group_equals_direct_sql() -> None:
    seed_every_status()
    d = ok(get(user_for("officer@demo.in"), "/dashboard"))
    groups = {g["key"]: g for g in d["byStatus"]}
    # The statement names active, expiring, matured, renewed, released and pending: every one must be there.
    for key in ("ACTIVE", "EXPIRING", "MATURED", "RENEWED", "RELEASED", "PENDING"):
        assert key in groups
    assert [g["key"] for g in d["byStatus"]] == [g["key"] for g in DASHBOARD_STATUS_GROUPS]
    for g in DASHBOARD_STATUS_GROUPS:
        n, amount = sql_group(g["statuses"])
        assert n > 0
        assert groups[g["key"]]["count"] == n, g["key"]
        assert Decimal(groups[g["key"]]["amount"]) == amount, g["key"]
    live_n, live_amount = sql_group(["ACTIVE", "EXPIRING", "MATURED", "LAPSED", "RELEASE_REQUESTED"])
    assert d["kpis"]["live"] == {"count": live_n, "amount": f"{live_amount:.2f}"}
    assert d["kpis"]["pendingScrutiny"] == sql_group(["SUBMITTED", "UNDER_SCRUTINY"])[0]
    assert d["kpis"]["confirmedPct"] == 100.0  # make_instrument writes CONFIRMED
    non_draft = sum(d["verification"]["byState"].values())
    assert non_draft == len(INSTRUMENT_STATUSES) * 2 - 2  # drafts excluded
    assert d["asOf"] == D0


def test_region_filter_matches_sql() -> None:
    seed_every_status()
    d = ok(get(user_for("auditor@demo.in"), "/dashboard?region=Southern"))
    for g in d["byStatus"]:
        n, amount = sql_group(g["statuses"], "Southern")
        assert (g["count"], Decimal(g["amount"])) == (n, amount)
    assert [r["region"] for r in d["byRegion"]] == ["Southern"]
    assert ok(get(user_for("auditor@demo.in"), "/dashboard?type=SECURITY_DEPOSIT"))["kpis"]["live"]["count"] == 0


def test_ac2_clock_advance_moves_asof_buckets_and_statuses() -> None:
    make_instrument("ACTIVE", "2026-12-04", amount="1000000.00")  # 40 days
    make_instrument("ACTIVE", "2027-03-14", amount="2000000.00")  # 140 days
    evaluate_on(D0)
    officer = user_for("officer@demo.in")
    before = ok(get(officer, "/dashboard"))
    buckets = {b["key"]: b["count"] for b in before["maturityBuckets"]}
    assert buckets == {"overdue": 0, "d0_30": 0, "d31_60": 1, "d61_90": 0}
    status = {g["key"]: g["count"] for g in before["byStatus"]}
    assert (status["ACTIVE"], status["EXPIRING"], status["MATURED"]) == (1, 1, 0)

    res = api().post("/api/v1/clock/advance", headers=bearer(user_for("admin@demo.in")), json={"days": 60})
    assert res.status_code == 200, res.text
    after = ok(get(officer, "/dashboard"))
    assert after["asOf"] == "2026-12-24"
    buckets = {b["key"]: b["count"] for b in after["maturityBuckets"]}
    assert buckets == {"overdue": 1, "d0_30": 0, "d31_60": 0, "d61_90": 1}
    status = {g["key"]: g["count"] for g in after["byStatus"]}
    # 40-day instrument matured on 4 Dec and lapsed after the 15-day grace; the 140-day one is now expiring.
    assert (status["ACTIVE"], status["EXPIRING"], status["MATURED"], status["LAPSED"]) == (0, 1, 0, 1)
    assert after["maturityByMonth"][0]["month"] == "2026-12"
    assert len(after["maturityByMonth"]) == 12


def test_dashboard_sections_and_access() -> None:
    a = make_instrument("UNDER_SCRUTINY", "2027-06-01", verification_state="MISMATCH")
    one(get_pool(), "INSERT INTO verifications (instrument_id, source, request_payload, result, requested_by,"
        " requested_at) VALUES ($1, 'mock-bank', '{}', 'MISMATCH', $2, now()) RETURNING id",
        [a, user_for("officer@demo.in").id])  # fmt: skip
    d = ok(get(user_for("approver@demo.in"), "/dashboard"))
    bank = d["byBank"][0]
    assert (bank["bank"], bank["verifications"], bank["mismatches"], bank["mismatchRate"]) == (
        "Canara Bank",
        1,
        1,
        100.0,
    )
    assert d["byRegion"][0]["atRisk"] == 1
    assert ok(get(user_for("admin@demo.in"), "/dashboard"))["asOf"] == D0
    assert get(user_for("inst1@demo.in"), "/dashboard").status_code == 403
    assert get(user_for("officer@demo.in"), "/dashboard?type=NOPE").status_code == 422
