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

DEVICES: dict[str, dict] = {}
ITEMS: dict[str, dict] = {}
TRANSFERS: dict[str, dict] = {}
CHANGES: list[dict] = []
CONNECTION: Gio.DBusConnection | None = None
REVISION = 0
DEFAULT_CHANNEL_ID = "11111111-1111-4111-8111-111111111111"
CONFIGURATION = {
    "server-address": "http://127.0.0.1:8765",
    "api-key-configured": False,
    "active-channel-id": DEFAULT_CHANNEL_ID,
    "active-channel-name": "Default",
}
CHANNELS = [{"id": DEFAULT_CHANNEL_ID, "name": "Default"}]


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


def _device_record(device_id: str, requester_id: str = "") -> dict:
    profile = DEVICES.get(device_id, {"tag": "", "icon-kind": "other"})
    return {
        "device-id": device_id,
        "tag": profile["tag"],
        "icon-kind": profile["icon-kind"],
        "state": "online",
        "last-seen-at": profile.get("last-seen-at", 0),
        "is-current": device_id == requester_id,
    }


def _transfer_dictionary(transfer: dict) -> dict:
    return {
        "transfer-id": transfer["transfer-id"],
        "item-id": transfer["item-id"],
        "device-id": transfer["device-id"],
        "kind": transfer["kind"],
        "direction": transfer["direction"],
        "state": transfer["state"],
        "completed-bytes": transfer["completed-bytes"],
        "total-bytes": transfer["total-bytes"],
        "peer-device-ids": transfer["peer-device-ids"],
        "created-at": transfer["created-at"],
        "updated-at": transfer["updated-at"],
        **({"error-code": transfer["error-code"]} if transfer.get("error-code") else {}),
        **({"error-message": transfer["error-message"]} if transfer.get("error-message") else {}),
    }


def _emit_transfer(transfer: dict):
    if CONNECTION is None:
        return
    CONNECTION.emit_signal(
        None,
        OBJECT_PATH,
        INTERFACE,
        "TransferChanged",
        GLib.Variant("(a{sv})", (_variant_dictionary(_transfer_dictionary(transfer)),)),
    )


def _new_transfer(item_id: str, device_id: str, kind: str, direction: str, total: int) -> dict:
    timestamp = GLib.get_real_time() // 1000
    transfer = {
        "transfer-id": str(uuid.uuid4()),
        "item-id": item_id,
        "device-id": device_id,
        "kind": kind,
        "direction": direction,
        "state": "queued",
        "completed-bytes": 0,
        "total-bytes": total,
        "peer-device-ids": [candidate for candidate in DEVICES if candidate != device_id],
        "created-at": timestamp,
        "updated-at": timestamp,
        "error-code": "",
        "error-message": "",
    }
    TRANSFERS[transfer["transfer-id"]] = transfer
    return transfer


