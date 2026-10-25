"""Client for the bank verification API (the mock bank in dev/demo; §3.1 is the integration contract).

Never called inside a DB transaction (rule 9). Any network error, timeout or unreadable answer is
reported as UNAVAILABLE, so the officer falls back to document checks and the override path.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

import httpx

from ..config import config

BankResultCode = Literal["CONFIRMED", "MISMATCH", "NOT_FOUND", "PENDING", "UNAVAILABLE"]


class BankPayload(TypedDict):
    reference_no: str
    bank: str
    amount: str
    issue_date: str
    maturity_date: str
    beneficiary_name: str
    lien_marked: str


class BankField(TypedDict):
    submitted: str
    confirmed: str
    match: bool


class BankResult(TypedDict):
    result: BankResultCode
    bank: NotRequired[str]
    response_id: NotRequired[str]
    responded_at: NotRequired[str]
    fields: NotRequired[dict[str, BankField]]
    note: NotRequired[str]
    retry_after_seconds: NotRequired[int]
    reason: NotRequired[str]


RESULTS: tuple[BankResultCode, ...] = ("CONFIRMED", "MISMATCH", "NOT_FOUND", "PENDING", "UNAVAILABLE")


def _parse(body: object) -> BankResult | None:
    if not isinstance(body, dict) or body.get("result") not in RESULTS:
        return None
    out: BankResult = {"result": body["result"]}
    for key in ("bank", "response_id", "responded_at", "note"):
        if isinstance(body.get(key), str):
            out[key] = body[key]
    if isinstance(body.get("retry_after_seconds"), int | float):
        out["retry_after_seconds"] = int(body["retry_after_seconds"])
    fields = body.get("fields")
    if isinstance(fields, dict):
        out["fields"] = {
            str(k): {"submitted": str(v.get("submitted", "")), "confirmed": str(v.get("confirmed", "")),
                     "match": v.get("match") is True}
            for k, v in fields.items()
            if isinstance(v, dict)
        }  # fmt: skip
    if out["result"] in ("CONFIRMED", "MISMATCH") and "fields" not in out:
        return None
    return out


def verify_with_bank(payload: BankPayload, timeout_ms: int = 5000) -> BankResult:
    try:
        res = httpx.post(f"{config.mock_bank_url}/verify", json=payload, timeout=timeout_ms / 1000)
    except httpx.TimeoutException:
        return {"result": "UNAVAILABLE", "reason": "Bank did not answer in time"}
    except httpx.HTTPError as err:
        return {"result": "UNAVAILABLE", "reason": f"Bank could not be reached ({type(err).__name__})"}
    try:
        parsed = _parse(res.json())
    except ValueError:
        parsed = None
    if res.status_code == 503 or (parsed is not None and parsed["result"] == "UNAVAILABLE"):
        return {**(parsed or {}), "result": "UNAVAILABLE", "reason": "Bank service unavailable"}  # type: ignore[typeddict-item]
    if res.status_code != 200 or parsed is None:
        return {"result": "UNAVAILABLE", "reason": f"Unexpected bank response (HTTP {res.status_code})"}
    return parsed
