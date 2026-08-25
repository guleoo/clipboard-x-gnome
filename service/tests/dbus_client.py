from __future__ import annotations

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402


BUS_NAME = "io.github.guleo.ClipboardX.SyncService"
OBJECT_PATH = "/io/github/guleo/ClipboardX/Sync"
INTERFACE = "io.github.guleo.ClipboardX.Sync1"
DEVICE_ID = "11111111-1111-4111-8111-111111111111"


def dictionary(values):
    return {
        name: value if isinstance(value, GLib.Variant) else GLib.Variant("s", value)
        for name, value in values.items()
    }


def unpack(value):
    if isinstance(value, GLib.Variant):
        return unpack(value.unpack())
    if isinstance(value, list):
        return [unpack(item) for item in value]
    if isinstance(value, dict):
        return {name: unpack(item) for name, item in value.items()}
    return value


connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(method, parameters, reply_type):
    return connection.call_sync(
        BUS_NAME,
        OBJECT_PATH,
        INTERFACE,
        method,
        parameters,
        GLib.VariantType.new(reply_type),
        Gio.DBusCallFlags.NONE,
        5_000,
        None,
    )


opened = unpack(call(
    "OpenSession",
    GLib.Variant("(sa{sv})", (DEVICE_ID, {
        "lease-ms": GLib.Variant("t", 5_000),
    })),
    "(a{sv})",
))[0]
session_id = opened["session-id"]
assert opened["lease-ms"] == 5_000

renewed = unpack(call(
    "RenewSession",
    GLib.Variant("(s)", (session_id,)),
    "(a{sv})",
))[0]
assert renewed["session-id"] == session_id

call(
    "RegisterDevice",
    GLib.Variant("(sa{sv})", (DEVICE_ID, dictionary({
        "tag": "Test device",
        "icon-kind": "laptop",
    }))),
    "()",
)
devices = unpack(call(
    "ListDevices",
    GLib.Variant("(s)", (DEVICE_ID,)),
    "(aa{sv})",
))[0]
assert devices[0]["tag"] == "Test device"

configuration = unpack(call(
    "GetConfiguration",
    GLib.Variant("(s)", (DEVICE_ID,)),
    "(a{sv})",
))[0]
assert configuration["server-address"] == "127.0.0.1:8765"
assert configuration["api-key-configured"] is True
assert "test-secret" not in repr(configuration)

status = unpack(call(
    "GetStatus",
    GLib.Variant("(s)", (DEVICE_ID,)),
    "(a{sv})",
))[0]
assert status["state"] == "degraded"

call(
    "CloseSession",
    GLib.Variant("(s)", (session_id,)),
    "()",
)
