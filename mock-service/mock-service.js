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
const TRANSFER_STATES = (GLib.getenv('CLIPBOARD_X_MOCK_TRANSFER_SEQUENCE') ?? 'completed')
  .split(',').map(value => value.trim() === 'ready' ? 'completed' : value.trim())
  .filter(value => ['completed', 'expired', 'failed'].includes(value));
const TRANSFER_DELAY_MS = parseLimit(GLib.getenv('CLIPBOARD_X_MOCK_TRANSFER_DELAY_MS'), 60);
const MALFORMED_SIGNALS = GLib.getenv('CLIPBOARD_X_MOCK_MALFORMED') === '1';
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const DEFAULT_CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

const sourcePath = GLib.filename_from_uri(import.meta.url)[0];
const protocolPath = GLib.build_filenamev([
  GLib.path_get_dirname(sourcePath), '..', 'protocol', 'io.github.guleo.ClipboardX.Sync1.xml',
]);
const [ok, xmlBytes] = Gio.File.new_for_path(protocolPath).load_contents(null);
if (!ok)
  throw new Error('Unable to load Sync1 protocol XML');
const nodeInfo = Gio.DBusNodeInfo.new_for_xml(new TextDecoder().decode(xmlBytes));
const interfaceInfo = nodeInfo.interfaces[0];

const devices = new Map();
const sessions = new Map();
const items = new Map();
const transfers = new Map();
const changes = [];
let connection = null;
let registrationId = 0;
let transferRequestCount = 0;
let revision = 0;
let connectionConfiguration = {
  serverAddress: 'http://127.0.0.1:8765',
  apiKeyConfigured: false,
  activeChannelId: DEFAULT_CHANNEL_ID,
};
const channels = [{id: DEFAULT_CHANNEL_ID, name: 'Default'}];

function parseLimit(value, fallback) {
  if (value === null || value === '')
    return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function now() {
  return Date.now();
}

function variant(value) {
  if (value instanceof GLib.Variant)
    return value;
  if (typeof value === 'boolean')
    return new GLib.Variant('b', value);
  if (typeof value === 'number')
    return new GLib.Variant(Number.isInteger(value) && value >= 0 ? 't' : 'd', value);
  if (typeof value === 'string')
    return new GLib.Variant('s', value);
  if (Array.isArray(value))
    return new GLib.Variant('as', value);
  throw new TypeError(`Unsupported variant value: ${typeof value}`);
}

function dictionary(value) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, variant(entry)]));
}

function unpack(value) {
  return value instanceof GLib.Variant ? value.deepUnpack() : value;
}

function metadataString(value, key, fallback = '') {
  const entry = value[key];
  return entry === undefined ? fallback : String(unpack(entry));
}

function metadataNumber(value, key, fallback = 0) {
  const entry = value[key];
  return entry === undefined ? fallback : Number(unpack(entry));
}

