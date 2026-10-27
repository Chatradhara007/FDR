"""Verifiable release order: QR code on the order and the public, unauthenticated check behind it."""

from __future__ import annotations

import json

import pytest
from app.config import config
from app.db.pool import exec_, get_pool, one
from app.services.qr import svg_for
from helpers import api, bearer, make_instrument, reset_db, set_today, user_for
from phase10_helpers import approved_release

D0 = "2026-10-25"
ALLOWED_KEYS = {"valid", "orderNumber", "status", "instrumentReference", "approvedDate", "approverDesignation",
                "eventHash"}  # fmt: skip


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()
    set_today(D0)


def lookup(order_no: str) -> dict[str, object]:
    res = api().get(f"/api/v1/verify/release/{order_no}")  # no Authorization header
    assert res.status_code == 200, res.text
    body: dict[str, object] = res.json()
    return body


def test_valid_order_shows_only_the_six_public_fields() -> None:
    _, rid, order = approved_release()
    body = lookup(order)
    assert set(body) == ALLOWED_KEYS and body["valid"] is True
    assert body["orderNumber"] == order and body["status"] == "Approved"
    assert body["instrumentReference"] == "CNRB/FD/2025/00042" and body["approvedDate"] == D0
    assert body["approverDesignation"] == user_designation("approver@demo.in")
    event = one(get_pool(), "SELECT hash FROM events WHERE action = 'RELEASE_APPROVED' AND entity_id = $1", [rid])
    assert body["eventHash"] == event["hash"]
    # The slashes may also arrive percent-encoded (as the page sends them) and in any letter case.
    assert lookup(order.replace("/", "%2F")) == body and lookup(order.lower()) == body


def user_designation(email: str) -> str:
    return str(one(get_pool(), "SELECT designation FROM users WHERE email = $1", [email])["designation"])


def test_response_carries_no_amount_name_or_institution() -> None:
    _, _, order = approved_release()
    text = json.dumps(lookup(order))
    for private in ("2500000", "25,00,000", "Member Secretary", user_for("approver@demo.in").name,
                    user_for("officer@demo.in").name, "Institution", "inst1"):  # fmt: skip
        assert private not in text, private


def test_approver_without_a_designation_shows_the_role_label() -> None:
    _, _, order = approved_release()
    exec_(get_pool(), "UPDATE users SET designation = NULL WHERE email = 'approver@demo.in'")
    assert lookup(order)["approverDesignation"] == "Approver"


def test_unknown_malformed_and_unapproved_orders_are_all_just_not_found() -> None:
    instrument_id, rid, order = approved_release()
    year, prefix = order.split("/")[2], order.split("/")[3]
    not_found = {"valid": False}
    assert lookup("AICTE/REL/2026/FFFFFFFF") == not_found
    assert lookup("not-an-order") == not_found
    assert lookup(f"AICTE/REL/2025/{prefix}") == not_found  # right prefix, wrong year
    assert lookup(f"AICTE/REL/{year}/{prefix[:7]}") == not_found
    # A request that is not approved has no order: guessing its number from the id finds nothing.
    pending = make_instrument("ACTIVE", "2027-12-01", ref="CNRB/FD/2025/00099")
    res = api().post(f"/api/v1/instruments/{pending}/release-requests", headers=bearer(user_for("inst1@demo.in")),
                     json={"reason": "x"})  # fmt: skip
    assert res.status_code == 201
    pid = res.json()["request"]["id"]
    assert lookup(f"AICTE/REL/{year}/{pid[:8].upper()}") == not_found
    assert instrument_id and rid


def test_a_prefix_shared_by_two_requests_is_never_valid() -> None:
    _, rid, order = approved_release()
    assert lookup(order)["valid"] is True
    other = make_instrument("ACTIVE", "2027-12-01", ref="CNRB/FD/2025/00077")
    twin = rid[:8] + "-0000-4000-8000-000000000001"
    exec_(
        get_pool(),
        """INSERT INTO release_requests (id, instrument_id, requested_by, reason, status, required_levels, requested_at,
                                       stage_started_at)
     VALUES ($1, $2, $3, 'twin', 'CANCELLED', '[]'::jsonb, now(), now())""",
        [twin, other, user_for("inst1@demo.in").id],
    )
    assert lookup(order) == {"valid": False}


def test_release_view_carries_the_verify_link_and_qr_only_once_approved(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://192.168.1.20:5173/")
    assert config.public_base_url == "http://192.168.1.20:5173"
    instrument_id = make_instrument("ACTIVE", "2027-12-01", ref="CNRB/FD/2025/00055")
    inst1 = user_for("inst1@demo.in")
    open_view = api().post(f"/api/v1/instruments/{instrument_id}/release-requests", headers=bearer(inst1),
                           json={"reason": "x"}).json()  # fmt: skip
    assert open_view["orderNumber"] is None and open_view["verifyUrl"] is None and open_view["qrSvg"] is None

    _, rid, order = approved_release()
    view = api().get(f"/api/v1/release-requests/{rid}", headers=bearer(user_for("officer@demo.in"))).json()
    assert view["verifyUrl"] == f"http://192.168.1.20:5173/verify/{order}"
    assert view["qrSvg"].startswith("<svg") and view["qrSvg"] == svg_for(view["verifyUrl"])
    assert "width=" not in view["qrSvg"].split(">", 1)[0]  # sized by the page, not in millimetres
    # The same fields on the passport's release list.
    inst = view["instrument"]["id"]
    passport = api().get(f"/api/v1/instruments/{inst}/passport", headers=bearer(inst1)).json()
    assert passport["releaseRequests"][0]["verifyUrl"] == view["verifyUrl"]


def test_public_base_url_defaults_to_the_frontend_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://localhost:5173,http://other")
    assert config.public_base_url == "http://localhost:5173"


def test_the_public_endpoint_is_rate_limited_per_client() -> None:
    client = api()
    codes = [client.get("/api/v1/verify/release/AICTE/REL/2026/FFFFFFFF").status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and codes[30:] == [429, 429]
