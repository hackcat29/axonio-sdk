"""Session management for the synchronous ClawDB client.

The HTTP core opens, renews and retries sessions on its own; this client
exposes them for callers that want to inspect or end one explicitly.
"""
from __future__ import annotations

from typing import Any

from axonio._http import HttpCore


class SessionClient:
    def __init__(self, core: HttpCore) -> None:
        self._core = core
        self.session_data: dict[str, Any] = {}

    @property
    def token(self) -> str | None:
        return self._core.token

    def create(self, *, role: str | None = None, scopes: list[str] | None = None, task_type: str | None = None) -> dict[str, Any]:
        """Opens a new session (the role defaults to the client's)."""
        if role:
            self._core.role = role
        self.session_data = self._core.open_session()
        return self.session_data

    def validate(self) -> bool:
        """True when the current session is accepted by the server."""
        if not self._core.token:
            return False
        try:
            data = self._core.call("ValidateSession")
        except Exception:
            return False
        return bool(data.get("session_id") or data.get("id"))

    def refresh(self) -> dict[str, Any]:
        """Replaces the current session with a new one."""
        self._core.forget_session()
        return self.create()

    def revoke_by_id(self, session_id: str) -> bool:
        return bool(self._core.call("RevokeSession", {"session_id": session_id}).get("revoked"))

    def active_count(self) -> int:
        return int(self._core.call("ActiveSessionCount").get("count") or 0)

    def revoke(self) -> None:
        """Ends the current session, if any. Never raises."""
        session_id = self._core.session_id
        if not session_id:
            return
        try:
            self._core.call("RevokeSession", {"session_id": session_id})
        except Exception:
            pass
        self._core.forget_session()
