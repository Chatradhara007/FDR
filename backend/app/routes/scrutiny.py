from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from ..domain.access import AuthUser
from ..domain.errors import NotFound
from ..middleware.auth import UUID, require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse, query_dict
from ..schemas import AcceptInput, DocumentCheckInput, NoteInput, ObservationCreate, QueueQuery, ReasonInput
from ..services import scrutiny_service
from ..services.verification_service import request_verification
from ..shared_constants import Role
from .instruments import check_ids

router = APIRouter()

# Read-only AICTE roles may look at the queue and review pages; every scrutiny action is the officer's.
REVIEWERS: tuple[Role, ...] = ("officer", "approver", "admin", "auditor")


def _check(entity_id: str, what: str) -> None:
    if not UUID.match(entity_id):
        raise NotFound(f"{what} not found")


@router.get("/scrutiny/queue")
def queue(request: Request, user: AuthUser = Depends(require_role(*REVIEWERS))) -> Response:
    return json_response(scrutiny_service.queue(user, parse(QueueQuery, query_dict(request), "query")))


@router.get("/instruments/{instrument_id}/review")
def review(instrument_id: str, user: AuthUser = Depends(require_role(*REVIEWERS))) -> Response:
    check_ids(instrument_id)
    return json_response(scrutiny_service.get_review(user, instrument_id))


@router.post("/instruments/{instrument_id}/claim")
def claim(instrument_id: str, user: AuthUser = Depends(require_role("officer"))) -> Response:
    check_ids(instrument_id)
    return json_response(scrutiny_service.claim(user, instrument_id))


@router.post("/instruments/{instrument_id}/verify")
def verify(instrument_id: str, user: AuthUser = Depends(require_role("officer"))) -> Response:
    check_ids(instrument_id)
    return json_response(request_verification(user, instrument_id))


@router.post("/instruments/{instrument_id}/fields/{field}/check-document")
def check_document(
    instrument_id: str, field: str, user: AuthUser = Depends(require_role("officer")), body: object = Depends(json_body)
) -> Response:
    check_ids(instrument_id)
    data = parse(DocumentCheckInput, body)
    return json_response(scrutiny_service.check_document(user, instrument_id, field, data))


@router.post("/instruments/{instrument_id}/observations")
def add_observation(
    instrument_id: str, user: AuthUser = Depends(require_role("officer")), body: object = Depends(json_body)
) -> Response:
    check_ids(instrument_id)
    return json_response(scrutiny_service.add_observation(user, instrument_id, parse(ObservationCreate, body)), 201)


@router.post("/observations/{observation_id}/resolve")
def resolve_observation(
    observation_id: str, user: AuthUser = Depends(require_role("officer")), body: object = Depends(json_body)
) -> Response:
    _check(observation_id, "Observation")
    note = parse(NoteInput, body).note
    return json_response(scrutiny_service.resolve_observation_with_note(user, observation_id, note))


@router.post("/instruments/{instrument_id}/return")
def return_instrument(
    instrument_id: str, user: AuthUser = Depends(require_role("officer")), body: object = Depends(json_body)
) -> Response:
    check_ids(instrument_id)
    reason = parse(ReasonInput, body).reason
    return json_response(scrutiny_service.return_instrument(user, instrument_id, reason))


@router.post("/instruments/{instrument_id}/accept")
def accept(
    instrument_id: str, user: AuthUser = Depends(require_role("officer")), body: object = Depends(json_body)
) -> Response:
    check_ids(instrument_id)
    return json_response(scrutiny_service.accept(user, instrument_id, parse(AcceptInput, body)))


@router.post("/discrepancies/{discrepancy_id}/resolve")
def resolve_discrepancy(
    discrepancy_id: str, user: AuthUser = Depends(require_role("officer")), body: object = Depends(json_body)
) -> Response:
    _check(discrepancy_id, "Discrepancy")
    note = parse(NoteInput, body).note
    return json_response(scrutiny_service.resolve_discrepancy_with_note(user, discrepancy_id, note))
