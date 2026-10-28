"""Phase 03 §3.1: the mock bank's verification contract."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from mock_bank.main import app, store

RECORD: dict[str, Any] = {
    "bank": "Canara Bank",
    "reference_no": "CNRB/FD/2026/10001",
    "amount": "2000000.00",
    "issue_date": "2026-04-01",
    "maturity_date": "2027-03-31",
    "beneficiary_name": "MEMBER SECRETARY AICTE",
    "lien_marked": True,
    "lien_in_favour_of": "Member Secretary, AICTE",
    "status": "LIVE",
}

CLAIM: dict[str, Any] = {
    "reference_no": "cnrb/fd/2026/10001",
    "bank": "Canara Bank",
    "amount": "20,00,000",
    "issue_date": "2026-04-01",
    "maturity_date": "2027-03-31",
    "beneficiary_name": "Member Secretary, AICTE",
    "lien_marked": True,
}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("MOCK_BANK_DATA_FILE", str(tmp_path / "records.json"))
    monkeypatch.setenv("MOCK_BANK_OFFLINE_BANKS", "Indian Overseas Bank")
    monkeypatch.setenv("MOCK_BANK_SLOW_BANKS", "Bank of India")
    monkeypatch.setenv("MOCK_BANK_SLOW_SECONDS", "1")
    c = TestClient(app)
    records = [
        RECORD,
        {**RECORD, "bank": "Bank of India", "reference_no": "BKID/FD/2026/1"},
        {**RECORD, "bank": "HDFC Bank", "reference_no": "HDFC/FD/1", "status": "CLOSED"},
        {**RECORD, "bank": "Axis Bank", "reference_no": "UTIB/FD/1", "lien_in_favour_of": "Axis Bank"},
    ]
    assert c.post("/records/load", json={"records": records}).json() == {"loaded": 4}
    yield c
    store.reload()


def verify(c: TestClient, **changes: Any) -> Any:
    return c.post("/verify", json={**CLAIM, **changes})


def test_confirmed_when_every_normalised_field_matches(client: TestClient) -> None:
    body = verify(client).json()
    assert body["result"] == "CONFIRMED"
    assert body["response_id"].startswith("rsp_")
    assert body["bank"] == "Canara Bank"
    assert set(body["fields"]) == {
        "reference_no", "issuing_bank", "amount", "issue_date", "maturity_date", "beneficiary_name", "lien_marked",
    }  # fmt: skip
    assert all(f["match"] for f in body["fields"].values())


def test_mismatch_lists_submitted_and_confirmed_values(client: TestClient) -> None:
    body = verify(client, amount="2500000").json()
    assert body["result"] == "MISMATCH"
    assert body["fields"]["amount"] == {"submitted": "2500000.00", "confirmed": "2000000.00", "match": False}
    assert body["fields"]["maturity_date"]["match"] is True


def test_not_found(client: TestClient) -> None:
    body = verify(client, reference_no="CNRB/FD/2026/99999").json()
    assert body["result"] == "NOT_FOUND"
    assert "response_id" in body and "fields" not in body


def test_offline_bank_is_503_unavailable(client: TestClient) -> None:
    res = verify(client, bank="Indian Overseas Bank")
    assert res.status_code == 503
    assert res.json()["result"] == "UNAVAILABLE"


def test_slow_bank_is_pending_then_answers(client: TestClient) -> None:
    first = verify(client, bank="Bank of India", reference_no="BKID/FD/2026/1").json()
    assert first["result"] == "PENDING"
    assert first["retry_after_seconds"] == 1
    assert verify(client, bank="Bank of India", reference_no="BKID/FD/2026/1").json()["result"] == "PENDING"
    time.sleep(1.1)
    assert verify(client, bank="Bank of India", reference_no="BKID/FD/2026/1").json()["result"] == "CONFIRMED"


def test_closed_deposit_is_a_mismatch_with_a_note(client: TestClient) -> None:
    body = verify(client, bank="HDFC Bank", reference_no="HDFC/FD/1").json()
    assert body["result"] == "MISMATCH"
    assert body["note"] == "Deposit closed at bank"


def test_lien_only_confirmed_in_favour_of_aicte(client: TestClient) -> None:
    body = verify(client, bank="Axis Bank", reference_no="UTIB/FD/1").json()
    assert body["result"] == "MISMATCH"
    assert body["fields"]["lien_marked"] == {"submitted": "true", "confirmed": "false", "match": False}


def test_records_load_persists_and_reload_rereads(client: TestClient) -> None:
    assert len(client.get("/records").json()) == 4
    assert client.post("/records/load", json={"records": [RECORD]}).json() == {"loaded": 1}
    assert client.post("/reload").json() == {"loaded": 1}
    assert client.get("/records").json()[0]["reference_no"] == RECORD["reference_no"]
    assert client.post("/records/load", json={"records": "nope"}).status_code == 400


def test_demo_video_records_survive_a_load_and_are_not_listed(client: TestClient) -> None:
    def check(ref: str, bank: str = "State Bank of India") -> Any:
        claim = {"bank": bank, "reference_no": ref, "issue_date": "2026-09-15", "maturity_date": "2029-09-15"}
        return client.post("/verify", json={**CLAIM, "amount": "25,00,000", **claim})

    def mismatched(ref: str) -> list[str]:
        return [f for f, r in check(ref).json()["fields"].items() if not r["match"]]

    assert all(not r["reference_no"].startswith("SBIN/FDR/2026/090") for r in client.get("/records").json())
    assert check("SBIN/FDR/2026/09001").json()["result"] == "CONFIRMED"
    assert mismatched("SBIN/FDR/2026/09002") == ["amount"]
    assert mismatched("SBIN/FDR/2026/09003") == ["maturity_date"]
    assert check("SBIN/FDR/2026/09004", "Indian Overseas Bank").status_code == 503
