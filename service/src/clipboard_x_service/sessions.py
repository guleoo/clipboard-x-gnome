from __future__ import annotations

from dataclasses import dataclass
import time
import uuid


DEFAULT_LEASE_MS = 15_000
MINIMUM_LEASE_MS = 5_000
MAXIMUM_LEASE_MS = 300_000


class SessionError(ValueError):
    pass


class SessionNotFound(SessionError):
    pass


class SessionNotAuthorized(SessionError):
    pass


@dataclass(slots=True)
class Session:
    id: str
    sender: str
    device_id: str
    lease_ms: int
    expires_monotonic_ms: int


class SessionRegistry:
    def __init__(self, monotonic_ms=None, wall_time_ms=None):
        self._monotonic_ms = monotonic_ms or (lambda: time.monotonic_ns() // 1_000_000)
        self._wall_time_ms = wall_time_ms or (lambda: time.time_ns() // 1_000_000)
        self._sessions: dict[str, Session] = {}

    @property
    def active(self) -> bool:
        return bool(self._sessions)

    @property
    def count(self) -> int:
        return len(self._sessions)

    def open(self, sender: str, device_id: str, lease_ms: int) -> dict[str, object]:
        if not isinstance(lease_ms, int) or isinstance(lease_ms, bool):
            raise SessionError("lease-ms must be an integer")
        if lease_ms < MINIMUM_LEASE_MS or lease_ms > MAXIMUM_LEASE_MS:
            raise SessionError(
                f"lease-ms must be between {MINIMUM_LEASE_MS} and {MAXIMUM_LEASE_MS}",
            )
        previous = [
            session_id
            for session_id, session in self._sessions.items()
            if session.sender == sender and session.device_id == device_id
        ]
        for session_id in previous:
            del self._sessions[session_id]
        now = self._monotonic_ms()
        session = Session(
            id=str(uuid.uuid4()),
            sender=sender,
            device_id=device_id,
            lease_ms=lease_ms,
            expires_monotonic_ms=now + lease_ms,
        )
        self._sessions[session.id] = session
        return self._public(session, now)

    def renew(self, sender: str, session_id: str) -> dict[str, object]:
        session = self._owned(sender, session_id)
        now = self._monotonic_ms()
        if session.expires_monotonic_ms <= now:
            del self._sessions[session.id]
            raise SessionNotFound("session lease has expired")
        session.expires_monotonic_ms = now + session.lease_ms
        return self._public(session, now)

    def close(self, sender: str, session_id: str) -> None:
        session = self._owned(sender, session_id)
        del self._sessions[session.id]

    def expire(self) -> int:
        now = self._monotonic_ms()
        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if session.expires_monotonic_ms <= now
        ]
        for session_id in expired:
            del self._sessions[session_id]
        return len(expired)

    def remove_sender(self, sender: str) -> int:
        removed = [
            session_id
            for session_id, session in self._sessions.items()
            if session.sender == sender
        ]
        for session_id in removed:
            del self._sessions[session_id]
        return len(removed)

    def milliseconds_until_expiration(self) -> int | None:
        if not self._sessions:
            return None
        now = self._monotonic_ms()
        return max(1, min(
            session.expires_monotonic_ms - now
            for session in self._sessions.values()
        ))

    def _owned(self, sender: str, session_id: str) -> Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFound("unknown session")
        if session.sender != sender:
            raise SessionNotAuthorized("session belongs to another D-Bus caller")
        return session

    def _public(self, session: Session, now_monotonic_ms: int) -> dict[str, object]:
        remaining = max(0, session.expires_monotonic_ms - now_monotonic_ms)
        return {
            "session-id": session.id,
            "lease-ms": session.lease_ms,
            "expires-at": self._wall_time_ms() + remaining,
        }
