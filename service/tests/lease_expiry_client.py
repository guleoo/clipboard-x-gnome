from __future__ import annotations

import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402


BUS_NAME = "io.github.guleo.ClipboardX.SyncService"
OBJECT_PATH = "/io/github/guleo/ClipboardX/Sync"
INTERFACE = "io.github.guleo.ClipboardX.Sync1"
DEVICE_ID = "11111111-1111-4111-8111-111111111111"

connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
connection.call_sync(
    BUS_NAME,
    OBJECT_PATH,
    INTERFACE,
    "OpenSession",
    GLib.Variant("(sa{sv})", (DEVICE_ID, {
        "lease-ms": GLib.Variant("t", 5_000),
    })),
    GLib.VariantType.new("(a{sv})"),
    Gio.DBusCallFlags.NONE,
    5_000,
    None,
)

# Keep the same D-Bus caller alive while deliberately withholding renewal.
time.sleep(5.5)
try:
    connection.call_sync(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "GetNameOwner",
        GLib.Variant("(s)", (BUS_NAME,)),
        GLib.VariantType.new("(s)"),
        Gio.DBusCallFlags.NONE,
        1_000,
        None,
    )
except GLib.Error as error:
    if Gio.DBusError.get_remote_error(error) != "org.freedesktop.DBus.Error.NameHasNoOwner":
        raise
else:
    raise RuntimeError("Service remained alive after the client lease expired")