function emptyReply(invocation) {
  invocation.return_value(new GLib.Variant('()', []));
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

function deviceRecord(deviceId, requesterId = '') {
  const profile = devices.get(deviceId) ?? {tag: '', iconKind: 'other'};
  return {
    'device-id': deviceId,
    tag: profile.tag,
    'icon-kind': profile.iconKind,
    state: 'online',
    'last-seen-at': profile.lastSeenAt ?? now(),
    'is-current': deviceId === requesterId,
  };
}

function statusRecord(deviceId) {
  return {
    state: 'online',
    'network-state': 'connected',
    'pending-items': changes.length,
    'active-transfers': [...transfers.values()].filter(transfer =>
      transfer.deviceId === deviceId && !TERMINAL_STATES.has(transfer.state)).length,
    'last-sync-at': revision > 0 ? now() : 0,
    revision,
  };
}

function configurationRecord() {
  const active = channels.find(channel => channel.id === connectionConfiguration.activeChannelId);
  return {
    'server-address': connectionConfiguration.serverAddress,
    'api-key-configured': connectionConfiguration.apiKeyConfigured,
    'active-channel-id': connectionConfiguration.activeChannelId,
    'active-channel-name': active?.name ?? '',
  };
}

function emitDictionarySignal(name, value) {
  connection.emit_signal(null, OBJECT_PATH, INTERFACE, name,
    new GLib.Variant('(a{sv})', [dictionary(value)]));
}

function transferRecord({
  transferId = GLib.uuid_string_random(),
  itemId,
  deviceId,
  kind,
  direction,
  state = 'queued',
  completedBytes = 0,
  totalBytes = 0,
  peerDeviceIds = [],
  createdAt = now(),
  updatedAt = createdAt,
  errorCode = '',
  errorMessage = '',
}) {
  return {
    transferId, itemId, deviceId, kind, direction, state,
    completedBytes, totalBytes, peerDeviceIds, createdAt, updatedAt,
    errorCode, errorMessage,
  };
}

function transferDictionary(transfer) {
  const value = {
    'transfer-id': transfer.transferId,
    'item-id': transfer.itemId,
    'device-id': transfer.deviceId,
    kind: transfer.kind,
    direction: transfer.direction,
    state: transfer.state,
    'completed-bytes': transfer.completedBytes,
    'total-bytes': transfer.totalBytes,
    'peer-device-ids': transfer.peerDeviceIds,
    'created-at': transfer.createdAt,
    'updated-at': transfer.updatedAt,
  };
  if (transfer.errorCode)
    value['error-code'] = transfer.errorCode;
  if (transfer.errorMessage)
    value['error-message'] = transfer.errorMessage;
  return value;
}

function emitTransfer(transfer, state, completedBytes, errorMessage = '') {
  if (TERMINAL_STATES.has(transfer.state))
    return;
  transfer.state = state;
  transfer.completedBytes = completedBytes;
  transfer.updatedAt = now();
  transfer.errorCode = errorMessage ? `mock-${state}` : '';
  transfer.errorMessage = errorMessage;
  emitDictionarySignal('TransferChanged', transferDictionary(transfer));
}

function scheduleTransfer(transfer, terminalState) {
  emitDictionarySignal('TransferChanged', transferDictionary(transfer));
  GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, Math.max(1, Math.floor(TRANSFER_DELAY_MS / 2)), () => {
    emitTransfer(transfer, 'transferring', Math.floor(transfer.totalBytes / 2));
  });
  GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, Math.max(2, TRANSFER_DELAY_MS), () => {
    const completed = terminalState === 'completed';
    emitTransfer(
      transfer,
      terminalState,
      completed ? transfer.totalBytes : transfer.completedBytes,
      completed ? '' : `Mock transfer ${terminalState}`,
    );
  });
}

function addChange(kind, itemId, reason = '') {
  revision++;
  const change = {sequence: revision, kind, itemId, reason};
  changes.push(change);
  connection.emit_signal(null, OBJECT_PATH, INTERFACE, 'ChangesAvailable',
    new GLib.Variant('(s)', [String(revision)]));
}

