import unittest

from clipboard_x_service.sessions import (
    DEFAULT_LEASE_MS,
    SessionNotAuthorized,
    SessionNotFound,
    SessionRegistry,
)


class Clock:
    def __init__(self):
        self.monotonic = 1_000
        self.wall = 2_000_000

    def advance(self, milliseconds):
        self.monotonic += milliseconds
        self.wall += milliseconds


class SessionRegistryTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.sessions = SessionRegistry(
            monotonic_ms=lambda: self.clock.monotonic,
            wall_time_ms=lambda: self.clock.wall,
        )

    def test_default_lease_is_fifteen_seconds(self):
        self.assertEqual(DEFAULT_LEASE_MS, 15_000)

    def test_renewal_extends_the_lease(self):
        session = self.sessions.open("sender-a", "device-a", 15_000)
        self.assertEqual(session["lease-ms"], 15_000)
        self.assertEqual(self.sessions.milliseconds_until_expiration(), 15_000)
        self.clock.advance(5_000)
        renewed = self.sessions.renew("sender-a", session["session-id"])
        self.assertEqual(renewed["expires-at"], self.clock.wall + 15_000)
        self.clock.advance(14_999)
        self.assertEqual(self.sessions.expire(), 0)
        self.clock.advance(1)
        self.assertEqual(self.sessions.expire(), 1)
        self.assertFalse(self.sessions.active)

    def test_expired_session_cannot_be_renewed(self):
        session = self.sessions.open("sender-a", "device-a", 5_000)
        self.clock.advance(5_000)
        with self.assertRaises(SessionNotFound):
            self.sessions.renew("sender-a", session["session-id"])

    def test_session_is_bound_to_dbus_sender(self):
        session = self.sessions.open("sender-a", "device-a", 15_000)
        with self.assertRaises(SessionNotAuthorized):
            self.sessions.close("sender-b", session["session-id"])
        self.assertTrue(self.sessions.active)

    def test_removing_sender_closes_all_its_sessions(self):
        self.sessions.open("sender-a", "device-a", 15_000)
        self.sessions.open("sender-a", "device-b", 15_000)
        self.sessions.open("sender-b", "device-c", 15_000)
        self.assertEqual(self.sessions.remove_sender("sender-a"), 2)
        self.assertEqual(self.sessions.count, 1)

    def test_reopening_same_device_replaces_previous_session(self):
        previous = self.sessions.open("sender-a", "device-a", 15_000)
        current = self.sessions.open("sender-a", "device-a", 30_000)
        self.assertNotEqual(previous["session-id"], current["session-id"])
        self.assertEqual(self.sessions.count, 1)
        with self.assertRaises(SessionNotFound):
            self.sessions.renew("sender-a", previous["session-id"])
        self.assertEqual(
            self.sessions.renew("sender-a", current["session-id"])["lease-ms"],
            30_000,
        )


if __name__ == "__main__":
    unittest.main()
