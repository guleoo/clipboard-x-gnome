import {ABSOLUTE_ITEM_LIMIT_BYTES, MAX_ITEM_REPRESENTATIONS} from '../clipboard/constants.js';
import {isUuid} from '../common/uuid.js';
import {DEVICE_ICON_KINDS} from './device.js';
import {API_VERSION} from './http/routes.js';
import {TransferState} from './constants.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const TRANSFER_STATES = new Set(Object.values(TransferState));

export function status(rawValue) {
  const value = object(rawValue, 'status');
  const capabilities = object(value.capabilities ?? {}, 'capabilities');
  const apiVersion = integer(value.apiVersion, 0, Number.MAX_SAFE_INTEGER, 'API version');
  if (apiVersion !== API_VERSION)
    throw new Error(`Unsupported synchronization API version: ${apiVersion}`);
  const state = choice(value.state, ['online', 'degraded'], 'server state');
  return {
    apiVersion,
    implementationName: 'Clipboard X Server',
    implementationVersion: text(value.serverVersion ?? '', 128, 'server version'),
    status: state,
    supportedMimeTypes: mimeTypes(capabilities.supportedMimeTypes ?? []),
    maxItemBytes: integer(capabilities.maxItemBytes ?? 0, 0, ABSOLUTE_ITEM_LIMIT_BYTES, 'item limit'),
    maxPreviewBytes: integer(capabilities.maxPreviewBytes ?? 0, 0, 1024 * 1024, 'preview limit'),
    pendingItems: integer(value.pendingItems ?? 0, 0, Number.MAX_SAFE_INTEGER, 'pending count'),
    activeTransfers: integer(value.activeTransfers ?? 0, 0, Number.MAX_SAFE_INTEGER, 'transfer count'),
    lastSyncAt: integer(value.lastSyncAt ?? 0, 0, Number.MAX_SAFE_INTEGER, 'last synchronization time'),
    revision: integer(value.revision ?? 0, 0, Number.MAX_SAFE_INTEGER, 'server revision'),
  };
}

export function device(rawValue, expectedDeviceId = '') {
  const value = object(rawValue, 'device');
  const deviceId = value.id;
  if (!isUuid(deviceId) || (expectedDeviceId && deviceId !== expectedDeviceId))
    throw new Error('Synchronization server returned an invalid device ID');
  return {
    deviceId,
    tag: text(value.tag, 256, 'device tag', false),
    iconKind: choice(value.iconKind, DEVICE_ICON_KINDS, 'device icon'),
    state: choice(value.state ?? 'online', ['online', 'offline', 'unavailable'], 'device state'),
    lastSeenAt: integer(value.lastSeenAt ?? 0, 0, Number.MAX_SAFE_INTEGER, 'device timestamp'),
    isCurrent: true,
  };
}

export function channels(rawValue, activeChannelId = '') {
  const values = Array.isArray(rawValue) ? rawValue : object(rawValue, 'channels').channels;
  if (!Array.isArray(values) || values.length > 10_000)
    throw new Error('Synchronization server returned an invalid channel list');
  const ids = new Set();
  return values.map(rawChannel => {
    const value = object(rawChannel, 'channel');
    if (!isUuid(value.id) || ids.has(value.id))
      throw new Error('Synchronization server returned duplicate or invalid channels');
    ids.add(value.id);
    return {
      id: value.id,
      name: text(value.name, 256, 'channel name', false),
      active: value.id === activeChannelId,
    };
  });
}

export function changes(rawValue) {
  const value = object(rawValue, 'changes page');
  const values = value.changes;
  if (typeof value.cursor !== 'string' || value.cursor.length > 256
      || !Array.isArray(values) || values.length > 10_000
      || typeof value.hasMore !== 'boolean')
    throw new Error('Synchronization server returned an invalid changes page');
  return {
    nextCursor: value.cursor,
    hasMore: value.hasMore,
    changes: values.map(rawChange => {
      const change = object(rawChange, 'change');
      if (!isUuid(change.itemId))
        throw new Error('Synchronization server returned an invalid changed item');
      return {
        sequence: integer(change.sequence, 0, Number.MAX_SAFE_INTEGER, 'change sequence'),
        kind: choice(change.kind, ['upsert', 'remove'], 'change kind'),
        itemId: change.itemId,
        reason: text(change.reason ?? '', 256, 'change reason'),
      };
    }),
  };
}

