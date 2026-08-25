from __future__ import annotations

from pathlib import Path
import re
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

from .configuration import Configuration, ConfigurationError, load
from .constants import API_VERSION, DEVICE_ICON_KINDS, INTERFACE, OBJECT_PATH
from .sessions import (
    SessionError,
    SessionNotAuthorized,
    SessionNotFound,
    SessionRegistry,
)
from . import __version__


UUID_V4 = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _variant(value: object) -> GLib.Variant:
    if isinstance(value, GLib.Variant):
        return value
    if isinstance(value, bool):
        return GLib.Variant("b", value)
    if isinstance(value, int):
        return GLib.Variant("t", value)
    if isinstance(value, str):
        return GLib.Variant("s", value)
    if isinstance(value, list):
        if all(isinstance(item, dict) for item in value):
            return GLib.Variant("aa{sv}", [_variant_dictionary(item) for item in value])
        return GLib.Variant("as", value)
    raise TypeError(f"unsupported D-Bus value: {type(value).__name__}")


def _variant_dictionary(values: dict[str, object]) -> dict[str, GLib.Variant]:
    return {name: _variant(value) for name, value in values.items()}


class SyncInterface:
    def __init__(self, configuration_path: Path, sessions_changed=lambda: None):
        self._configuration_path = configuration_path
        self._configuration = Configuration()
        self._configuration_error = ""
        self._devices: dict[str, dict[str, object]] = {}
        self._connection: Gio.DBusConnection | None = None
        self._name_owner_subscription = 0
        self._sessions = SessionRegistry()
        self._sessions_changed = sessions_changed
        self.reload_configuration()

    @property
    def has_sessions(self) -> bool:
        return self._sessions.active

    def milliseconds_until_expiration(self) -> int | None:
        return self._sessions.milliseconds_until_expiration()

    def expire_sessions(self) -> int:
        return self._sessions.expire()

    def prepare_shutdown(self, completed) -> None:
        # Network transports and the durable queue will complete their cleanup
        # before invoking this callback.
        completed()

    def attach(self, connection: Gio.DBusConnection) -> None:
        self._connection = connection
        self._name_owner_subscription = connection.signal_subscribe(
            "org.freedesktop.DBus",
            "org.freedesktop.DBus",
            "NameOwnerChanged",
            "/org/freedesktop/DBus",
            None,
            Gio.DBusSignalFlags.NONE,
            self._name_owner_changed,
        )

    def detach(self) -> None:
        if self._connection is not None and self._name_owner_subscription:
            self._connection.signal_unsubscribe(self._name_owner_subscription)
        self._name_owner_subscription = 0
        self._connection = None

    def reload_configuration(self) -> None:
        try:
            self._configuration = load(self._configuration_path)
            self._configuration_error = ""
        except ConfigurationError as error:
            self._configuration = Configuration()
            self._configuration_error = str(error)

    def get_property(
        self,
        _connection,
        _sender,
        _path,
        _interface,
        property_name,
    ) -> GLib.Variant | None:
        state = "error" if self._configuration_error else "offline"
        properties = {
            "ApiVersion": GLib.Variant("u", API_VERSION),
            "ImplementationName": GLib.Variant("s", "Clipboard X Python Service"),
            "ImplementationVersion": GLib.Variant("s", __version__),
            "Status": GLib.Variant("s", state),
            "SupportedMimeTypes": GLib.Variant("as", []),
            "MaxItemBytes": GLib.Variant("t", 0),
            "MaxPreviewBytes": GLib.Variant("t", 0),
        }
        return properties.get(property_name)

    def call(
        self,
        connection,
        sender,
        _object_path,
        _interface_name,
        method_name,
        parameters,
        invocation,
    ) -> None:
        try:
            values = parameters.unpack()
            if method_name == "OpenSession":
                self._validate_device_id(values[0])
                lease_ms = values[1].get("lease-ms")
                session = self._sessions.open(sender, values[0], lease_ms)
                invocation.return_value(GLib.Variant("(a{sv})", (
                    _variant_dictionary(session),
                )))
                self._sessions_changed()
                return
            if method_name == "RenewSession":
                session = self._sessions.renew(sender, values[0])
                invocation.return_value(GLib.Variant("(a{sv})", (
                    _variant_dictionary(session),
                )))
                self._sessions_changed()
                return
            if method_name == "CloseSession":
                self._sessions.close(sender, values[0])
                invocation.return_value(GLib.Variant("()", ()))
                self._sessions_changed()
                return
            if method_name == "GetStatus":
                invocation.return_value(GLib.Variant("(a{sv})", (
                    _variant_dictionary(self._status()),
                )))
                return
            if method_name == "RegisterDevice":
                self._register_device(connection, values[0], values[1])
                invocation.return_value(GLib.Variant("()", ()))
                return
            if method_name == "ListDevices":
                requester = values[0]
                devices = [
                    _variant_dictionary({**device, "is-current": device_id == requester})
                    for device_id, device in self._devices.items()
                ]
                invocation.return_value(GLib.Variant("(aa{sv})", (devices,)))
                return
            if method_name == "GetConfiguration":
                invocation.return_value(self._configuration_reply())
                return
            if method_name == "UpdateConfiguration":
                self.reload_configuration()
                reply = self._configuration_reply()
                invocation.return_value(reply)
                self._emit("ConfigurationChanged", reply.get_child_value(0))
                return
            if method_name == "ListChannels":
                invocation.return_value(GLib.Variant("(aa{sv})", ([],)))
                return
            if method_name == "TestConnection":
                result = {
                    "state": "error" if self._configuration_error else "offline",
                    "latency-ms": 0,
                    "message": self._configuration_error or "Server transport is not implemented yet",
                }
                invocation.return_value(GLib.Variant("(a{sv})", (
                    _variant_dictionary(result),
                )))
                return
            if method_name == "GetChanges":
                invocation.return_value(GLib.Variant("(saa{sv}b)", (
                    values[1], [], False,
                )))
                return
            if method_name == "ListTransfers":
                invocation.return_value(GLib.Variant("(aa{sv})", ([],)))
                return
            self._return_offline(invocation, method_name)
        except SessionNotAuthorized as error:
            invocation.return_dbus_error(f"{INTERFACE}.Error.NotAuthorized", str(error))
        except SessionNotFound as error:
            invocation.return_dbus_error(f"{INTERFACE}.Error.InvalidSession", str(error))
        except (IndexError, KeyError, SessionError, TypeError, ValueError) as error:
            invocation.return_dbus_error(f"{INTERFACE}.Error.InvalidItem", str(error))

    def _status(self) -> dict[str, object]:
        if self._configuration_error:
            state = "error"
            network_state = "invalid-configuration"
        elif not self._configuration.server_address or not self._configuration.api_key:
            state = "offline"
            network_state = "not-configured"
        else:
            state = "degraded"
            network_state = "transport-unavailable"
        return {
            "state": state,
            "network-state": network_state,
            "pending-items": GLib.Variant("u", 0),
            "active-transfers": GLib.Variant("u", 0),
            "last-sync-at": GLib.Variant("t", 0),
            "revision": GLib.Variant("t", 0),
            **({
                "error-code": "invalid_configuration",
                "error-message": self._configuration_error,
            } if self._configuration_error else {}),
        }

    def _configuration_reply(self) -> GLib.Variant:
        return GLib.Variant("(a{sv})", (
            _variant_dictionary(self._configuration.public_values()),
        ))

    def _register_device(
        self,
        connection: Gio.DBusConnection,
        device_id: str,
        profile: dict[str, object],
    ) -> None:
        self._validate_device_id(device_id)
        if not isinstance(profile, dict):
            raise ValueError("invalid device profile")
        tag = profile.get("tag", "")
        icon_kind = profile.get("icon-kind", "")
        if not isinstance(tag, str) or not tag or len(tag) > 256 or re.search(r"[\r\n\0]", tag):
            raise ValueError("invalid device Tag")
        if icon_kind not in DEVICE_ICON_KINDS:
            raise ValueError("invalid device icon kind")
        device = {
            "device-id": device_id,
            "tag": tag,
            "icon-kind": icon_kind,
            "state": "offline",
            "last-seen-at": GLib.Variant("t", int(time.time() * 1000)),
            "is-current": True,
        }
        self._devices[device_id] = device
        connection.emit_signal(
            None,
            OBJECT_PATH,
            INTERFACE,
            "DeviceChanged",
            GLib.Variant("(a{sv})", (_variant_dictionary(device),)),
        )

    @staticmethod
    def _validate_device_id(device_id: str) -> None:
        if not isinstance(device_id, str) or UUID_V4.fullmatch(device_id) is None:
            raise ValueError("invalid DeviceId")

    def _name_owner_changed(
        self,
        _connection,
        _sender,
        _path,
        _interface,
        _signal,
        parameters,
    ) -> None:
        name, _old_owner, new_owner = parameters.unpack()
        if not new_owner and self._sessions.remove_sender(name):
            self._sessions_changed()

    def _emit(self, name: str, value: GLib.Variant) -> None:
        if self._connection is not None:
            self._connection.emit_signal(
                None,
                OBJECT_PATH,
                INTERFACE,
                name,
                GLib.Variant.new_tuple([value]),
            )

    @staticmethod
    def _return_offline(invocation, method_name: str) -> None:
        invocation.return_dbus_error(
            f"{INTERFACE}.Error.Offline",
            f"{method_name} is unavailable until the server transport is implemented",
        )
