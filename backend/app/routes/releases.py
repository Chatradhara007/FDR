from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.responses import Response

from ..domain.access import AuthUser
from ..domain.errors import NotFound
from ..middleware.auth import ALL_ROLES, UUID, require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse, query_dict
from ..schemas import ConditionUpdate, DecideInput, NoteInput, RecommendInput, ReleaseListQuery, ReleaseRequestCreate
from ..services import release_service
from .instruments import check_ids, receive_file

router = APIRouter()


def _check(entity_id: str, what: str = "Release request") -> None:
    if not UUID.match(entity_id):
        raise NotFound(f"{what} not found")


@router.post("/instruments/{instrument_id}/release-requests")
def create(
    instrument_id: str, user: AuthUser = Depends(require_role("institution")), body: object = Depends(json_body)
) -> Response:
    check_ids(instrument_id)
    return json_response(release_service.create_request(user, instrument_id, parse(ReleaseRequestCreate, body)), 201)


@router.get("/release-requests")
def list_requests(request: Request, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    return json_response(release_service.list_requests(user, parse(ReleaseListQuery, query_dict(request), "query")))


@router.get("/release-requests/{request_id}")
def get(request_id: str, user: AuthUser = Depends(require_role(*ALL_ROLES))) -> Response:
    _check(request_id)
    return json_response(release_service.get_request(user, request_id))


@router.post("/release-requests/{request_id}/documents")
async def upload(request_id: str, request: Request, user: AuthUser = Depends(require_role("institution"))) -> Response:
    _check(request_id)
    async with request.form(max_files=1, max_fields=5) as form:
        raw_file = form.get("file")
        file = await receive_file(raw_file) if isinstance(raw_file, UploadFile) else None
        doc_type = form.get("docType")
    result = await run_in_threadpool(release_service.upload_release_document, user, request_id, doc_type, file)
    return json_response(result, 201)


@router.patch("/release-conditions/{condition_id}")
def update_condition(
    condition_id: str, user: AuthUser = Depends(require_role("officer")), body: object = Depends(json_body)
) -> Response:
    _check(condition_id, "Release condition")
    return json_response(release_service.update_condition(user, condition_id, parse(ConditionUpdate, body)))


@router.post("/release-requests/{request_id}/recommend")
def recommend(
    request_id: str, user: AuthUser = Depends(require_role("officer", "approver", "admin")),
    body: object = Depends(json_body),
) -> Response:  # fmt: skip
    _check(request_id)
    return json_response(release_service.recommend(user, request_id, parse(RecommendInput, body)))


@router.post("/release-requests/{request_id}/decide")
def decide(
    request_id: str, user: AuthUser = Depends(require_role("officer", "approver", "admin")),
    body: object = Depends(json_body),
) -> Response:  # fmt: skip
    _check(request_id)
    return json_response(release_service.decide(user, request_id, parse(DecideInput, body)))


@router.post("/release-requests/{request_id}/resubmit")
def resubmit(
    request_id: str, user: AuthUser = Depends(require_role("institution")), body: object = Depends(json_body)
) -> Response:
    _check(request_id)
    return json_response(release_service.resubmit(user, request_id, parse(NoteInput, body).note))


@router.post("/release-requests/{request_id}/cancel")
def cancel(request_id: str, user: AuthUser = Depends(require_role("institution"))) -> Response:
    _check(request_id)
    return json_response(release_service.cancel(user, request_id))
