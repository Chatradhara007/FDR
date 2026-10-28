"""Mock bank: stands in for an authorised bank verification API (external system, real clock: D19).

Its request/response contract (docs/phases/03-scrutiny.md §3.1) is what a real bank integration would
implement. `GET /records`, `POST /records/load` and `POST /reload` are dev/demo only.
Run: `python -m mock_bank.main [--reload]` (port MOCK_BANK_PORT, default 4000).
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .normalize import norm_amount, norm_bool, norm_date, norm_name, norm_ref
from .video_records import VIDEO_RECORDS

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
EXAMPLE_FILE = DATA_DIR / "records.example.json"

FIELDS = ("reference_no", "issuing_bank", "amount", "issue_date", "maturity_date", "beneficiary_name", "lien_marked")


class BankRecord(TypedDict):
    bank: str
    reference_no: str
    amount: str
    issue_date: str
    maturity_date: str
    beneficiary_name: str
    lien_marked: bool
    lien_in_favour_of: str | None
    status: Literal["LIVE", "CLOSED"]


class FieldResult(TypedDict):
    submitted: str
    confirmed: str
    match: bool


def data_file() -> Path:
    return Path(os.environ.get("MOCK_BANK_DATA_FILE") or DATA_DIR / "records.json")


def _env_list(name: str) -> set[str]:
    return {s.strip() for s in os.environ.get(name, "").split(",") if s.strip()}


def _now_iso() -> str:
    t = datetime.now(UTC)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


class Store:
    """Records in memory, persisted to the data file; first-seen times for slow banks (wall clock, D19)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.records: list[BankRecord] = []
        self.first_seen: dict[tuple[str, str], float] = {}

    def reload(self) -> int:
        path = data_file()
        source = path if path.exists() else EXAMPLE_FILE
        records = json.loads(source.read_text(encoding="utf-8")) if source.exists() else []
        with self.lock:
            self.records = [_clean(r) for r in records]
            self.first_seen.clear()
            return len(self.records)

    def load(self, records: list[BankRecord]) -> int:
        cleaned = [_clean(r) for r in records]
        path = data_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(cleaned, indent=2), encoding="utf-8")
        with self.lock:
            self.records = cleaned
            self.first_seen.clear()
            return len(cleaned)

    def find(self, bank: str, ref: str) -> BankRecord | None:
        """A loaded record, else one of the fixed demo-video records (video_records.py)."""
        with self.lock:
            records = [*self.records, *VIDEO]
            return next((r for r in records if r["bank"] == bank and norm_ref(r["reference_no"]) == ref), None)

    def pending_left(self, bank: str, ref: str, delay: float) -> float:
        """Seconds the bank still needs (first call starts the timer); 0 when the answer is ready."""
        with self.lock:
            first = self.first_seen.setdefault((bank, ref), time.time())
        return max(0.0, first + delay - time.time())


def _clean(r: object) -> BankRecord:
    if not isinstance(r, dict):
        raise ValueError("record must be an object")
    return {
        "bank": str(r["bank"]),
        "reference_no": str(r["reference_no"]),
        "amount": norm_amount(r["amount"]),
        "issue_date": norm_date(r["issue_date"]),
        "maturity_date": norm_date(r["maturity_date"]),
        "beneficiary_name": str(r["beneficiary_name"]),
        "lien_marked": norm_bool(r.get("lien_marked", False)) == "true",
        "lien_in_favour_of": None if r.get("lien_in_favour_of") is None else str(r["lien_in_favour_of"]),
        "status": "CLOSED" if r.get("status") == "CLOSED" else "LIVE",
    }


VIDEO: list[BankRecord] = [_clean(r) for r in VIDEO_RECORDS]

store = Store()
store.reload()

app = FastAPI(title="Mock bank", docs_url=None, redoc_url=None, openapi_url=None)


