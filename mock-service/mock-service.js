#!/usr/bin/env -S gjs -m

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

const BUS_NAME = 'io.github.guleo.ClipboardX.MockService';
const OBJECT_PATH = '/io/github/guleo/ClipboardX/Sync';
const INTERFACE = 'io.github.guleo.ClipboardX.Sync1';
const SUPPORTED_MIME_TYPES = (GLib.getenv('CLIPBOARD_X_MOCK_MIME_TYPES')
  ?? 'text/plain;charset=utf-8,text/html,image/png,image/jpeg,image/webp')
  .split(',').map(value => value.trim()).filter(Boolean);
const MAX_ITEM_BYTES = parseLimit(GLib.getenv('CLIPBOARD_X_MOCK_MAX_ITEM_BYTES'), 128 * 1024 * 1024);
const MAX_PREVIEW_BYTES = parseLimit(GLib.getenv('CLIPBOARD_X_MOCK_MAX_PREVIEW_BYTES'), 512 * 1024);
const TRANSFER_STATES = (GLib.getenv('CLIPBOARD_X_MOCK_TRANSFER_SEQUENCE') ?? 'ready')
  .split(',').map(value => value.trim()).filter(value => ['ready', 'expired', 'failed'].includes(value));
const TRANSFER_DELAY_MS = parseLimit(GLib.getenv('CLIPBOARD_X_MOCK_TRANSFER_DELAY_MS'), 60);
const MALFORMED_SIGNALS = GLib.getenv('CLIPBOARD_X_MOCK_MALFORMED') === '1';

const sourcePath = GLib.filename_from_uri(import.meta.url)[0];
const protocolPath = GLib.build_filenamev([
  GLib.path_get_dirname(sourcePath),
  '..',
  'protocol',
  'io.github.guleo.ClipboardX.Sync1.xml',
]);
const [ok, xmlBytes] = Gio.File.new_for_path(protocolPath).load_contents(null);
if (!ok)
  throw new Error('Unable to load Sync1 protocol XML');
const nodeInfo = Gio.DBusNodeInfo.new_for_xml(new TextDecoder().decode(xmlBytes));
const interfaceInfo = nodeInfo.interfaces[0];

const devices = new Map();
const items = new Map();
const transfers = new Map();
let connection = null;
let registrationId = 0;
let transferRequestCount = 0;

