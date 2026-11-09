from __future__ import annotations

from typing import Any

try:
    import grpc
    from grpc import StatusCode
except ImportError:  # pragma: no cover
    grpc = None  # type: ignore[assignment]
    StatusCode = None  # type: ignore[assignment]


class ClawDBError(Exception):
    """Base class for all ClawDB errors."""

    def __init__(
        self,
        code: str,
        message: str,
        details: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details
        self.request_id = request_id

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(code={self.code!r}, message={self.message!r})"

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
            "request_id": self.request_id,
        }

    @classmethod
    def from_grpc_error(cls, e: Any) -> "ClawDBError":
        """Map a grpc.RpcError to the appropriate ClawDBError subclass."""
        if grpc is None or not isinstance(e, grpc.RpcError):
            return ClawDBInternalError(str(e), details=e)

        status = e.code()  # type: ignore[attr-defined]
        message: str = e.details() or str(e)  # type: ignore[attr-defined]
        metadata = dict(e.trailing_metadata() or [])  # type: ignore[attr-defined]
        request_id = metadata.get("x-request-id")

        if status == StatusCode.UNAUTHENTICATED:
            return ClawDBAuthError(message, request_id=request_id)
        if status == StatusCode.PERMISSION_DENIED:
            return ClawDBAccessDeniedError(message, resource="unknown", action="unknown", request_id=request_id)
        if status == StatusCode.NOT_FOUND:
            return ClawDBNotFoundError(message, entity_type="entity", entity_id="unknown", request_id=request_id)
        if status == StatusCode.RESOURCE_EXHAUSTED:
            retry_after_ms = int(metadata.get("retry-after-ms", metadata.get("retry-after", 1000)))
            return ClawDBRateLimitError(message, retry_after_ms=retry_after_ms, request_id=request_id)
        if status == StatusCode.UNAVAILABLE:
            return ClawDBUnavailableError(message, request_id=request_id)
        if status == StatusCode.DEADLINE_EXCEEDED:
            return ClawDBTimeoutError(message, timeout_ms=30000, request_id=request_id)
        if status == StatusCode.INVALID_ARGUMENT:
            return ClawDBValidationError(message, request_id=request_id)
        return ClawDBInternalError(message, request_id=request_id)


class ClawDBAuthError(ClawDBError):
    def __init__(self, message: str = "Authentication failed", *, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("AUTH_FAILED", message, details=details, request_id=request_id)


class ClawDBAccessDeniedError(ClawDBError):
    def __init__(self, message: str, *, resource: str, action: str, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("ACCESS_DENIED", message, details=details, request_id=request_id)
        self.resource = resource
        self.action = action


class ClawDBNotFoundError(ClawDBError):
    def __init__(self, message: str, *, entity_type: str, entity_id: str, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("NOT_FOUND", message, details=details, request_id=request_id)
        self.entity_type = entity_type
        self.entity_id = entity_id


class ClawDBRateLimitError(ClawDBError):
    def __init__(self, message: str = "Rate limited", *, retry_after_ms: int = 1000, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("RATE_LIMITED", message, details=details, request_id=request_id)
        self.retry_after_ms = retry_after_ms

    @property
    def retry_after_seconds(self) -> float:
        return self.retry_after_ms / 1000.0


class ClawDBUnavailableError(ClawDBError):
    def __init__(self, message: str = "Service unavailable", *, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("UNAVAILABLE", message, details=details, request_id=request_id)


class ClawDBTimeoutError(ClawDBError):
    def __init__(self, message: str = "Request timed out", *, timeout_ms: int = 30000, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("TIMEOUT", message, details=details, request_id=request_id)
        self.timeout_ms = timeout_ms


class ClawDBValidationError(ClawDBError):
    def __init__(self, message: str, *, field: str | None = None, constraint: str | None = None, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("INVALID_INPUT", message, details=details, request_id=request_id)
        self.field = field
        self.constraint = constraint


class ClawDBInternalError(ClawDBError):
    def __init__(self, message: str = "Internal server error", *, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("INTERNAL", message, details=details, request_id=request_id)


class ClawDBProvisionError(ClawDBError):
    def __init__(self, message: str = "Provisioning failed", *, request_id: str | None = None, details: Any = None) -> None:
        super().__init__("PROVISION_FAILED", message, details=details, request_id=request_id)