def _compare(body: dict[str, object], rec: BankRecord) -> dict[str, FieldResult]:
    lien_confirmed = rec["lien_marked"] and "AICTE" in (rec["lien_in_favour_of"] or "").upper()
    pairs: dict[str, tuple[str, str, bool]] = {}
    sub_ref, rec_ref = str(body.get("reference_no") or "").strip(), rec["reference_no"]
    pairs["reference_no"] = (sub_ref, rec_ref, norm_ref(sub_ref) == norm_ref(rec_ref))
    sub_bank = str(body.get("bank") or "")
    pairs["issuing_bank"] = (sub_bank, rec["bank"], sub_bank == rec["bank"])
    sub_amount = norm_amount(body.get("amount"))
    pairs["amount"] = (sub_amount, rec["amount"], sub_amount == rec["amount"])
    for f in ("issue_date", "maturity_date"):
        sub = norm_date(body.get(f))
        pairs[f] = (sub, rec[f], sub == rec[f])
    sub_name = str(body.get("beneficiary_name") or "").strip()
    pairs["beneficiary_name"] = (
        sub_name,
        rec["beneficiary_name"],
        norm_name(sub_name) == norm_name(rec["beneficiary_name"]),
    )
    sub_lien = norm_bool(body.get("lien_marked"))
    conf_lien = "true" if lien_confirmed else "false"
    pairs["lien_marked"] = (sub_lien, conf_lien, sub_lien == conf_lien)
    return {f: {"submitted": s, "confirmed": c, "match": m} for f, (s, c, m) in pairs.items()}


@app.post("/verify")
async def verify(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not body.get("bank") or not body.get("reference_no"):
        return JSONResponse({"error": "bank and reference_no are required"}, status_code=400)
    bank = str(body["bank"])
    responded_at = _now_iso()
    if bank in _env_list("MOCK_BANK_OFFLINE_BANKS"):
        return JSONResponse({"result": "UNAVAILABLE", "bank": bank, "responded_at": responded_at}, status_code=503)
    ref = norm_ref(body["reference_no"])
    response_id = f"rsp_{uuid.uuid4().hex[:16]}"
    rec = store.find(bank, ref)
    if rec is None:
        return JSONResponse(
            {"result": "NOT_FOUND", "response_id": response_id, "bank": bank, "responded_at": responded_at}
        )
    if bank in _env_list("MOCK_BANK_SLOW_BANKS"):
        delay = float(os.environ.get("MOCK_BANK_SLOW_SECONDS", "10"))
        left = store.pending_left(bank, ref, delay)
        if left > 0:
            return JSONResponse(
                {
                    "result": "PENDING",
                    "response_id": response_id,
                    "bank": bank,
                    "responded_at": responded_at,
                    "retry_after_seconds": max(1, int(left + 0.999)),
                }
            )
    fields = _compare(body, rec)
    out: dict[str, object] = {
        "result": "CONFIRMED" if all(f["match"] for f in fields.values()) and rec["status"] == "LIVE" else "MISMATCH",
        "bank": bank,
        "response_id": response_id,
        "responded_at": responded_at,
        "fields": fields,
    }
    if rec["status"] == "CLOSED":
        out["note"] = "Deposit closed at bank"
    return JSONResponse(out)


@app.get("/records")
def records() -> list[BankRecord]:
    with store.lock:
        return list(store.records)


@app.post("/records/load")
async def load_records(request: Request) -> JSONResponse:
    try:
        body = await request.json()
        records = body["records"] if isinstance(body, dict) else None
        if not isinstance(records, list):
            raise ValueError("records must be a list")
        count = store.load(records)
    except (ValueError, KeyError, TypeError) as err:
        return JSONResponse({"error": f"Invalid records: {err}"}, status_code=400)
    return JSONResponse({"loaded": count})


@app.post("/reload")
def reload() -> dict[str, int]:
    return {"loaded": store.reload()}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def main() -> None:
    import uvicorn

    reload = "--reload" in sys.argv[1:]
    port = int(os.environ.get("MOCK_BANK_PORT", "4000"))
    uvicorn.run("mock_bank.main:app", host="0.0.0.0", port=port, reload=reload)


if __name__ == "__main__":
    main()
