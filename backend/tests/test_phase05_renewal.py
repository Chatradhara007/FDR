"""Phase 05 acceptance checks 1–5 (and 8): renewal, replacement checks, chain activation and the chain query."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from app.db.pool import exec_, get_pool, many, one
from helpers import (
    SeededUser,
    alerts_of,
    api,
    bearer,
    count_events,
    evaluate_on,
    instrument_status,
    make_instrument,
    reset_db,
    set_today,
    upload_doc,
    user_for,
)
from httpx import Response

D0 = "2026-10-25"
PARENT_MATURITY = "2026-12-01"  # 37 days after D0 -> EXPIRING with a 60-day reminder


@dataclass(frozen=True)
class Ctx:
    inst1: SeededUser
    inst2: SeededUser
    officer: SeededUser
    bank_url: str

    def load(self, *records: dict[str, Any]) -> None:
        res = httpx.post(f"{self.bank_url}/records/load", json={"records": list(records)})
        assert res.status_code == 200, res.text


@pytest.fixture
def c(bank_url: str, monkeypatch: pytest.MonkeyPatch) -> Ctx:
    monkeypatch.setenv("MOCK_BANK_URL", bank_url)
    reset_db()
    set_today(D0)
    return Ctx(user_for("inst1@demo.in"), user_for("inst2@demo.in"), user_for("officer@demo.in"), bank_url)


def post(user: SeededUser, path: str, body: dict[str, Any] | None = None) -> Response:
    return api().post(f"/api/v1{path}", headers=bearer(user), json=body or {})


def get(user: SeededUser, path: str) -> Response:
    return api().get(f"/api/v1{path}", headers=bearer(user))


def ok(res: Response, status: int = 200) -> Any:
    assert res.status_code == status, res.text
    return res.json()


def expiring_parent(ref: str = "CNRB/FD/2025/00042", amount: str = "2500000.00") -> str:
    parent = make_instrument("ACTIVE", PARENT_MATURITY, ref=ref, amount=amount)
    evaluate_on(D0)
    assert instrument_status(parent) == "EXPIRING"
    return parent


CHILD_REF = "CNRB/FD/2026/00107"


def fill(c: Ctx, child: dict[str, Any], **over: Any) -> dict[str, Any]:
    body = {
        "referenceNo": CHILD_REF,
        "issueDate": "2026-10-20",
        "maturityDate": "2027-12-01",
        "lienMarked": True,
        "version": child["version"],
        **over,
    }
    res = api().patch(f"/api/v1/instruments/{child['id']}", headers=bearer(c.inst1), json=body)
    data: dict[str, Any] = ok(res)
    return data


def start_renewal(c: Ctx, parent: str, **over: Any) -> str:
    child = ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)
    child = fill(c, child, **over)
    for doc_type in ("FDR_COPY", "BANK_LETTER"):
        assert upload_doc(c.inst1, child["id"], doc_type).status_code == 201
    return str(child["id"])


def bank_record(**over: Any) -> dict[str, Any]:
    return {
        "bank": "Canara Bank",
        "reference_no": CHILD_REF,
        "amount": "2500000.00",
        "issue_date": "2026-10-20",
        "maturity_date": "2027-12-01",
        "beneficiary_name": "MEMBER SECRETARY AICTE",
        "lien_marked": True,
        "lien_in_favour_of": "Member Secretary, AICTE",
        "status": "LIVE",
        **over,
    }


def to_review(c: Ctx, child: str) -> None:
    ok(post(c.inst1, f"/instruments/{child}/submit"))
    ok(post(c.officer, f"/instruments/{child}/claim"))
    body = ok(post(c.officer, f"/instruments/{child}/verify"))
    assert body["result"] == "CONFIRMED", body


def system_observations(instrument_id: str) -> list[dict[str, Any]]:
    return many(
        get_pool(),
        "SELECT text, severity, visible_to_institution FROM observations WHERE instrument_id = $1 AND author_id IS NULL"
        " ORDER BY text",
        [instrument_id],
    )


def test_renew_creates_a_linked_draft_copying_the_parent(c: Ctx) -> None:
    parent = expiring_parent()
    child = ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)
    assert child["status"] == "DRAFT" and child["parentInstrumentId"] == parent
    assert child["issuingBank"] == "Canara Bank" and child["amount"] == "2500000.00"
    assert child["beneficiaryName"] == "Member Secretary, AICTE" and child["type"] == "FDR"
    assert child["referenceNo"] is None and child["issueDate"] is None and child["maturityDate"] is None
    assert child["lienMarked"] is False
    started = many(get_pool(), "SELECT instrument_id, after_json FROM events WHERE action = 'RENEWAL_STARTED'")
    assert {e["instrument_id"]: e["after_json"] for e in started} == {
        child["id"]: {"parentId": parent, "parentReferenceNo": "CNRB/FD/2025/00042"},
        parent: {"childId": child["id"]},
    }
    # Only the owning institution may renew; others get 404 (rule 8), AICTE roles 403.
    assert post(c.inst2, f"/instruments/{parent}/renew").status_code == 404
    assert post(c.officer, f"/instruments/{parent}/renew").status_code == 403


def test_ac1_full_renewal_activates_the_chain_and_closes_the_parents_reminders(c: Ctx) -> None:
    parent = expiring_parent()
    reminders = [a for a in alerts_of(parent) if a["status"] == "OPEN"]
    assert reminders and all(a["kind"] == "MATURITY_REMINDER" for a in reminders)
    child = start_renewal(c, parent)
    c.load(bank_record())
    to_review(c, child)
    review = ok(post(c.officer, f"/instruments/{child}/accept"))
    assert review["instrument"]["status"] == "ACTIVE"
    assert instrument_status(parent) == "RENEWED"

    # Parent's reminders resolved at once (no job run), with the system reason.
    for a in alerts_of(parent):
        assert a["status"] == "RESOLVED"
        assert a["resolution"] in ("SYSTEM_CONDITION_CLEARED", "SUPERSEDED")
    assert {a["id"] for a in reminders} <= {
        a["id"] for a in alerts_of(parent) if a["resolution"] == "SYSTEM_CONDITION_CLEARED"
    }

    # Events on both sides.
    assert count_events("action = 'RENEWED_BY' AND instrument_id = $1", [parent]) == 1
    assert count_events("action = 'RENEWS' AND instrument_id = $1", [child]) == 1
    status_ev = one(get_pool(), "SELECT after_json FROM events WHERE action = 'STATUS_RENEWED'")
    assert status_ev["after_json"] == {"status": "RENEWED", "renewedBy": child}

    # Chain from either side: both links, gap = issue(child) - maturity(parent) = 2026-10-20 - 2026-12-01 = -42.
    for start in (parent, child):
        chain = ok(get(c.inst1, f"/instruments/{start}/passport"))["chain"]
        assert [link["id"] for link in chain] == [parent, child]
        assert [link["isCurrent"] for link in chain] == [start == parent, start == child]
        assert chain[0]["gapDaysFromPrevious"] is None
        assert chain[1]["gapDaysFromPrevious"] == -42 and chain[1]["gapKind"] == "overlap"
        assert [link["status"] for link in chain] == ["RENEWED", "ACTIVE"]

    # The next job run agrees and changes nothing for the parent.
    evaluate_on(D0)
    assert instrument_status(parent) == "RENEWED"
    assert all(a["status"] == "RESOLVED" for a in alerts_of(parent))


def test_ac2_replacement_maturing_before_the_parent_is_rejected_on_maturity_date(c: Ctx) -> None:
    parent = expiring_parent()
    child = start_renewal(c, parent, maturityDate="2026-11-30")
    res = post(c.inst1, f"/instruments/{child}/submit")
    assert res.status_code == 422, res.text
    fields = {f["field"]: f["message"] for f in res.json()["details"]["fields"]}
    assert fields == {"maturityDate": "Replacement must mature after the instrument it replaces (1 Dec 2026)"}
    # Same maturity date is not later either.
    fill(c, ok(get(c.inst1, f"/instruments/{child}")), maturityDate=PARENT_MATURITY)
    assert post(c.inst1, f"/instruments/{child}/submit").status_code == 422
    # The rule is configurable.
    exec_(
        get_pool(),
        "UPDATE rules SET config = config || '{\"requireLaterMaturity\": false}' WHERE key = 'renewal_checks'",
    )
    ok(post(c.inst1, f"/instruments/{child}/submit"))


def test_ac2_listed_with_every_other_failing_field(c: Ctx) -> None:
    parent = expiring_parent()
    child = start_renewal(c, parent, maturityDate="2026-11-30", issueDate="2026-10-30")
    res = post(c.inst1, f"/instruments/{child}/submit")
    assert res.status_code == 422
    assert {f["field"] for f in res.json()["details"]["fields"]} == {"issueDate", "maturityDate"}


def test_ac3_one_successor_at_a_time_and_a_deleted_draft_frees_the_parent(c: Ctx) -> None:
    parent = expiring_parent()
    first = ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)
    res = post(c.inst1, f"/instruments/{parent}/renew")
    assert res.status_code == 409 and res.json()["code"] == "ALREADY_RENEWING"
    assert res.json()["details"]["successorId"] == first["id"]
    assert api().delete(f"/api/v1/instruments/{first['id']}", headers=bearer(c.inst1)).status_code == 204
    second = ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)
    assert second["parentInstrumentId"] == parent
    # The database refuses a second successor too.
    with pytest.raises(Exception, match="one_successor_per_instrument"):
        make_instrument("DRAFT", "2028-01-01", parent_id=parent)


def test_renew_needs_an_expiring_matured_or_lapsed_parent(c: Ctx) -> None:
    active = make_instrument("ACTIVE", "2028-01-01")
    res = post(c.inst1, f"/instruments/{active}/renew")
    assert res.status_code == 409 and res.json()["code"] == "NOT_RENEWABLE"
    for status in ("MATURED", "LAPSED"):
        parent = make_instrument(status, "2026-09-01")
        ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)


def test_ac4_gap_and_lower_amount_raise_concerns_once(c: Ctx) -> None:
    parent = make_instrument("MATURED", "2026-10-01", ref="CNRB/FD/2025/00042", amount="3500000.00")
    child = start_renewal(c, parent, issueDate="2026-10-13", maturityDate="2027-10-13", amount="3000000")
    ok(post(c.inst1, f"/instruments/{child}/submit"))
    expected = [
        {
            "text": "Coverage gap of 12 days between maturity of CNRB/FD/2025/00042 (1 Oct 2026) and issue of "
            f"{CHILD_REF} (13 Oct 2026)",
            "severity": "CONCERN",
            "visible_to_institution": True,
        },
        {
            "text": "Replacement amount ₹30,00,000.00 is lower than the ₹35,00,000.00 of CNRB/FD/2025/00042 it replaces",
            "severity": "CONCERN",
            "visible_to_institution": True,
        },
    ]
    assert system_observations(child) == expected
    # Return and resubmit unchanged: no duplicates.
    ok(post(c.officer, f"/instruments/{child}/claim"))
    ok(post(c.officer, f"/instruments/{child}/return", {"reason": "Please confirm the gap"}))
    ok(post(c.inst1, f"/instruments/{child}/submit"))
    assert system_observations(child) == expected
    # The institution sees them (visible), and they are warnings, not blockers.
    detail = ok(get(c.inst1, f"/instruments/{child}"))
    assert len(detail["observations"]) == 2
    review = ok(get(c.officer, f"/instruments/{child}/review"))
    assert {g["code"] for g in review["gaps"] if g["code"] == "CONCERN_OBSERVATION"} == {"CONCERN_OBSERVATION"}
    assert not any("Coverage gap" in b for b in review["acceptBlockers"])


def test_no_concerns_for_an_overlapping_same_amount_replacement(c: Ctx) -> None:
    parent = expiring_parent()
    child = start_renewal(c, parent)
    ok(post(c.inst1, f"/instruments/{child}/submit"))
    assert system_observations(child) == []


def test_ac5_d6_renew_refused_while_a_release_request_is_open(c: Ctx) -> None:
    # A real open request (release_requests table, Phase 6), not just the RELEASE_REQUESTED status.
    parent = expiring_parent()
    ok(post(c.inst1, f"/instruments/{parent}/release-requests", {"reason": "Obligation fulfilled"}), 201)
    res = post(c.inst1, f"/instruments/{parent}/renew")
    assert res.status_code == 409 and res.json()["code"] == "NOT_RENEWABLE"
    assert "open release request (checking conditions" in res.json()["message"]


def test_ac5_d6_child_accept_refused_when_the_parent_is_no_longer_renewable(c: Ctx) -> None:
    parent = expiring_parent()
    child = start_renewal(c, parent)
    c.load(bank_record())
    to_review(c, child)
    # Meanwhile the parent left the renewable statuses (test setup writes the status directly).
    exec_(get_pool(), "UPDATE instruments SET status = 'RELEASE_REQUESTED' WHERE id = $1", [parent])
    events_before = count_events()
    version = one(get_pool(), "SELECT version FROM instruments WHERE id = $1", [child])["version"]
    res = post(c.officer, f"/instruments/{child}/accept")
    assert res.status_code == 409 and res.json()["code"] == "PARENT_NOT_RENEWABLE"
    assert "can no longer be renewed" in res.json()["message"]
    assert instrument_status(child) == "UNDER_SCRUTINY" and instrument_status(parent) == "RELEASE_REQUESTED"
    assert one(get_pool(), "SELECT version FROM instruments WHERE id = $1", [child])["version"] == version
    assert count_events() == events_before


def test_accept_rechecks_the_maturity_rule(c: Ctx) -> None:
    parent = expiring_parent()
    exec_(
        get_pool(),
        "UPDATE rules SET config = config || '{\"requireLaterMaturity\": false}' WHERE key = 'renewal_checks'",
    )
    child = start_renewal(c, parent, maturityDate="2026-11-30")
    c.load(bank_record(maturity_date="2026-11-30"))
    to_review(c, child)
    exec_(
        get_pool(),
        "UPDATE rules SET config = config || '{\"requireLaterMaturity\": true}' WHERE key = 'renewal_checks'",
    )
    res = post(c.officer, f"/instruments/{child}/accept")
    assert res.status_code == 422
    assert [f["field"] for f in res.json()["details"]] == ["maturityDate"]
    assert instrument_status(parent) == "EXPIRING"


def test_ac8_three_link_chain_renders_from_any_member(c: Ctx) -> None:
    a = make_instrument("RENEWED", "2023-03-31", issue="2021-03-31", ref="KKBK/FD/2021/00412")
    b = make_instrument("RENEWED", "2025-04-12", issue="2023-04-12", ref="KKBK/FD/2023/00977", parent_id=a)
    cc = make_instrument("ACTIVE", "2027-04-07", issue="2025-04-07", ref="KKBK/FD/2025/01563", parent_id=b)
    for member in (a, b, cc):
        chain = ok(get(c.inst1, f"/instruments/{member}/passport"))["chain"]
        assert [link["id"] for link in chain] == [a, b, cc]
        assert [link["depth"] for link in chain] == {a: [0, 1, 2], b: [-1, 0, 1], cc: [-2, -1, 0]}[member]
        assert [link["isCurrent"] for link in chain] == [member == a, member == b, member == cc]
        assert [link["gapDaysFromPrevious"] for link in chain] == [None, 12, -5]
        assert [link["gapKind"] for link in chain] == [None, "gap", "overlap"]


def test_a_draft_successor_shows_in_the_chain_with_an_unknown_gap(c: Ctx) -> None:
    parent = expiring_parent()
    child = ok(post(c.inst1, f"/instruments/{parent}/renew"), 201)
    chain = ok(get(c.inst1, f"/instruments/{parent}/passport"))["chain"]
    assert [(link["id"], link["status"], link["gapKind"]) for link in chain] == [
        (parent, "EXPIRING", None),
        (child["id"], "DRAFT", "unknown"),
    ]