export function item(rawValue, expectedItemId = '') {
  const value = object(rawValue, 'item');
  if (!isUuid(value.id) || (expectedItemId && value.id !== expectedItemId))
    throw new Error('Synchronization server returned an invalid item ID');
  const origin = object(value.origin, 'item origin');
  if (!isUuid(origin.deviceId))
    throw new Error('Synchronization server returned an invalid origin device');
  const contents = array(value.contents, MAX_ITEM_REPRESENTATIONS, 'item contents')
    .map(representation);
  if (contents.length === 0)
    throw new Error('Synchronization item has no content representations');
  const contentIds = new Set();
  for (const content of contents) {
    if (contentIds.has(content.id))
      throw new Error('Synchronization item contains duplicate representations');
    contentIds.add(content.id);
  }
  const previews = array(value.previews ?? [], MAX_ITEM_REPRESENTATIONS, 'item previews')
    .map(rawPreview => preview(rawPreview, contentIds));
  return {
    id: value.id,
    createdAt: integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 'item timestamp'),
    originDeviceId: origin.deviceId,
    originDeviceTag: text(origin.tag ?? '', 256, 'origin device tag'),
    originDeviceIconKind: choice(origin.iconKind ?? 'other', DEVICE_ICON_KINDS, 'origin device icon'),
    contents,
    previews,
  };
}

export function publication(rawValue, expectedItemId = '') {
  const value = object(rawValue, 'publication');
  if (!isUuid(value.itemId) || (expectedItemId && value.itemId !== expectedItemId)
      || !isUuid(value.uploadId))
    throw new Error('Synchronization server returned an invalid upload session');
  return {
    itemId: value.itemId,
    uploadId: value.uploadId,
    previewIds: contentIds(value.previewIds ?? [], 'preview upload list'),
    contentIds: contentIds(value.contentIds ?? [], 'content upload list'),
    transfer: transfer(value.transfer),
  };
}

export function transfer(rawValue, expectedDeviceId = '') {
  const value = object(rawValue, 'transfer');
  if (!isUuid(value.id) || !isUuid(value.itemId) || !isUuid(value.deviceId)
      || (expectedDeviceId && value.deviceId !== expectedDeviceId))
    throw new Error('Synchronization server returned an invalid transfer identity');
  const completedBytes = integer(value.completedBytes, 0, Number.MAX_SAFE_INTEGER, 'completed bytes');
  const totalBytes = integer(value.totalBytes, 0, Number.MAX_SAFE_INTEGER, 'total bytes');
  const state = choice(value.state, TRANSFER_STATES, 'transfer state');
  if (completedBytes > totalBytes || (state === 'completed' && completedBytes !== totalBytes))
    throw new Error('Synchronization server returned inconsistent transfer progress');
  const createdAt = integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 'transfer creation time');
  const updatedAt = integer(value.updatedAt, createdAt, Number.MAX_SAFE_INTEGER, 'transfer update time');
  return {
    transferId: value.id,
    itemId: value.itemId,
    deviceId: value.deviceId,
    kind: choice(value.kind, ['publish', 'content'], 'transfer kind'),
    direction: choice(value.direction, ['upload', 'download'], 'transfer direction'),
    state,
    completedBytes,
    totalBytes,
    peerDeviceIds: contentIds(value.peerDeviceIds ?? [], 'peer device list', true),
    createdAt,
    updatedAt,
    errorCode: text(value.error?.code ?? '', 128, 'transfer error code'),
    errorMessage: text(value.error?.message ?? '', 512, 'transfer error message'),
  };
}

export function transfers(rawValue, expectedDeviceId = '') {
  const values = Array.isArray(rawValue) ? rawValue : object(rawValue, 'transfers').transfers;
  return array(values, 1024, 'transfers').map(value => transfer(value, expectedDeviceId));
}

export function contentRequest(rawValue, expectedDeviceId = '') {
  const value = object(rawValue, 'content request');
  return {transfer: transfer(value.transfer, expectedDeviceId)};
}

