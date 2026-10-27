"""Public verification of a release order (no sign-in). Deliberately minimal: whoever holds the order number learns
that the order exists and what it says about itself, never an amount, a name or a document.

Not found, not approved, or ambiguous all answer the same way (`valid: false`), so the endpoint cannot be used to
find out which order numbers are in use."""

from __future__ import annotations

import re
from typing import TypedDict

from ..db.pool import get_pool
from ..domain import clock
from ..repositories.event_repo import events_for_entity
from ..repositories.instrument_repo import find_instrument_by_id
from ..repositories.release_repo import find_request, list_approvals, request_ids_with_prefix
from ..shared_constants import ROLE_LABELS
from . import release_service

ORDER_NO = re.compile(r"^AICTE/REL/(\d{4})/([0-9A-F]{8})$")


class NotFoundView(TypedDict):
    valid: bool


class VerifiedOrder(TypedDict):
    valid: bool
    orderNumber: str
    status: str
    instrumentReference: str | None
    approvedDate: str
    approverDesignation: str
    eventHash: str


def verify_release_order(order_no: str) -> VerifiedOrder | NotFoundView:
    m = ORDER_NO.match(order_no.strip().upper())
    if m is None:
        return {"valid": False}
    db = get_pool()
    ids = request_ids_with_prefix(db, m.group(2))
    if len(ids) != 1:  # none, or the prefix is ambiguous: never guess
        return {"valid": False}
    req = find_request(db, ids[0])
    if req is None or req["status"] != "APPROVED" or req["closedAt"] is None:
        return {"valid": False}
    number = release_service.order_number(req)
    if number != m.group(0):
        return {"valid": False}
    event = next((e for e in reversed(events_for_entity(db, "release_request", req["id"]))
                  if e["action"] == "RELEASE_APPROVED"), None)  # fmt: skip
    approvals = [a for a in list_approvals(db, req["id"]) if a["decision"] == "APPROVE"]
    inst = find_instrument_by_id(db, req["instrumentId"])
    if event is None or not approvals or inst is None:
        return {"valid": False}
    final = approvals[-1]
    return {
        "valid": True,
        "orderNumber": number,
        "status": "Approved",
        "instrumentReference": inst["referenceNo"],
        "approvedDate": clock.ist_date(req["closedAt"]),
        "approverDesignation": final["approverDesignation"] or ROLE_LABELS[final["role"]],
        "eventHash": event["hash"],
    }
