"""Rules administration and user management (Phase 8 §8.1–8.2)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.responses import Response

from ..domain.access import AuthUser
from ..domain.errors import NotFound
from ..middleware.auth import UUID, require_role
from ..middleware.responses import json_response
from ..middleware.validate import json_body, parse
from ..schemas import PasswordResetInput, RuleUpdateInput, UserCreateInput, UserPatchInput
from ..services import rule_service, user_service

router = APIRouter()


@router.get("/rules")
def list_rules(user: AuthUser = Depends(require_role("admin", "auditor"))) -> Response:
    return json_response(rule_service.list_rules())


@router.put("/rules/{key}")
def update_rule(
    key: str, user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)
) -> Response:
    return json_response(rule_service.update_rule(user, key, parse(RuleUpdateInput, body)))


@router.post("/rules/{key}/restore-default")
def restore_default(key: str, user: AuthUser = Depends(require_role("admin"))) -> Response:
    return json_response(rule_service.restore_default(user, key))


def _check(user_id: str) -> None:
    if not UUID.match(user_id):
        raise NotFound("User not found")


@router.get("/users")
def list_users(user: AuthUser = Depends(require_role("admin"))) -> Response:
    return json_response(user_service.list_users())


@router.post("/users")
def create_user(user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)) -> Response:
    return json_response(user_service.create_user(user, parse(UserCreateInput, body)), 201)


@router.patch("/users/{user_id}")
def update_user(
    user_id: str, user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)
) -> Response:
    _check(user_id)
    return json_response(user_service.update_user(user, user_id, parse(UserPatchInput, body)))


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: str, user: AuthUser = Depends(require_role("admin")), body: object = Depends(json_body)
) -> Response:
    _check(user_id)
    return json_response(user_service.reset_password(user, user_id, parse(PasswordResetInput, body)))