export function workPage(rawValue) {
  const value = object(rawValue, 'work page');
  if (typeof value.cursor !== 'string' || value.cursor.length > 256
      || typeof value.hasMore !== 'boolean')
    throw new Error('Synchronization server returned an invalid work cursor');
  return {
    cursor: value.cursor,
    hasMore: value.hasMore,
    work: array(value.work, 1000, 'work items').map(rawWork => {
      const work = object(rawWork, 'work item');
      if (!isUuid(work.id) || !isUuid(work.itemId) || !contentId(work.contentId))
        throw new Error('Synchronization server returned invalid source work');
      return {
        id: work.id,
        type: choice(work.type, ['materialize-content'], 'work type'),
        itemId: work.itemId,
        contentId: work.contentId,
      };
    }),
  };
}

export function acceptedWork(rawValue, expectedItemId, expectedDeviceId = '') {
  const value = object(rawValue, 'accepted work');
  if (!isUuid(value.uploadId))
    throw new Error('Synchronization server returned an invalid work upload ID');
  const result = transfer(value.transfer, expectedDeviceId);
  if (result.itemId !== expectedItemId)
    throw new Error('Synchronization server returned work for another item');
  return {uploadId: value.uploadId, transfer: result};
}

export function representation(rawValue) {
  const value = object(rawValue, 'representation');
  if (!contentId(value.id) || !mimeType(value.mimeType)
      || !SHA256_PATTERN.test(value.sha256 ?? ''))
    throw new Error('Synchronization server returned invalid content metadata');
  return {
    id: value.id,
    mimeType: value.mimeType,
    size: integer(value.size, 0, ABSOLUTE_ITEM_LIMIT_BYTES, 'content size'),
    sha256: value.sha256,
    delivery: choice(value.delivery, ['eager', 'on-demand'], 'content delivery'),
    availability: choice(
      value.availability ?? 'available',
      ['available', 'source-required', 'requesting', 'expired', 'failed'],
      'content availability',
    ),
  };
}

export function validateLocalRepresentation(value) {
  representation({...value, availability: value.availability ?? 'available'});
}

export function contentId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && !/[\r\n\0]/u.test(value);
}

export function mimeType(value) {
  return typeof value === 'string' && value.length <= 255
    && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[^\r\n]{1,128})?$/iu.test(value);
}

function preview(rawValue, knownContentIds) {
  const value = object(rawValue, 'preview');
  if (!contentId(value.id) || !knownContentIds.has(value.contentId)
      || !mimeType(value.mimeType) || !SHA256_PATTERN.test(value.sha256 ?? '')
      || typeof value.truncated !== 'boolean')
    throw new Error('Synchronization server returned invalid preview metadata');
  return {
    id: value.id,
    contentId: value.contentId,
    mimeType: value.mimeType,
    size: integer(value.size, 0, 1024 * 1024, 'preview size'),
    sha256: value.sha256,
    truncated: value.truncated,
  };
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Synchronization server returned invalid ${name}`);
  return value;
}

function array(value, maximumLength, name) {
  if (!Array.isArray(value) || value.length > maximumLength)
    throw new Error(`Synchronization server returned invalid ${name}`);
  return value;
}

function integer(value, minimum, maximum, name) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new Error(`Synchronization server returned invalid ${name}`);
  return result;
}

function text(value, maximumLength, name, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > maximumLength || /[\r\n\0]/u.test(value)
      || (!allowEmpty && !value))
    throw new Error(`Synchronization server returned invalid ${name}`);
  return value;
}

function choice(value, choices, name) {
  if (!choices.includes?.(value) && !choices.has?.(value))
    throw new Error(`Synchronization server returned invalid ${name}`);
  return value;
}

function contentIds(values, name, uuid = false) {
  if (!Array.isArray(values) || values.length > 10_000
      || !values.every(value => uuid ? isUuid(value) : contentId(value)))
    throw new Error(`Synchronization server returned invalid ${name}`);
  return [...new Set(values)];
}

function mimeTypes(values) {
  if (!Array.isArray(values) || values.length > 256 || !values.every(mimeType))
    throw new Error('Synchronization server returned invalid MIME capabilities');
  return [...new Set(values)];
}
