from __future__ import annotations

import os
import re
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from app.middleware.responses import json_response
from app.middleware.validate import json_body, parse
from app.schemas import ApiModel, fail
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from helpers import api, reset_db
from pydantic import field_validator
from starlette.responses import Response


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()


class ProbeInput(ApiModel):
    name: str
    amount: str
    maturity_date: str

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v: object) -> str:
        if not isinstance(v, str) or len(v) < 1:
            raise fail("Too short")
        return v

    @field_validator("amount", mode="before")
    @classmethod
    def _amount(cls, v: object) -> str:
        if not isinstance(v, str) or not re.fullmatch(r"\d+(\.\d{1,2})?", v):
            raise fail("Invalid amount")
        return v

    @field_validator("maturity_date", mode="before")
    @classmethod
    def _date(cls, v: object) -> str:
        if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise fail("Invalid date")
        return v


def _mount(router: APIRouter) -> None:
    @router.get("/__test/boom")
    def boom() -> None:
        raise Exception("kaboom")

    @router.get("/__test/async-boom")
    async def async_boom() -> None:
        raise Exception("async kaboom")

    @router.post("/__test/validate")
    def validate(body: object = Depends(json_body)) -> Response:
        data = parse(ProbeInput, body)
        return json_response({"ok": True, "body": data.model_dump(by_alias=True)})


def probe_app() -> TestClient:
    return api(_mount)


def test_ac3_health_returns_200_with_db_up() -> None:
    res = api().get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok" and body["db"] == "up"
    assert body["mockBank"] in ("up", "down")
    assert isinstance(body["time"], str)
    assert res.headers["x-request-id"]


@pytest.fixture
def fake_bank() -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def test_health_reports_the_mock_bank_up_when_it_answers(fake_bank: str) -> None:
    prev = os.environ["MOCK_BANK_URL"]
    os.environ["MOCK_BANK_URL"] = fake_bank
    try:
        assert api().get("/api/v1/health").json()["mockBank"] == "up"
    finally:
        os.environ["MOCK_BANK_URL"] = prev
    assert api().get("/api/v1/health").json()["mockBank"] == "down"


def test_ac4_unknown_routes_return_404_shaped() -> None:
    for path in ("/api/v1/does-not-exist", "/nope"):
        res = api().get(path)
        assert res.status_code == 404
        body = res.json()
        assert set(body) == {"code", "message", "details"}
        assert body["code"] == "NOT_FOUND" and isinstance(body["message"], str) and body["details"] is None


def test_ac5_a_plain_error_becomes_500_internal_with_the_request_id() -> None:
    for path in ("/api/v1/__test/boom", "/api/v1/__test/async-boom"):
        res = probe_app().get(path, headers={"X-Request-Id": "req-abc-123"})
        assert res.status_code == 500
        assert res.json() == {
            "code": "INTERNAL",
            "message": "Unexpected error",
            "details": {"requestId": "req-abc-123"},
        }
        assert res.headers["x-request-id"] == "req-abc-123"
        assert "kaboom" not in res.text


def test_ac5_a_generated_request_id_is_returned_when_none_is_sent() -> None:
    res = probe_app().get("/api/v1/__test/boom")
    assert res.json()["details"]["requestId"] == res.headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f-]{36}", res.json()["details"]["requestId"])


def test_ac6_validate_returns_422_listing_every_failing_field() -> None:
    res = probe_app().post(
        "/api/v1/__test/validate", json={"name": "", "amount": "12.345", "maturityDate": "31/03/2027"}
    )
    assert res.status_code == 422
    assert res.json()["code"] == "VALIDATION_FAILED"
    details = res.json()["details"]
    assert sorted(d["field"] for d in details) == ["amount", "maturityDate", "name"]
    assert all(isinstance(d["message"], str) for d in details)


def test_validate_lists_missing_fields_and_passes_valid_bodies() -> None:
    missing = probe_app().post("/api/v1/__test/validate", json={})
    assert missing.status_code == 422
    assert len(missing.json()["details"]) == 3

    ok = probe_app().post(
        "/api/v1/__test/validate", json={"name": "A", "amount": "2500000.00", "maturityDate": "2027-03-31"}
    )
    assert ok.status_code == 200


def test_malformed_json_is_a_422_in_the_standard_shape() -> None:
    res = probe_app().post("/api/v1/__test/validate", content=b'{"name":', headers={"content-type": "application/json"})
    assert res.status_code == 422
    assert res.json()["code"] == "VALIDATION_FAILED"
    assert res.json()["details"][0]["field"] == "body"