function parseLimit(value, fallback) {
  if (value === null || value === '')
    return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function emptyReply(invocation) {
  invocation.return_value(new GLib.Variant('()', []));
}

function metadataString(dictionary, key, fallback = '') {
  const value = dictionary[key];
  return value instanceof GLib.Variant ? value.get_string()[0] : value ?? fallback;
}

function bytesFromFd(fdList, index) {
  const fd = fdList.get(index);
  const stream = new GioUnix.InputStream({fd, close_fd: true});
  const chunks = [];
  let size = 0;
  while (true) {
    const bytes = stream.read_bytes(64 * 1024, null);
    if (bytes.get_size() === 0)
      break;
    chunks.push(bytes.get_data());
    size += bytes.get_size();
  }
  stream.close(null);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new GLib.Bytes(output);
}

function receivePayloads(payloads, fdList) {
  return payloads.map(([mimeType, metadata, fdIndex]) => ({
    mimeType,
    metadata,
    bytes: bytesFromFd(fdList, fdIndex),
  }));
}

function payloadReply(payloads) {
  const fdList = new Gio.UnixFDList();
  const streams = [];
  const values = [];
  for (const payload of payloads) {
    const [file, ioStream] = Gio.File.new_tmp('clipboard-x-mock-XXXXXX');
    ioStream.get_output_stream().write_all(payload.bytes.get_data(), null);
    ioStream.close(null);
    const input = file.read(null);
    streams.push(input);
    const index = fdList.append(input.get_fd());
    values.push([payload.mimeType, payload.metadata, index]);
    file.delete(null);
  }
  return {fdList, streams, values};
}

function handleMethod(_connection, _sender, _objectPath, _interfaceName, methodName, parameters, invocation) {
  try {
    const values = parameters.deepUnpack();
    if (methodName === 'RegisterDevice') {
      devices.set(values[0], values[1]);
      emptyReply(invocation);
      if (MALFORMED_SIGNALS) {
        connection.emit_signal(
          null,
          OBJECT_PATH,
          INTERFACE,
          'ItemAvailable',
          new GLib.Variant('(s)', ['../../invalid-preview-path']),
        );
      }
      return;
    }

    if (methodName === 'Publish') {
      const [deviceId, metadata, previewValues, contentValues] = values;
      const fdList = invocation.get_message().get_unix_fd_list();
      const itemId = metadataString(metadata, 'id', GLib.uuid_string_random());
      items.set(itemId, {
        deviceId,
        metadata,
        previews: receivePayloads(previewValues, fdList),
        contents: receivePayloads(contentValues, fdList),
      });
      invocation.return_value(new GLib.Variant('(s)', [itemId]));
      connection.emit_signal(null, OBJECT_PATH, INTERFACE, 'ItemAvailable', new GLib.Variant('(s)', [itemId]));
      return;
    }

    if (methodName === 'ListPending') {
      const pending = [...items.keys()];
      if (MALFORMED_SIGNALS)
        pending.push('not-a-uuid');
      invocation.return_value(new GLib.Variant('(as)', [pending]));
      return;
    }

    if (methodName === 'GetItem') {
      const item = items.get(values[1]);
      if (!item)
        throw new Error('Unknown item');
      const reply = payloadReply(item.previews);
      const metadata = {
        ...item.metadata,
        'origin-device-tag': new GLib.Variant('s', devices.get(item.deviceId) ?? ''),
      };
      invocation.return_value_with_unix_fd_list(
        new GLib.Variant('(a{sv}a(sa{sv}h))', [metadata, reply.values]),
        reply.fdList,
      );
      reply.streams.forEach(stream => stream.close(null));
      return;
    }

    if (methodName === 'RequestContent') {
      const transferId = GLib.uuid_string_random();
      const item = items.get(values[1]);
      const total = item?.contents
        .filter(payload => values[2].includes(metadataString(payload.metadata, 'content-id')))
        .reduce((sum, payload) => sum + payload.bytes.get_size(), 0) ?? 0;
      transfers.set(transferId, {itemId: values[1], contentIds: values[2], state: 'queued', total});
      const terminalState = TRANSFER_STATES[Math.min(transferRequestCount, TRANSFER_STATES.length - 1)] ?? 'ready';
      transferRequestCount++;
      invocation.return_value(new GLib.Variant('(s)', [transferId]));
      connection.emit_signal(
        null,
        OBJECT_PATH,
        INTERFACE,
        'TransferChanged',
        new GLib.Variant('(sstts)', [transferId, 'queued', 0, total, '']),
      );
      GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, Math.max(1, Math.floor(TRANSFER_DELAY_MS / 2)), () => {
        const transfer = transfers.get(transferId);
        if (!transfer)
          return;
        transfer.state = 'transferring';
        connection.emit_signal(null, OBJECT_PATH, INTERFACE, 'TransferChanged',
          new GLib.Variant('(sstts)', [transferId, 'transferring', Math.floor(total / 2), total, '']));
      });
      GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, Math.max(2, TRANSFER_DELAY_MS), () => {
        const transfer = transfers.get(transferId);
        if (!transfer)
          return;
        transfer.state = terminalState;
        connection.emit_signal(null, OBJECT_PATH, INTERFACE, 'TransferChanged',
          new GLib.Variant('(sstts)', [
            transferId,
            terminalState,
            terminalState === 'ready' ? total : 0,
            total,
            terminalState === 'ready' ? '' : `Mock transfer ${terminalState}`,
          ]));
      });
      return;
    }

    if (methodName === 'OpenContent') {
      const item = items.get(values[1]);
      const payload = item?.contents.find(candidate => metadataString(candidate.metadata, 'content-id') === values[2]);
      if (!payload)
        throw new Error('Unknown content');
      const reply = payloadReply([payload]);
      invocation.return_value_with_unix_fd_list(
        new GLib.Variant('(a{sv}h)', [payload.metadata, reply.values[0][2]]),
        reply.fdList,
      );
      reply.streams.forEach(stream => stream.close(null));
      return;
    }

    if (methodName === 'CancelTransfer') {
      const transferId = values[1];
      if (transfers.delete(transferId)) {
        connection.emit_signal(null, OBJECT_PATH, INTERFACE, 'TransferChanged',
          new GLib.Variant('(sstts)', [transferId, 'cancelled', 0, 0, 'Cancelled by client']));
      }
      emptyReply(invocation);
      return;
    }

    if (methodName === 'Acknowledge' || methodName === 'OpenPreferences') {
      emptyReply(invocation);
      return;
    }

    invocation.return_dbus_error(`${INTERFACE}.Error.Unsupported`, `Unsupported method: ${methodName}`);
  } catch (error) {
    invocation.return_dbus_error(`${INTERFACE}.Error.InvalidItem`, error.message);
  }
}

function getProperty(_connection, _sender, _path, _interface, propertyName) {
  const properties = {
    ApiVersion: new GLib.Variant('u', 1),
    ImplementationName: new GLib.Variant('s', 'Clipboard X Mock Service'),
    ImplementationVersion: new GLib.Variant('s', '0.1.0'),
    Status: new GLib.Variant('s', 'online'),
    SupportedMimeTypes: new GLib.Variant('as', SUPPORTED_MIME_TYPES),
    MaxItemBytes: new GLib.Variant('t', MAX_ITEM_BYTES),
    MaxPreviewBytes: new GLib.Variant('t', MAX_PREVIEW_BYTES),
  };
  return properties[propertyName] ?? null;
}

const loop = new GLib.MainLoop(null, false);
const ownerId = Gio.bus_own_name(
  Gio.BusType.SESSION,
  BUS_NAME,
  Gio.BusNameOwnerFlags.NONE,
  busConnection => {
    connection = busConnection;
    registrationId = connection.register_object(OBJECT_PATH, interfaceInfo, handleMethod, getProperty, null);
    print('READY');
  },
  null,
  () => {
    printerr('Unable to own mock service bus name');
    loop.quit();
  },
);

loop.run();

if (registrationId)
  connection.unregister_object(registrationId);
Gio.bus_unown_name(ownerId);
