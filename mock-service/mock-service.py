#!/usr/bin/env python3
"""Python reference implementation of Clipboard X Sync1 for ABI tests."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import uuid

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402


BUS_NAME = "io.github.guleo.ClipboardX.MockService"
OBJECT_PATH = "/io/github/guleo/ClipboardX/Sync"
INTERFACE = "io.github.guleo.ClipboardX.Sync1"
PROTOCOL_PATH = (
    Path(__file__).resolve().parent.parent
    / "protocol"
    / "io.github.guleo.ClipboardX.Sync1.xml"
)

DEVICES: dict[str, str] = {}
ITEMS: dict[str, dict] = {}
TRANSFERS: dict[str, dict] = {}
CONNECTION: Gio.DBusConnection | None = None


def _variant(value):
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
            return GLib.Variant(
                "aa{sv}",
                [_variant_dictionary(item) for item in value],
            )
        return GLib.Variant("as", value)
    raise TypeError(f"Unsupported metadata value: {type(value).__name__}")


def _variant_dictionary(dictionary: dict) -> dict[str, GLib.Variant]:
    return {key: _variant(value) for key, value in dictionary.items()}


def _read_fd(fd_list: Gio.UnixFDList, index: int) -> bytes:
    fd = os.dup(fd_list.get(index))
    chunks: list[bytes] = []
    try:
        while chunk := os.read(fd, 64 * 1024):
            chunks.append(chunk)
    finally:
        os.close(fd)
    return b"".join(chunks)


def _receive_payloads(payloads, fd_list: Gio.UnixFDList) -> list[dict]:
    return [
        {
            "mime_type": mime_type,
            "metadata": metadata,
            "bytes": _read_fd(fd_list, fd_index),
        }
        for mime_type, metadata, fd_index in payloads
    ]


def _payload_reply(payloads: list[dict]):
    fd_list = Gio.UnixFDList.new()
    open_fds: list[int] = []
    values = []
    for payload in payloads:
        fd = os.memfd_create("clipboard-x-sync1", os.MFD_CLOEXEC)
        os.write(fd, payload["bytes"])
        os.lseek(fd, 0, os.SEEK_SET)
        open_fds.append(fd)
        fd_index = fd_list.append(fd)
        values.append(
            (
                payload["mime_type"],
                _variant_dictionary(payload["metadata"]),
                fd_index,
            )
        )
    return fd_list, open_fds, values


def _emit_transfer(transfer_id: str, state: str, received: int, total: int, error=""):
    if CONNECTION is None:
        return
    CONNECTION.emit_signal(
        None,
        OBJECT_PATH,
        INTERFACE,
        "TransferChanged",
        GLib.Variant("(sstts)", (transfer_id, state, received, total, error)),
    )


def _method_call(
    _connection,
    _sender,
    _object_path,
    _interface_name,
    method_name,
    parameters,
    invocation,
):
    try:
        values = parameters.unpack()
        if method_name == "RegisterDevice":
            DEVICES[values[0]] = values[1]
            invocation.return_value(GLib.Variant("()", ()))
            return

        if method_name == "Publish":
            device_id, metadata, previews, contents = values
            item_id = metadata.get("id", str(uuid.uuid4()))
            fd_list = invocation.get_message().get_unix_fd_list()
            ITEMS[item_id] = {
                "device_id": device_id,
                "metadata": metadata,
                "previews": _receive_payloads(previews, fd_list),
                "contents": _receive_payloads(contents, fd_list),
            }
            invocation.return_value(GLib.Variant("(s)", (item_id,)))
            _connection.emit_signal(
                None,
                OBJECT_PATH,
                INTERFACE,
                "ItemAvailable",
                GLib.Variant("(s)", (item_id,)),
            )
            return

        if method_name == "ListPending":
            invocation.return_value(GLib.Variant("(as)", (list(ITEMS),)))
            return

        if method_name == "GetItem":
            item = ITEMS[values[1]]
            fd_list, open_fds, previews = _payload_reply(item["previews"])
            metadata = dict(item["metadata"])
            metadata["origin-device-tag"] = DEVICES.get(item["device_id"], "")
            try:
                invocation.return_value_with_unix_fd_list(
                    GLib.Variant(
                        "(a{sv}a(sa{sv}h))",
                        (_variant_dictionary(metadata), previews),
                    ),
                    fd_list,
                )
            finally:
                for fd in open_fds:
                    os.close(fd)
            return

        if method_name == "RequestContent":
            _, item_id, content_ids = values
            transfer_id = str(uuid.uuid4())
            selected = [
                payload
                for payload in ITEMS[item_id]["contents"]
                if payload["metadata"].get("content-id") in content_ids
            ]
            total = sum(len(payload["bytes"]) for payload in selected)
            TRANSFERS[transfer_id] = {"total": total, "state": "queued"}
            invocation.return_value(GLib.Variant("(s)", (transfer_id,)))
            _emit_transfer(transfer_id, "queued", 0, total)

            def transferring():
                transfer = TRANSFERS.get(transfer_id)
                if transfer is None:
                    return GLib.SOURCE_REMOVE
                transfer["state"] = "transferring"
                _emit_transfer(transfer_id, "transferring", total // 2, total)
                return GLib.SOURCE_REMOVE

            def ready():
                transfer = TRANSFERS.get(transfer_id)
                if transfer is None:
                    return GLib.SOURCE_REMOVE
                transfer["state"] = "ready"
                _emit_transfer(transfer_id, "ready", total, total)
                return GLib.SOURCE_REMOVE

            GLib.timeout_add(30, transferring)
            GLib.timeout_add(60, ready)
            return

        if method_name == "OpenContent":
            _, item_id, content_id = values
            payload = next(
                candidate
                for candidate in ITEMS[item_id]["contents"]
                if candidate["metadata"].get("content-id") == content_id
            )
            fd_list, open_fds, reply = _payload_reply([payload])
            try:
                invocation.return_value_with_unix_fd_list(
                    GLib.Variant(
                        "(a{sv}h)",
                        (_variant_dictionary(payload["metadata"]), reply[0][2]),
                    ),
                    fd_list,
                )
            finally:
                for fd in open_fds:
                    os.close(fd)
            return

        if method_name == "CancelTransfer":
            transfer_id = values[1]
            if TRANSFERS.pop(transfer_id, None) is not None:
                _emit_transfer(transfer_id, "cancelled", 0, 0, "Cancelled by client")
            invocation.return_value(GLib.Variant("()", ()))
            return

        if method_name in {"Acknowledge", "OpenPreferences"}:
            invocation.return_value(GLib.Variant("()", ()))
            return

        invocation.return_dbus_error(
            f"{INTERFACE}.Error.Unsupported",
            f"Unsupported method: {method_name}",
        )
    except (KeyError, StopIteration, OSError, TypeError, ValueError) as error:
        invocation.return_dbus_error(f"{INTERFACE}.Error.InvalidItem", str(error))


def _get_property(_connection, _sender, _path, _interface, property_name):
    properties = {
        "ApiVersion": GLib.Variant("u", 1),
        "ImplementationName": GLib.Variant("s", "Clipboard X Python Mock Service"),
        "ImplementationVersion": GLib.Variant("s", "0.1.0"),
        "Status": GLib.Variant("s", "online"),
        "SupportedMimeTypes": GLib.Variant(
            "as",
            [
                "text/plain;charset=utf-8",
                "text/html",
                "image/png",
                "image/jpeg",
                "image/webp",
            ],
        ),
        "MaxItemBytes": GLib.Variant("t", 128 * 1024 * 1024),
        "MaxPreviewBytes": GLib.Variant("t", 512 * 1024),
    }
    return properties.get(property_name)


def main() -> int:
    global CONNECTION
    node_info = Gio.DBusNodeInfo.new_for_xml(PROTOCOL_PATH.read_text(encoding="utf-8"))
    interface_info = node_info.interfaces[0]
    loop = GLib.MainLoop.new(None, False)
    registration_id = 0

    def bus_acquired(connection, _name):
        nonlocal registration_id
        global CONNECTION
        CONNECTION = connection
        registration_id = connection.register_object(
            OBJECT_PATH,
            interface_info,
            _method_call,
            _get_property,
            None,
        )
        print("READY", flush=True)

    def name_lost(_connection, _name):
        print("Unable to own mock service bus name", file=sys.stderr, flush=True)
        loop.quit()

    owner_id = Gio.bus_own_name(
        Gio.BusType.SESSION,
        BUS_NAME,
        Gio.BusNameOwnerFlags.NONE,
        bus_acquired,
        None,
        name_lost,
    )
    try:
        loop.run()
    finally:
        if registration_id and CONNECTION is not None:
            CONNECTION.unregister_object(registration_id)
        Gio.bus_unown_name(owner_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