function handleMethod(_connection, sender, _objectPath, _interfaceName, methodName, parameters, invocation) {
  try {
    const values = parameters.deepUnpack();
    if (methodName === 'OpenSession') {
      const leaseMs = metadataNumber(values[1], 'lease-ms');
      if (leaseMs < 5000 || leaseMs > 300000)
        throw new Error('Invalid session lease');
      const sessionId = GLib.uuid_string_random();
      const session = {sender, leaseMs};
      sessions.set(sessionId, session);
      invocation.return_value(new GLib.Variant('(a{sv})', [dictionary({
        'session-id': sessionId,
        'lease-ms': leaseMs,
        'expires-at': now() + leaseMs,
      })]));
      return;
    }

    if (methodName === 'RenewSession') {
      const session = sessions.get(values[0]);
      if (!session || session.sender !== sender)
        throw new Error('Invalid session');
      print('SESSION_RENEWED');
      invocation.return_value(new GLib.Variant('(a{sv})', [dictionary({
        'session-id': values[0],
        'lease-ms': session.leaseMs,
        'expires-at': now() + session.leaseMs,
      })]));
      return;
    }

    if (methodName === 'CloseSession') {
      const session = sessions.get(values[0]);
      if (!session || session.sender !== sender)
        throw new Error('Invalid session');
      sessions.delete(values[0]);
      emptyReply(invocation);
      return;
    }

    if (methodName === 'GetStatus') {
      invocation.return_value(new GLib.Variant('(a{sv})', [dictionary(statusRecord(values[0]))]));
      return;
    }

    if (methodName === 'RegisterDevice') {
      const profile = values[1];
      devices.set(values[0], {
        tag: metadataString(profile, 'tag'),
        iconKind: metadataString(profile, 'icon-kind', 'other'),
        lastSeenAt: now(),
      });
      emptyReply(invocation);
      emitDictionarySignal('DeviceChanged', deviceRecord(values[0], values[0]));
      if (MALFORMED_SIGNALS)
        connection.emit_signal(null, OBJECT_PATH, INTERFACE, 'ChangesAvailable', new GLib.Variant('(s)', ['invalid cursor']));
      return;
    }

    if (methodName === 'ListDevices') {
      const result = [...devices.keys()].map(deviceId => dictionary(deviceRecord(deviceId, values[0])));
      invocation.return_value(new GLib.Variant('(aa{sv})', [result]));
      return;
    }

    if (methodName === 'GetConfiguration') {
      invocation.return_value(new GLib.Variant('(a{sv})', [dictionary(configurationRecord())]));
      return;
    }

    if (methodName === 'UpdateConfiguration') {
      const changes = values[1];
      const address = metadataString(changes, 'server-address');
      const channelId = metadataString(changes, 'active-channel-id');
      const apiKey = metadataString(changes, 'api-key');
      if (address)
        connectionConfiguration.serverAddress = address;
      if (channelId) {
        if (!channels.some(channel => channel.id === channelId))
          throw new Error('Unknown channel');
        connectionConfiguration.activeChannelId = channelId;
      }
      if (apiKey)
        connectionConfiguration.apiKeyConfigured = true;
      if (unpack(changes['clear-api-key'] ?? false))
        connectionConfiguration.apiKeyConfigured = false;
      const configuration = configurationRecord();
      invocation.return_value(new GLib.Variant('(a{sv})', [dictionary(configuration)]));
      emitDictionarySignal('ConfigurationChanged', configuration);
      return;
    }

    if (methodName === 'ListChannels') {
      const result = channels.map(channel => dictionary({
        ...channel,
        active: channel.id === connectionConfiguration.activeChannelId,
      }));
      invocation.return_value(new GLib.Variant('(aa{sv})', [result]));
      return;
    }

    if (methodName === 'TestConnection') {
      invocation.return_value(new GLib.Variant('(a{sv})', [dictionary({
        state: connectionConfiguration.apiKeyConfigured ? 'online' : 'offline',
        'latency-ms': 1,
        'server-version': '0.1.0-mock',
        message: connectionConfiguration.apiKeyConfigured ? 'Connected' : 'API key is not configured',
      })]));
      return;
    }

    if (methodName === 'Publish') {
      const [deviceId, metadata, previewValues, contentValues] = values;
      const fdList = invocation.get_message().get_unix_fd_list();
      const itemId = metadataString(metadata, 'id', GLib.uuid_string_random());
      const previews = receivePayloads(previewValues, fdList);
      const contents = receivePayloads(contentValues, fdList);
      items.set(itemId, {deviceId, metadata, previews, contents});
      const total = previews.reduce((sum, payload) => sum + payload.bytes.get_size(), 0)
        + contents.filter(payload => metadataString(payload.metadata, 'delivery') === 'eager')
          .reduce((sum, payload) => sum + payload.bytes.get_size(), 0);
      const transfer = transferRecord({
        itemId,
        deviceId,
        kind: 'publish',
        direction: 'upload',
        totalBytes: total,
        peerDeviceIds: [...devices.keys()].filter(candidate => candidate !== deviceId),
      });
      transfers.set(transfer.transferId, transfer);
      invocation.return_value(new GLib.Variant('(ss)', [itemId, transfer.transferId]));
      addChange('upsert', itemId);
      scheduleTransfer(transfer, 'completed');
      return;
    }

    if (methodName === 'GetChanges') {
      const cursor = Number.parseInt(values[1] || '0', 10);
      if (!Number.isSafeInteger(cursor) || cursor < 0)
        throw new Error('Invalid cursor');
      const limit = Math.max(1, Math.min(1000, metadataNumber(values[2], 'limit', 200)));
      const pending = changes.filter(change => change.sequence > cursor);
      if (MALFORMED_SIGNALS && pending.length === 0)
        pending.push({sequence: 1, kind: 'upsert', itemId: 'not-a-uuid', reason: ''});
      const page = pending.slice(0, limit);
      const nextCursor = page.length > 0 ? page.at(-1).sequence : cursor;
      const result = page.map(change => dictionary({
        sequence: change.sequence,
        kind: change.kind,
        'item-id': change.itemId,
        ...(change.reason ? {reason: change.reason} : {}),
      }));
      invocation.return_value(new GLib.Variant('(saa{sv}b)', [String(nextCursor), result, pending.length > page.length]));
      return;
    }

    if (methodName === 'GetItem') {
      const item = items.get(values[1]);
      if (!item)
        throw new Error('Unknown item');
      const reply = payloadReply(item.previews);
      const device = deviceRecord(item.deviceId);
      const metadata = {
        ...item.metadata,
        'origin-device-tag': new GLib.Variant('s', device.tag),
        'origin-device-icon-kind': new GLib.Variant('s', device['icon-kind']),
      };
      invocation.return_value_with_unix_fd_list(
        new GLib.Variant('(a{sv}a(sa{sv}h))', [metadata, reply.values]), reply.fdList);
      reply.streams.forEach(stream => stream.close(null));
      return;
    }

    if (methodName === 'RequestContent') {
      const [deviceId, itemId, contentIds] = values;
      const item = items.get(itemId);
      const total = item?.contents
        .filter(payload => contentIds.includes(metadataString(payload.metadata, 'content-id')))
        .reduce((sum, payload) => sum + payload.bytes.get_size(), 0) ?? 0;
      const transfer = transferRecord({
        itemId,
        deviceId,
        kind: 'content',
        direction: 'download',
        totalBytes: total,
        peerDeviceIds: item ? [item.deviceId] : [],
      });
      transfers.set(transfer.transferId, transfer);
      const terminalState = TRANSFER_STATES[Math.min(transferRequestCount, TRANSFER_STATES.length - 1)] ?? 'completed';
      transferRequestCount++;
      invocation.return_value(new GLib.Variant('(s)', [transfer.transferId]));
      scheduleTransfer(transfer, terminalState);
      return;
    }

    if (methodName === 'OpenContent') {
      const item = items.get(values[1]);
      const payload = item?.contents.find(candidate => metadataString(candidate.metadata, 'content-id') === values[2]);
      if (!payload)
        throw new Error('Unknown content');
      const reply = payloadReply([payload]);
      invocation.return_value_with_unix_fd_list(
        new GLib.Variant('(a{sv}h)', [payload.metadata, reply.values[0][2]]), reply.fdList);
      reply.streams.forEach(stream => stream.close(null));
      return;
    }

    if (methodName === 'CancelTransfer') {
      const transfer = transfers.get(values[1]);
      if (transfer && !TERMINAL_STATES.has(transfer.state))
        emitTransfer(transfer, 'cancelled', transfer.completedBytes, 'Cancelled by client');
      emptyReply(invocation);
      return;
    }

    if (methodName === 'GetTransfer') {
      const transfer = transfers.get(values[1]);
      if (!transfer || transfer.deviceId !== values[0])
        throw new Error('Unknown transfer');
      invocation.return_value(new GLib.Variant('(a{sv})', [dictionary(transferDictionary(transfer))]));
      return;
    }

    if (methodName === 'ListTransfers') {
      const state = metadataString(values[1], 'state');
      const result = [...transfers.values()]
        .filter(transfer => transfer.deviceId === values[0] && (!state || transfer.state === state))
        .map(transfer => dictionary(transferDictionary(transfer)));
      invocation.return_value(new GLib.Variant('(aa{sv})', [result]));
      return;
    }

    if (methodName === 'Acknowledge') {
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
    ImplementationVersion: new GLib.Variant('s', '0.2.0'),
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
