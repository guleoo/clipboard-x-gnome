from __future__ import annotations

from pathlib import Path
import signal
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

from .constants import BUS_NAME, OBJECT_PATH
from .interface import SyncInterface


class ServiceApplication:
    def __init__(self, configuration_path: Path, protocol_path: Path):
        xml = protocol_path.read_text(encoding="utf-8")
        node = Gio.DBusNodeInfo.new_for_xml(xml)
        self._interface_info = node.interfaces[0]
        self._interface = SyncInterface(configuration_path)
        self._loop = GLib.MainLoop.new(None, False)
        self._connection: Gio.DBusConnection | None = None
        self._registration_id = 0
        self._exit_code = 0
        self._acquired_bus = False

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
