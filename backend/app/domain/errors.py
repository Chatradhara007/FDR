"""Domain errors. The error handler turns each into `{ code, message, details }` with its HTTP status."""

from __future__ import annotations


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        details: object = None,
        http_status: int = 500,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details
        self.http_status = http_status
        self.headers = headers or {}


class NotFound(AppError):
    def __init__(self, message: str = "Not found", details: object = None) -> None:
        super().__init__("NOT_FOUND", message, details, 404)


class Unauthorized(AppError):
    def __init__(
        self, message: str = "Authentication required", details: object = None, code: str = "UNAUTHORIZED"
    ) -> None:
        super().__init__(code, message, details, 401)


class Forbidden(AppError):
    def __init__(self, message: str = "Not allowed", details: object = None) -> None:
        super().__init__("FORBIDDEN", message, details, 403)


class Conflict(AppError):
    def __init__(self, message: str, details: object = None, code: str = "CONFLICT") -> None:
        super().__init__(code, message, details, 409)


class ValidationFailed(AppError):
    """422. Details are the failing fields, or (submit) `{ fields, missingDocuments }`."""

    def __init__(self, details: object, message: str = "Validation failed") -> None:
        super().__init__("VALIDATION_FAILED", message, details, 422)


class InvalidTransition(AppError):
    def __init__(self, from_status: str, to_status: str, message: str | None = None) -> None:
        super().__init__(
            "INVALID_TRANSITION",
            message or f"Cannot move from {from_status} to {to_status}",
            {"from": from_status, "to": to_status},
            409,
        )


class TooManyRequests(AppError):
    def __init__(self, message: str, headers: dict[str, str] | None = None) -> None:
        super().__init__("RATE_LIMITED", message, None, 429, headers)


class InvalidState(Conflict):
    """409 for an action the record's current state does not allow (other than a status transition)."""

    def __init__(self, message: str, details: object = None) -> None:
        super().__init__(message, details, "INVALID_STATE")


class AcceptBlocked(Conflict):
    """409 ACCEPT_BLOCKED listing every reason (D4)."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("This instrument cannot be accepted yet", {"reasons": reasons}, "ACCEPT_BLOCKED")