def _add_change(item_id: str):
    global REVISION
    REVISION += 1
    CHANGES.append({"sequence": REVISION, "kind": "upsert", "item-id": item_id})
    if CONNECTION is not None:
        CONNECTION.emit_signal(
            None,
            OBJECT_PATH,
            INTERFACE,
            "ChangesAvailable",
            GLib.Variant("(s)", (str(REVISION),)),
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
        if method_name == "GetStatus":
            status = {
                "state": "online",
                "network-state": "connected",
                "pending-items": len(CHANGES),
                "active-transfers": sum(
                    transfer["device-id"] == values[0]
                    and transfer["state"] not in {"completed", "failed", "cancelled", "expired"}
                    for transfer in TRANSFERS.values()
                ),
                "last-sync-at": GLib.get_real_time() // 1000 if REVISION else 0,
                "revision": REVISION,
            }
            invocation.return_value(
                GLib.Variant("(a{sv})", (_variant_dictionary(status),))
            )
            return

        if method_name == "RegisterDevice":
            profile = values[1]
            DEVICES[values[0]] = {
                "tag": profile.get("tag", ""),
                "icon-kind": profile.get("icon-kind", "other"),
                "last-seen-at": GLib.get_real_time() // 1000,
            }
            invocation.return_value(GLib.Variant("()", ()))
            _connection.emit_signal(
                None,
                OBJECT_PATH,
                INTERFACE,
                "DeviceChanged",
                GLib.Variant(
                    "(a{sv})",
                    (_variant_dictionary(_device_record(values[0], values[0])),),
                ),
            )
            return

        if method_name == "ListDevices":
            invocation.return_value(
                GLib.Variant(
                    "(aa{sv})",
                    ([
                        _variant_dictionary(_device_record(device_id, values[0]))
                        for device_id in DEVICES
                    ],),
                )
            )
            return

        if method_name == "GetConfiguration":
            invocation.return_value(
                GLib.Variant("(a{sv})", (_variant_dictionary(CONFIGURATION),))
            )
            return

        if method_name == "UpdateConfiguration":
            changes = values[1]
            if changes.get("server-address"):
                CONFIGURATION["server-address"] = changes["server-address"]
            if changes.get("active-channel-id"):
                channel_id = changes["active-channel-id"]
                if not any(channel["id"] == channel_id for channel in CHANNELS):
                    raise ValueError("Unknown channel")
                CONFIGURATION["active-channel-id"] = channel_id
                CONFIGURATION["active-channel-name"] = next(
                    channel["name"] for channel in CHANNELS if channel["id"] == channel_id
                )
            if changes.get("api-key"):
                CONFIGURATION["api-key-configured"] = True
            if changes.get("clear-api-key"):
                CONFIGURATION["api-key-configured"] = False
            invocation.return_value(
                GLib.Variant("(a{sv})", (_variant_dictionary(CONFIGURATION),))
            )
            _connection.emit_signal(
                None,
                OBJECT_PATH,
                INTERFACE,
                "ConfigurationChanged",
                GLib.Variant("(a{sv})", (_variant_dictionary(CONFIGURATION),)),
            )
            return

        if method_name == "ListChannels":
            channels = [
                _variant_dictionary({
                    **channel,
                    "active": channel["id"] == CONFIGURATION["active-channel-id"],
                })
                for channel in CHANNELS
            ]
            invocation.return_value(GLib.Variant("(aa{sv})", (channels,)))
            return

        if method_name == "TestConnection":
            configured = CONFIGURATION["api-key-configured"]
            result = {
                "state": "online" if configured else "offline",
                "latency-ms": 1,
                "server-version": "0.1.0-python-mock",
                "message": "Connected" if configured else "API key is not configured",
            }
            invocation.return_value(
                GLib.Variant("(a{sv})", (_variant_dictionary(result),))
            )
            return

        if method_name == "Publish":
            device_id, metadata, previews, contents, _options = values
            item_id = metadata.get("id", str(uuid.uuid4()))
            fd_list = invocation.get_message().get_unix_fd_list()
            ITEMS[item_id] = {
                "device_id": device_id,
                "metadata": metadata,
                "previews": _receive_payloads(previews, fd_list),
                "contents": _receive_payloads(contents, fd_list),
            }
            eager_size = sum(
                len(payload["bytes"])
                for payload in ITEMS[item_id]["contents"]
                if payload["metadata"].get("delivery") == "eager"
            )
            preview_size = sum(len(payload["bytes"]) for payload in ITEMS[item_id]["previews"])
            transfer = _new_transfer(item_id, device_id, "publish", "upload", eager_size + preview_size)
            invocation.return_value(
                GLib.Variant("(ss)", (item_id, transfer["transfer-id"]))
            )
            _add_change(item_id)
            _emit_transfer(transfer)

            def complete_publish():
                transfer["state"] = "completed"
                transfer["completed-bytes"] = transfer["total-bytes"]
                transfer["updated-at"] = GLib.get_real_time() // 1000
                _emit_transfer(transfer)
                return GLib.SOURCE_REMOVE

            GLib.timeout_add(20, complete_publish)
            return

        if method_name == "GetChanges":
            cursor = int(values[1] or "0")
            limit = max(1, min(1000, int(values[2].get("limit", 200))))
            pending = [change for change in CHANGES if change["sequence"] > cursor]
            page = pending[:limit]
            next_cursor = page[-1]["sequence"] if page else cursor
            invocation.return_value(
                GLib.Variant(
                    "(saa{sv}b)",
                    (
                        str(next_cursor),
                        [_variant_dictionary(change) for change in page],
                        len(pending) > len(page),
                    ),
                )
            )
            return

        if method_name == "GetItem":
            item = ITEMS[values[1]]
            fd_list, open_fds, previews = _payload_reply(item["previews"])
            metadata = dict(item["metadata"])
            device = _device_record(item["device_id"])
            metadata["origin-device-tag"] = device["tag"]
            metadata["origin-device-icon-kind"] = device["icon-kind"]
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
            device_id, item_id, content_ids, _options = values
            selected = [
                payload
                for payload in ITEMS[item_id]["contents"]
                if payload["metadata"].get("content-id") in content_ids
            ]
            total = sum(len(payload["bytes"]) for payload in selected)
            transfer = _new_transfer(item_id, device_id, "content", "download", total)
            transfer_id = transfer["transfer-id"]
            invocation.return_value(GLib.Variant("(s)", (transfer_id,)))
            _emit_transfer(transfer)

            def transferring():
                current = TRANSFERS.get(transfer_id)
                if current is None or current["state"] in {"cancelled", "failed", "expired"}:
                    return GLib.SOURCE_REMOVE
                current["state"] = "transferring"
                current["completed-bytes"] = total // 2
                current["updated-at"] = GLib.get_real_time() // 1000
                _emit_transfer(current)
                return GLib.SOURCE_REMOVE

            def completed():
                current = TRANSFERS.get(transfer_id)
                if current is None or current["state"] in {"cancelled", "failed", "expired"}:
                    return GLib.SOURCE_REMOVE
                current["state"] = "completed"
                current["completed-bytes"] = total
                current["updated-at"] = GLib.get_real_time() // 1000
                _emit_transfer(current)
                return GLib.SOURCE_REMOVE

            GLib.timeout_add(30, transferring)
            GLib.timeout_add(60, completed)
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
            transfer = TRANSFERS.get(transfer_id)
            if transfer is not None and transfer["state"] not in {"completed", "failed", "cancelled", "expired"}:
                transfer["state"] = "cancelled"
                transfer["error-code"] = "cancelled"
                transfer["error-message"] = "Cancelled by client"
                transfer["updated-at"] = GLib.get_real_time() // 1000
                _emit_transfer(transfer)
            invocation.return_value(GLib.Variant("()", ()))
            return

        if method_name == "GetTransfer":
            transfer = TRANSFERS[values[1]]
            if transfer["device-id"] != values[0]:
                raise KeyError(values[1])
            invocation.return_value(
                GLib.Variant(
                    "(a{sv})",
                    (_variant_dictionary(_transfer_dictionary(transfer)),),
                )
            )
            return

        if method_name == "ListTransfers":
            state = values[1].get("state", "")
            result = [
                _variant_dictionary(_transfer_dictionary(transfer))
                for transfer in TRANSFERS.values()
                if transfer["device-id"] == values[0]
                and (not state or transfer["state"] == state)
            ]
            invocation.return_value(GLib.Variant("(aa{sv})", (result,)))
            return

        if method_name == "Acknowledge":
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
