from __future__ import annotations

from pathlib import Path
import signal
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

from .constants import BUS_NAME, OBJECT_PATH
from .interface import SyncInterface
from .sessions import DEFAULT_LEASE_MS


SHUTDOWN_GRACE_MS = 100


class ServiceApplication:
    def __init__(self, configuration_path: Path, protocol_path: Path):
        xml = protocol_path.read_text(encoding="utf-8")
        node = Gio.DBusNodeInfo.new_for_xml(xml)
        self._interface_info = node.interfaces[0]
        self._interface = SyncInterface(configuration_path, self._sessions_changed)
        self._loop = GLib.MainLoop.new(None, False)
        self._connection: Gio.DBusConnection | None = None
        self._registration_id = 0
        self._exit_code = 0
        self._acquired_bus = False
        self._lifecycle_source = 0
        self._shutting_down = False

    def run(self) -> int:
        owner_id = Gio.bus_own_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            self._bus_acquired,
            None,
            self._name_lost,
        )
        signal_sources = [
            GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, number, self._stop)
            for number in (signal.SIGINT, signal.SIGTERM)
        ]
        try:
            self._loop.run()
        finally:
            for source_id in signal_sources:
                GLib.source_remove(source_id)
            self._cancel_lifecycle_source()
            self._interface.detach()
            if self._registration_id and self._connection is not None:
                self._connection.unregister_object(self._registration_id)
            Gio.bus_unown_name(owner_id)
        return self._exit_code

    def _bus_acquired(self, connection: Gio.DBusConnection, _name: str) -> None:
        self._acquired_bus = True
        self._connection = connection
        self._interface.attach(connection)
        self._registration_id = connection.register_object(
            OBJECT_PATH,
            self._interface_info,
            self._interface.call,
            self._interface.get_property,
            None,
        )
        self._schedule_lifecycle(DEFAULT_LEASE_MS)

    def _name_lost(self, connection: Gio.DBusConnection | None, _name: str) -> None:
        if connection is None and self._acquired_bus:
            self._loop.quit()
            return
        if connection is None:
            print("Clipboard X Service could not connect to the session bus", file=sys.stderr)
        else:
            print(f"Clipboard X Service could not own {BUS_NAME}", file=sys.stderr)
        self._exit_code = 1
        self._loop.quit()

    def _stop(self) -> bool:
        self._loop.quit()
        return GLib.SOURCE_REMOVE

    def _sessions_changed(self) -> None:
        if self._shutting_down:
            return
        delay = self._interface.milliseconds_until_expiration()
        self._schedule_lifecycle(delay if delay is not None else SHUTDOWN_GRACE_MS)

    def _schedule_lifecycle(self, delay_ms: int) -> None:
        self._cancel_lifecycle_source()
        if delay_ms <= 0:
            self._lifecycle_source = GLib.idle_add(
                self._evaluate_lifecycle,
                priority=GLib.PRIORITY_DEFAULT_IDLE,
            )
        else:
            self._lifecycle_source = GLib.timeout_add(
                delay_ms,
                self._evaluate_lifecycle,
                priority=GLib.PRIORITY_DEFAULT,
            )

    def _evaluate_lifecycle(self) -> bool:
        self._lifecycle_source = 0
        self._interface.expire_sessions()
        delay = self._interface.milliseconds_until_expiration()
        if delay is not None:
            self._schedule_lifecycle(delay)
            return GLib.SOURCE_REMOVE
        self._prepare_shutdown()
        return GLib.SOURCE_REMOVE

    def _prepare_shutdown(self) -> None:
        if self._interface.has_sessions or self._shutting_down:
            return
        self._shutting_down = True
        self._interface.prepare_shutdown(self._shutdown_completed)

    def _shutdown_completed(self) -> None:
        if self._interface.has_sessions:
            self._shutting_down = False
            self._sessions_changed()
            return
        self._loop.quit()

    def _cancel_lifecycle_source(self) -> None:
        if self._lifecycle_source:
            GLib.source_remove(self._lifecycle_source)
        self._lifecycle_source = 0
