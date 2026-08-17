import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

import {UUID} from '../entry/constants.js';
import {ClipboardItem} from '../clipboard/item.js';
import {
  ABSOLUTE_ITEM_LIMIT_BYTES,
  ABSOLUTE_PREVIEW_LIMIT_BYTES,
  MAX_ITEM_REPRESENTATIONS,
} from '../clipboard/constants.js';
import {sha256, stringFromBytes, truncateUtf8} from '../common/bytes.js';
import {variantDictionary} from '../common/dbus.js';
import {EventEmitter} from '../common/event-emitter.js';
import {writeFile} from '../common/files.js';
import {isUuid} from '../common/uuid.js';
import {DEVICE_ICON_KINDS, ensureDeviceIdentity} from './device.js';
import {
  SYNC_API_VERSION,
  SYNC_INTERFACE,
  TransferState,
} from './constants.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const TRANSFER_STATES = new Set(Object.values(TransferState));
const MAX_PENDING_ITEMS = 10_000;
const MAX_TRANSFER_STATES = 1024;

export class SyncClient extends EventEmitter {
  constructor(settings) {
    super();
    this._settings = settings;
    this._proxy = null;
    this._proxySignal = 0;
    this._nameWatchId = 0;
    this._settingsSignals = [];
    this._cancellable = new Gio.Cancellable();
    this._registeredProfile = null;
    this._transferWaiters = new Map();
    this._transferStates = new Map();
    this._knownTransfers = new Set();
    this._devices = new Map();
    this._status = null;
    this._cursor = '';
    this._syncingChanges = false;
    this._capabilities = null;
    this._connecting = false;
    this._connectIdleId = 0;
    this._generation = 0;
    this._destroyed = false;
  }

  get connected() {
    return Boolean(this._proxy?.get_name_owner());
  }

  get capabilities() {
    return this._capabilities ? {...this._capabilities} : null;
  }

  get devices() {
    return [...this._devices.values()].map(device => ({...device}));
  }

  get status() {
    return this._status ? {...this._status} : null;
  }

  getTransferForItem(itemId) {
    const transfers = [...this._transferStates.values()]
      .filter(transfer => transfer.itemId === itemId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return transfers[0] ? {...transfers[0]} : null;
  }

  async start() {
    this._settingsSignals.push(
      this._settings.connect('changed::device-tag', () => this._registerDevice().catch(error => this._report(error))),
      this._settings.connect('changed::device-icon-kind', () => this._registerDevice().catch(error => this._report(error))),
      this._settings.connect('changed::service-bus-name', () => this.restart().catch(error => this._report(error))),
      this._settings.connect('changed::service-object-path', () => this.restart().catch(error => this._report(error))),
    );
    await this._connect();
  }

  async restart() {
    if (this._destroyed)
      return;
    this._generation++;
    this._cursor = '';
    this._stopWatchingName();
    this._disconnectProxy();
    if (this._settings.get_boolean('sync-enabled'))
      await this._connect();
  }

  async publish(item) {
    if (!this.connected)
      throw new Error('Synchronization service is unavailable');
    if (!isUuid(item.id))
      throw new Error('Item ID must be a UUID v4');

    const {deviceId} = ensureDeviceIdentity(this._settings);
    const representations = item.representations.filter(representation => this._canPublish(representation.mimeType));
    if (representations.length === 0)
      throw new Error('The synchronization policy or Service capabilities reject all representations');
    if (representations.length > MAX_ITEM_REPRESENTATIONS)
      throw new Error(`Item has more than ${MAX_ITEM_REPRESENTATIONS} representations`);
    for (const representation of representations)
      validateRepresentation(representation);
    const totalBytes = representations.reduce((sum, representation) => sum + representation.size, 0);
    if (totalBytes > ABSOLUTE_ITEM_LIMIT_BYTES)
      throw new Error(`Item exceeds the local limit of ${ABSOLUTE_ITEM_LIMIT_BYTES} bytes`);
    if (this._capabilities.maxItemBytes > 0 && totalBytes > this._capabilities.maxItemBytes)
      throw new Error(`Item exceeds the Service limit of ${this._capabilities.maxItemBytes} bytes`);
    const fdList = new Gio.UnixFDList();
    const streams = [];
    const temporaryFiles = [];

    try {
      const previews = [];
      if (item.preview?.text) {
        const previewLimit = this._effectivePreviewLimit(false);
        const textPreview = truncateUtf8(item.preview.text, previewLimit);
        const [temporaryFile, temporaryStream] = Gio.File.new_tmp('clipboard-x-preview-XXXXXX');
        temporaryStream.close(null);
        const path = temporaryFile.get_path();
        await writeFile(
          temporaryFile,
          new GLib.Bytes(new TextEncoder().encode(textPreview.text)),
          this._cancellable,
        );
        temporaryFiles.push(path);
        previews.push(this._openPayload(
          fdList,
          streams,
          item.preview.mimeType,
          {
            'content-id': item.preview.derivedFrom,
            size: new TextEncoder().encode(textPreview.text).length,
            truncated: item.preview.truncated || textPreview.truncated,
          },
          path,
        ));
      } else if (item.preview?.path && item.preview.size <= this._effectivePreviewLimit(true)) {
        previews.push(this._openPayload(
          fdList,
          streams,
          item.preview.mimeType,
          {
            'content-id': item.preview.derivedFrom,
            size: item.preview.size,
            truncated: true,
          },
          item.preview.path,
        ));
      }

      const contents = [];
      for (const representation of representations) {
        if (!representation.path)
          throw new Error('Snapshot must be persisted before publication');
        contents.push(this._openPayload(
          fdList,
          streams,
          representation.mimeType,
          {
            'content-id': representation.id,
            size: representation.size,
            sha256: representation.sha256,
            delivery: representation.delivery,
          },
          representation.path,
        ));
      }

      const metadata = variantDictionary({
        id: item.id,
        'created-at': item.createdAt,
        'origin-device-id': deviceId,
      });
      metadata.contents = new GLib.Variant(
        'aa{sv}',
        representations.map(representation => variantDictionary({
          'content-id': representation.id,
          'mime-type': representation.mimeType,
          size: representation.size,
          sha256: representation.sha256,
          delivery: representation.delivery,
        })),
      );
      const parameters = new GLib.Variant('(sa{sv}a(sa{sv}h)a(sa{sv}h)a{sv})', [
        deviceId,
        metadata,
        previews,
        contents,
        variantDictionary({}),
      ]);

      const [reply] = await this._callWithFds('Publish', parameters, fdList);
      const [publishedId, transferId] = reply.deepUnpack();
      if (publishedId !== item.id)
        throw new Error('Synchronization Service did not preserve the published item ID');
      if (!isUuid(transferId))
        throw new Error('Synchronization Service returned an invalid publication transfer ID');
      this._knownTransfers.add(transferId);
      const current = this._transferStates.get(transferId);
      if (current)
        this.emit('transfer-changed', {...current});
      return {itemId: publishedId, transferId};
    } finally {
      for (const stream of streams)
        stream.close(null);
      for (const path of temporaryFiles) {
        try {
          Gio.File.new_for_path(path).delete(null);
        } catch (_error) {
          // The temporary preview has already been consumed or removed.
        }
      }
    }
  }

  async getChanges(cursor = this._cursor, options = {}) {
    if (!this.connected)
      return {nextCursor: cursor, changes: [], hasMore: false};
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call('GetChanges', new GLib.Variant('(ssa{sv})', [
      deviceId,
      cursor,
      variantDictionary(options),
    ]));
    const [nextCursor, rawChanges, hasMore] = reply.deepUnpack();
    if (typeof nextCursor !== 'string' || nextCursor.length > 256
        || !Array.isArray(rawChanges) || rawChanges.length > MAX_PENDING_ITEMS
        || typeof hasMore !== 'boolean')
      throw new Error('Synchronization Service returned an invalid changes page');
    const changes = rawChanges.map(validateChange);
    return {nextCursor, changes, hasMore};
  }

  async requestContent(itemId, contentIds) {
    validateItemId(itemId);
    if (!Array.isArray(contentIds)
        || contentIds.length === 0
        || contentIds.length > MAX_ITEM_REPRESENTATIONS
        || !contentIds.every(isContentId))
      throw new Error('Synchronization content request is invalid');
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call(
      'RequestContent',
      new GLib.Variant('(ssasa{sv})', [
        deviceId,
        itemId,
        [...new Set(contentIds)],
        variantDictionary({}),
      ]),
    );
    const transferId = reply.deepUnpack()[0];
    if (!isUuid(transferId))
      throw new Error('Synchronization Service returned an invalid transfer ID');
    this._knownTransfers.add(transferId);
    const current = this._transferStates.get(transferId);
    if (current)
      this.emit('transfer-changed', {...current});
    return transferId;
  }

  async getItem(itemId) {
    validateItemId(itemId);
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const [reply, fdList] = await this._callWithFds(
      'GetItem',
      new GLib.Variant('(ss)', [deviceId, itemId]),
      null,
    );
    const [rawMetadata, rawPreviews] = reply.deepUnpack();
    const metadata = unpackDictionary(rawMetadata);
    const contentValues = metadata.contents ?? [];
    if (!isUuid(metadata.id ?? itemId) || metadata.id !== itemId || !isUuid(metadata['origin-device-id'] ?? ''))
      throw new Error('Synchronization Service returned an invalid item or DeviceId');
    if (!Array.isArray(contentValues)
        || contentValues.length === 0
        || contentValues.length > MAX_ITEM_REPRESENTATIONS)
      throw new Error('Synchronization Service returned an invalid representation count');
    const contentIds = new Set();
    const representations = contentValues.map(rawContent => {
      const content = unpackDictionary(rawContent);
      const representation = {
        id: content['content-id'],
        mimeType: content['mime-type'],
        size: Number(content.size),
        sha256: content.sha256,
        delivery: content.delivery,
        bytes: null,
        path: null,
      };
      validateRepresentation(representation);
      if (contentIds.has(representation.id))
        throw new Error('Synchronization Service returned duplicate content IDs');
      contentIds.add(representation.id);
      return representation;
    });
    const declaredBytes = representations.reduce((sum, representation) => sum + representation.size, 0);
    const itemLimit = effectiveLimit(this._capabilities?.maxItemBytes, ABSOLUTE_ITEM_LIMIT_BYTES);
    if (declaredBytes > itemLimit)
      throw new Error(`Synchronization item exceeds the effective limit of ${itemLimit} bytes`);
    const createdAt = Number(metadata['created-at']);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0)
      throw new Error('Synchronization Service returned an invalid timestamp');
    const originDeviceIconKind = safeString(metadata['origin-device-icon-kind'] ?? 'other', 32);
    if (!DEVICE_ICON_KINDS.includes(originDeviceIconKind))
      throw new Error('Synchronization Service returned an invalid device icon kind');

    let preview = null;
    if (!Array.isArray(rawPreviews) || rawPreviews.length > MAX_ITEM_REPRESENTATIONS)
      throw new Error('Synchronization Service returned an invalid preview count');
    if (rawPreviews.length > 0) {
      const validatedPreviews = rawPreviews.map(rawPreview => {
        if (!Array.isArray(rawPreview) || rawPreview.length !== 3)
          throw new Error('Synchronization Service returned invalid preview metadata');
        const [mimeType, rawPreviewMetadata, fdIndex] = rawPreview;
        const previewMetadata = unpackDictionary(rawPreviewMetadata);
        if (!isMimeType(mimeType)
            || !Number.isInteger(fdIndex)
            || !isContentId(previewMetadata['content-id'])
            || !representations.some(representation => representation.id === previewMetadata['content-id'])
            || !Number.isSafeInteger(Number(previewMetadata.size))
            || Number(previewMetadata.size) < 0
            || !fdList
            || fdIndex < 0
            || fdIndex >= fdList.get_length()
            || typeof previewMetadata.truncated !== 'boolean')
          throw new Error('Synchronization Service returned invalid preview metadata');
        return {mimeType, previewMetadata, fdIndex};
      });
      const selected = validatedPreviews.find(candidate => candidate.previewMetadata['content-id'] === representations[0].id)
        ?? validatedPreviews[0];
      const {mimeType, previewMetadata, fdIndex} = selected;
      const bytes = await readFdListBytes(
        fdList,
        fdIndex,
        this._cancellable,
        effectiveLimit(this._capabilities?.maxPreviewBytes, ABSOLUTE_PREVIEW_LIMIT_BYTES),
      );
      if (Number(previewMetadata.size ?? bytes.get_size()) !== bytes.get_size())
        throw new Error('Synchronization preview size does not match its metadata');
      if (mimeType.startsWith('text/')) {
        preview = {
          mimeType,
          text: stringFromBytes(bytes),
          truncated: Boolean(previewMetadata.truncated),
          derivedFrom: previewMetadata['content-id'],
        };
      } else {
        const previewRoot = GLib.build_filenamev([GLib.get_user_cache_dir(), UUID, 'remote-previews']);
        GLib.mkdir_with_parents(previewRoot, 0o700);
        const previewHash = sha256(bytes);
        const path = GLib.build_filenamev([previewRoot, `${metadata.id}-${previewHash}.preview`]);
        await writeFile(Gio.File.new_for_path(path), bytes, this._cancellable);
        preview = {
          mimeType,
          path,
          size: bytes.get_size(),
          sha256: previewHash,
          truncated: true,
          derivedFrom: previewMetadata['content-id'],
        };
      }
    }

    return new ClipboardItem({
      id: metadata.id ?? itemId,
      createdAt,
      originDeviceId: metadata['origin-device-id'] ?? '',
      originDeviceTag: safeString(metadata['origin-device-tag'] ?? '', 256),
      originDeviceIconKind,
      representations,
      preview,
      favorite: false,
      remote: true,
      availability: 'preview',
    });
  }

  async materialize(item) {
    if (!item.remote || item.representations.every(representation => representation.bytes))
      return item;

    item.availability = 'waiting-for-peer';
    try {
      const contentIds = item.representations.map(representation => representation.id);
      const transferId = await this.requestContent(item.id, contentIds);
      await this._waitForTransfer(transferId);
      for (const representation of item.representations) {
        const {metadata, bytes} = await this.openContent(item.id, representation.id);
        const actualSize = bytes.get_size();
        const actualHash = sha256(bytes);
        if (actualSize !== representation.size || actualSize !== Number(metadata.size))
          throw new Error(`Synchronization size mismatch for ${representation.id}`);
        if (actualHash !== representation.sha256 || actualHash !== metadata.sha256)
          throw new Error(`Synchronization hash mismatch for ${representation.id}`);
        representation.bytes = bytes;
      }
      item.availability = 'ready';
    } catch (error) {
      item.availability = 'failed';
      throw error;
    }
    return item;
  }

  async openContent(itemId, contentId) {
    validateItemId(itemId);
    if (!isContentId(contentId))
      throw new Error('Synchronization content ID is invalid');
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const [reply, fdList] = await this._callWithFds(
      'OpenContent',
      new GLib.Variant('(sss)', [deviceId, itemId, contentId]),
      null,
    );
    const [rawMetadata, fdIndex] = reply.deepUnpack();
    const metadata = unpackDictionary(rawMetadata);
    if (metadata['content-id'] !== contentId
        || !Number.isSafeInteger(Number(metadata.size))
        || Number(metadata.size) < 0
        || !SHA256_PATTERN.test(metadata.sha256 ?? '')
        || !['eager', 'on-demand'].includes(metadata.delivery))
      throw new Error('Synchronization Service returned invalid content metadata');
    return {
      metadata,
      bytes: await readFdListBytes(
        fdList,
        fdIndex,
        this._cancellable,
        effectiveLimit(this._capabilities?.maxItemBytes, ABSOLUTE_ITEM_LIMIT_BYTES),
      ),
    };
  }

  async acknowledge(itemId, result, message = '') {
    validateItemId(itemId);
    if (typeof result !== 'string' || result.length === 0 || result.length > 64
        || typeof message !== 'string' || message.length > 512)
      throw new Error('Synchronization acknowledgement is invalid');
    const {deviceId} = ensureDeviceIdentity(this._settings);
    await this._call(
      'Acknowledge',
      new GLib.Variant('(ssss)', [deviceId, itemId, result, message]),
    );
  }

  async cancelTransfer(transferId) {
    if (!isUuid(transferId))
      throw new Error('Synchronization transfer ID is invalid');
    const {deviceId} = ensureDeviceIdentity(this._settings);
    await this._call('CancelTransfer', new GLib.Variant('(ss)', [deviceId, transferId]));
  }

  async getTransfer(transferId) {
    if (!isUuid(transferId))
      throw new Error('Synchronization transfer ID is invalid');
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call('GetTransfer', new GLib.Variant('(ss)', [deviceId, transferId]));
    return validateTransfer(reply.deepUnpack()[0], deviceId);
  }

  async listTransfers(filter = {}) {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call('ListTransfers', new GLib.Variant('(sa{sv})', [
      deviceId,
      variantDictionary(filter),
    ]));
    const values = reply.deepUnpack()[0];
    if (!Array.isArray(values) || values.length > MAX_TRANSFER_STATES)
      throw new Error('Synchronization Service returned an invalid transfer list');
    return values.map(value => validateTransfer(value, deviceId));
  }

  async openPreferences() {
    await this._call('OpenPreferences', null);
  }

  _openPayload(fdList, streams, mimeType, metadata, path) {
    const stream = Gio.File.new_for_path(path).read(this._cancellable);
    streams.push(stream);
    const fdIndex = fdList.append(stream.get_fd());
    return [mimeType, variantDictionary(metadata), fdIndex];
  }

  async _connect() {
    if (this._destroyed || !this._settings.get_boolean('sync-enabled'))
      return;

    const generation = ++this._generation;
    const busName = this._settings.get_string('service-bus-name');
    const objectPath = this._settings.get_string('service-object-path');
    if (!Gio.dbus_is_name(busName))
      throw new Error('The configured synchronization Service bus name is invalid');
    if (!GLib.Variant.is_object_path(objectPath))
      throw new Error('The configured synchronization Service object path is invalid');
    this._nameWatchId = Gio.bus_watch_name(
      Gio.BusType.SESSION,
      busName,
      Gio.BusNameWatcherFlags.NONE,
      () => {
        if (!this._destroyed && generation === this._generation
            && !this._capabilities && !this._connecting) {
          if (this._connectIdleId)
            return;
          this._connectIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._connectIdleId = 0;
            if (!this._destroyed && generation === this._generation)
              this._createProxy(busName, generation).catch(error => this._report(error));
            return GLib.SOURCE_REMOVE;
          });
        }
      },
      () => {
        if (!this._destroyed && generation === this._generation)
          this._handleServiceVanished();
      },
    );
    this._requestActivation(busName);
  }

  async _createProxy(destination = this._settings.get_string('service-bus-name'), generation = this._generation) {
    if (this._destroyed || generation !== this._generation)
      return;
    this._connecting = true;
    this._disconnectProxy();

    try {
      this._proxy = Gio.DBusProxy.new_sync(
        Gio.DBus.session,
        Gio.DBusProxyFlags.DO_NOT_AUTO_START | Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
        null,
        destination,
        this._settings.get_string('service-object-path'),
        SYNC_INTERFACE,
        this._cancellable,
      );
      if (this._destroyed || generation !== this._generation) {
        this._disconnectProxy();
        return;
      }

      this._proxySignal = this._proxy.connect('g-signal', (_proxy, _sender, name, parameters) => {
        const values = parameters.deepUnpack();
        if (name === 'StatusChanged')
          this._handleStatusChanged(values[0]);
        else if (name === 'DeviceChanged')
          this._handleDeviceChanged(values[0]);
        else if (name === 'DeviceRemoved')
          this._handleDeviceRemoved(...values);
        else if (name === 'ChangesAvailable') {
          if (typeof values[0] !== 'string' || values[0].length > 256 || /[\r\n\0]/u.test(values[0]))
            this._report(new Error('Service emitted an invalid changes cursor'));
          else
            this._syncChanges().catch(error => this._report(error));
        }
        else if (name === 'TransferChanged')
          this._handleTransferChanged(values[0]);
      });
      await this._handleNameOwnerChanged(true);
    } finally {
      if (generation === this._generation)
        this._connecting = false;
    }
  }

  _requestActivation(busName) {
    Gio.DBus.session.call(
      'org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus',
      'StartServiceByName',
      new GLib.Variant('(su)', [busName, 0]),
      null,
      Gio.DBusCallFlags.NONE,
      2000,
      this._cancellable,
      (connection, result) => {
        try {
          connection.call_finish(result);
        } catch (error) {
          if (!error.matches?.(Gio.DBusError, Gio.DBusError.SERVICE_UNKNOWN))
            this._report(error);
        }
      },
    );
  }

  _handleServiceVanished() {
    if (!this._proxy && !this._capabilities)
      return;
    this._disconnectProxy();
    this._rejectTransfers(new Error('Synchronization service went offline'));
    this.emit('status-changed', 'offline', null);
  }

  async _handleNameOwnerChanged(nameKnownPresent = false) {
    if (!nameKnownPresent && !this.connected) {
      this._registeredProfile = null;
      this._capabilities = null;
      this._status = null;
      this._rejectTransfers(new Error('Synchronization service went offline'));
      this.emit('status-changed', 'offline', null);
      return;
    }

    try {
      this._capabilities = await this._loadCapabilities();
      if (this._capabilities.apiVersion !== SYNC_API_VERSION)
        throw new Error(`Unsupported synchronization API version: ${this._capabilities.apiVersion}`);
      this._registeredProfile = null;
      await this._registerDevice(nameKnownPresent);
      await Promise.all([
        this._loadStatus(),
        this._loadDevices(),
        this._loadTransfers(),
      ]);
      await this._syncChanges();
      this.emit('status-changed', this._status?.state ?? this._capabilities.status ?? 'online', this.capabilities);
    } catch (error) {
      this._capabilities = null;
      this.emit('status-changed', 'error', {error: error.message});
      throw error;
    }
  }

  async _loadCapabilities() {
    const reply = await new Promise((resolve, reject) => {
      Gio.DBus.session.call(
        this._proxy.get_name_owner() || this._settings.get_string('service-bus-name'),
        this._settings.get_string('service-object-path'),
        'org.freedesktop.DBus.Properties',
        'GetAll',
        new GLib.Variant('(s)', [SYNC_INTERFACE]),
        new GLib.VariantType('(a{sv})'),
        Gio.DBusCallFlags.NONE,
        5000,
        this._cancellable,
        (connection, result) => {
          try {
            resolve(connection.call_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
    const properties = unpackDictionary(reply.deepUnpack()[0]);
    const read = (name, fallback) => properties[name] ?? fallback;
    return {
      apiVersion: Number(read('ApiVersion', 0)),
      implementationName: safeString(read('ImplementationName', ''), 256),
      implementationVersion: safeString(read('ImplementationVersion', ''), 128),
      status: safeString(read('Status', 'online'), 64),
      supportedMimeTypes: validateMimeTypes(read('SupportedMimeTypes', [])),
      maxItemBytes: safeLimit(read('MaxItemBytes', 0)),
      maxPreviewBytes: safeLimit(read('MaxPreviewBytes', 0)),
    };
  }

  async _loadStatus() {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call('GetStatus', new GLib.Variant('(s)', [deviceId]));
    this._status = validateStatus(reply.deepUnpack()[0]);
    this.emit('status-details-changed', {...this._status});
    return this._status;
  }

  async _loadDevices() {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call('ListDevices', new GLib.Variant('(s)', [deviceId]));
    const values = reply.deepUnpack()[0];
    if (!Array.isArray(values) || values.length > 10_000)
      throw new Error('Synchronization Service returned an invalid device list');
    this._devices.clear();
    for (const value of values) {
      const device = validateDevice(value);
      this._devices.set(device.deviceId, device);
    }
    this.emit('devices-changed', this.devices);
    return this.devices;
  }

  async _loadTransfers() {
    const values = await this.listTransfers();
    for (const transfer of values) {
      this._transferStates.set(transfer.transferId, transfer);
      this.emit('transfer-changed', {...transfer});
    }
    this.emit('transfers-restored', values.map(transfer => ({...transfer})));
    return values;
  }

  async _syncChanges() {
    if (this._syncingChanges || !this.connected)
      return;
    this._syncingChanges = true;
    try {
      let hasMore;
      do {
        const page = await this.getChanges(this._cursor, {limit: 200});
        for (const change of page.changes) {
          if (change.kind === 'upsert')
            this.emit('item-available', change.itemId);
          else
            this.emit('item-removed', change.itemId, change.reason);
        }
        if (page.nextCursor === this._cursor && page.hasMore)
          throw new Error('Synchronization Service returned a non-advancing changes cursor');
        this._cursor = page.nextCursor;
        hasMore = page.hasMore;
      } while (hasMore);
    } finally {
      this._syncingChanges = false;
    }
  }

  _handleStatusChanged(rawStatus) {
    try {
      this._status = validateStatus(rawStatus);
      this.emit('status-details-changed', {...this._status});
      this.emit('status-changed', this._status.state, this.capabilities);
    } catch (error) {
      this._report(error);
    }
  }

  _handleDeviceChanged(rawDevice) {
    try {
      const device = validateDevice(rawDevice);
      this._devices.set(device.deviceId, device);
      this.emit('devices-changed', this.devices);
    } catch (error) {
      this._report(error);
    }
  }

  _handleDeviceRemoved(deviceId, reason) {
    if (!isUuid(deviceId) || typeof reason !== 'string') {
      this._report(new Error('Service emitted invalid device removal metadata'));
      return;
    }
    this._devices.delete(deviceId);
    this.emit('device-removed', deviceId, safeString(reason, 256));
    this.emit('devices-changed', this.devices);
  }

  _canPublish(mimeType) {
    if (mimeType === 'text/html' && !this._settings.get_boolean('sync-html'))
      return false;
    if (mimeType.startsWith('text/') && mimeType !== 'text/html' && !this._settings.get_boolean('sync-text'))
      return false;
    if (mimeType.startsWith('image/') && !this._settings.get_boolean('sync-images'))
      return false;
    return this._capabilities.supportedMimeTypes.length === 0
      || this._capabilities.supportedMimeTypes.includes(mimeType);
  }

  _effectivePreviewLimit(image) {
    const serviceLimit = this._capabilities?.maxPreviewBytes ?? 0;
    const configuredLimit = this._settings.get_uint(image ? 'thumbnail-byte-limit' : 'text-preview-limit');
    return effectiveLimit(serviceLimit, Math.min(configuredLimit, ABSOLUTE_PREVIEW_LIMIT_BYTES));
  }

  async _registerDevice(nameKnownPresent = false) {
    if (!nameKnownPresent && !this.connected)
      return;
    const {deviceId, deviceTag, deviceIconKind} = ensureDeviceIdentity(this._settings);
    const serialized = `${deviceTag}\0${deviceIconKind}`;
    if (serialized === this._registeredProfile)
      return;
    await this._call('RegisterDevice', new GLib.Variant('(sa{sv})', [
      deviceId,
      variantDictionary({tag: deviceTag, 'icon-kind': deviceIconKind}),
    ]));
    this._registeredProfile = serialized;
  }

  _call(method, parameters) {
    if (!this._proxy)
      return Promise.reject(new Error('Synchronization Service proxy is unavailable'));
    return new Promise((resolve, reject) => {
      this._proxy.call(
        method,
        parameters,
        Gio.DBusCallFlags.NONE,
        5000,
        this._cancellable,
        (proxy, result) => {
          try {
            resolve(proxy.call_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }

  _callWithFds(method, parameters, fdList) {
    if (!this._proxy)
      return Promise.reject(new Error('Synchronization Service proxy is unavailable'));
    return new Promise((resolve, reject) => {
      this._proxy.call_with_unix_fd_list(
        method,
        parameters,
        Gio.DBusCallFlags.NONE,
        5000,
        fdList,
        this._cancellable,
        (proxy, result) => {
          try {
            resolve(proxy.call_with_unix_fd_list_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }

  _handleTransferChanged(rawTransfer) {
    let transfer;
    try {
      const {deviceId} = ensureDeviceIdentity(this._settings);
      transfer = validateTransfer(rawTransfer, deviceId);
      const previous = this._transferStates.get(transfer.transferId);
      if (previous && (transfer.completedBytes < previous.completedBytes
          || (previous.totalBytes > 0 && transfer.totalBytes !== previous.totalBytes)))
        throw new Error('Service emitted non-monotonic transfer progress');
    } catch (error) {
      this._report(error);
      return;
    }
    const {transferId, state} = transfer;
    if (!this._transferStates.has(transferId) && this._transferStates.size >= MAX_TRANSFER_STATES)
      this._transferStates.delete(this._transferStates.keys().next().value);
    this._transferStates.set(transferId, transfer);
    const waiter = this._transferWaiters.get(transferId);
    if (waiter && state === 'completed') {
      clearTimeout(waiter.timeout);
      this._transferWaiters.delete(transferId);
      this._knownTransfers.delete(transferId);
      waiter.resolve();
    } else if (waiter && ['cancelled', 'expired', 'failed'].includes(state)) {
      clearTimeout(waiter.timeout);
      this._transferWaiters.delete(transferId);
      this._knownTransfers.delete(transferId);
      waiter.reject(new Error(transfer.errorMessage || `Transfer ${state}`));
    }
    this.emit('transfer-changed', {...transfer});
  }

  _waitForTransfer(transferId) {
    if (!isUuid(transferId) || !this._knownTransfers.has(transferId))
      return Promise.reject(new Error('Synchronization transfer ID is unknown'));
    const current = this._transferStates.get(transferId);
    if (current?.state === 'completed') {
      this._knownTransfers.delete(transferId);
      return Promise.resolve();
    }
    if (current && ['cancelled', 'expired', 'failed'].includes(current.state)) {
      this._knownTransfers.delete(transferId);
      return Promise.reject(new Error(current.errorMessage || `Transfer ${current.state}`));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._transferWaiters.delete(transferId);
        this._knownTransfers.delete(transferId);
        this.cancelTransfer(transferId).catch(() => {});
        reject(new Error('Timed out waiting for synchronized content'));
      }, this._settings.get_uint('sync-transfer-timeout-seconds') * 1000);
      this._transferWaiters.set(transferId, {resolve, reject, timeout});
    });
  }

  _report(error) {
    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
      console.error(`Clipboard X sync operation failed (code ${error.code ?? 'unknown'})`);
  }

  _disconnectProxy() {
    if (this._proxySignal)
      this._proxy.disconnect(this._proxySignal);
    this._proxySignal = 0;
    this._proxy = null;
    this._registeredProfile = null;
    this._capabilities = null;
    this._status = null;
  }

  _stopWatchingName() {
    if (this._connectIdleId)
      GLib.Source.remove(this._connectIdleId);
    this._connectIdleId = 0;
    if (this._nameWatchId)
      Gio.bus_unwatch_name(this._nameWatchId);
    this._nameWatchId = 0;
  }

  _rejectTransfers(error) {
    for (const waiter of this._transferWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this._transferWaiters.clear();
    this._knownTransfers.clear();
  }

  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this._generation++;
    for (const signal of this._settingsSignals)
      this._settings.disconnect(signal);
    this._settingsSignals = [];
    this._stopWatchingName();
    this._disconnectProxy();
    this._rejectTransfers(new Error('Synchronization client was destroyed'));
    this._transferStates.clear();
    this._knownTransfers.clear();
    this._cancellable.cancel();
    this.disconnectAll();
  }
}

function unpackValue(value) {
  if (value instanceof GLib.Variant)
    return unpackValue(value.deepUnpack());
  if (Array.isArray(value))
    return value.map(unpackValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpackValue(item)]));
  return value;
}

function unpackDictionary(value) {
  return unpackValue(value);
}

async function readFdListBytes(fdList, index, cancellable, maxBytes = 0) {
  if (!fdList || !Number.isInteger(index) || index < 0 || index >= fdList.get_length())
    throw new Error('D-Bus payload references an invalid UNIX FD');
  const fd = fdList.get(index);
  const stream = new GioUnix.InputStream({fd, close_fd: true});
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const bytes = await new Promise((resolve, reject) => {
        stream.read_bytes_async(64 * 1024, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
          try {
            resolve(source.read_bytes_finish(result));
          } catch (error) {
            reject(error);
          }
        });
      });
      if (bytes.get_size() === 0)
        break;
      total += bytes.get_size();
      if (maxBytes > 0 && total > maxBytes)
        throw new Error(`D-Bus payload exceeds the negotiated limit of ${maxBytes} bytes`);
      chunks.push(bytes.get_data());
    }
  } finally {
    stream.close(null);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new GLib.Bytes(output);
}

function validateChange(rawValue) {
  const value = unpackDictionary(rawValue);
  const sequence = Number(value.sequence);
  const kind = value.kind;
  const itemId = value['item-id'];
  if (!Number.isSafeInteger(sequence) || sequence < 0
      || !['upsert', 'remove'].includes(kind)
      || !isUuid(itemId))
    throw new Error('Synchronization Service returned an invalid change record');
  return {
    sequence,
    kind,
    itemId,
    reason: safeString(value.reason ?? '', 256),
  };
}

function validateStatus(rawValue) {
  const value = unpackDictionary(rawValue);
  const state = safeString(value.state ?? '', 32);
  const networkState = safeString(value['network-state'] ?? '', 64);
  const pendingItems = Number(value['pending-items']);
  const activeTransfers = Number(value['active-transfers']);
  const lastSyncAt = Number(value['last-sync-at']);
  const revision = Number(value.revision);
  if (!['online', 'offline', 'degraded', 'error'].includes(state)
      || !networkState
      || !Number.isSafeInteger(pendingItems) || pendingItems < 0
      || !Number.isSafeInteger(activeTransfers) || activeTransfers < 0
      || !Number.isSafeInteger(lastSyncAt) || lastSyncAt < 0
      || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Synchronization Service returned invalid status metadata');
  return {
    state,
    networkState,
    pendingItems,
    activeTransfers,
    lastSyncAt,
    revision,
    errorCode: safeString(value['error-code'] ?? '', 128),
    errorMessage: safeString(value['error-message'] ?? '', 512),
  };
}

function validateDevice(rawValue) {
  const value = unpackDictionary(rawValue);
  const deviceId = value['device-id'];
  const tag = safeString(value.tag ?? '', 256);
  const iconKind = safeString(value['icon-kind'] ?? '', 32);
  const state = safeString(value.state ?? '', 32);
  const lastSeenAt = Number(value['last-seen-at']);
  if (!isUuid(deviceId) || !tag || !DEVICE_ICON_KINDS.includes(iconKind)
      || !['online', 'offline', 'unavailable'].includes(state)
      || !Number.isSafeInteger(lastSeenAt) || lastSeenAt < 0
      || typeof value['is-current'] !== 'boolean')
    throw new Error('Synchronization Service returned invalid device metadata');
  return {deviceId, tag, iconKind, state, lastSeenAt, isCurrent: value['is-current']};
}

function validateTransfer(rawValue, expectedDeviceId = '') {
  const value = unpackDictionary(rawValue);
  const transferId = value['transfer-id'];
  const itemId = value['item-id'];
  const deviceId = value['device-id'];
  const kind = value.kind;
  const direction = value.direction;
  const state = value.state;
  const completedBytes = Number(value['completed-bytes']);
  const totalBytes = Number(value['total-bytes']);
  const peerDeviceIds = value['peer-device-ids'];
  const createdAt = Number(value['created-at']);
  const updatedAt = Number(value['updated-at']);
  if (!isUuid(transferId) || !isUuid(itemId) || !isUuid(deviceId)
      || (expectedDeviceId && deviceId !== expectedDeviceId)
      || !['publish', 'content'].includes(kind)
      || !['upload', 'download'].includes(direction)
      || !TRANSFER_STATES.has(state)
      || !Number.isSafeInteger(completedBytes) || completedBytes < 0
      || !Number.isSafeInteger(totalBytes) || totalBytes < 0
      || (totalBytes > 0 && completedBytes > totalBytes)
      || (state === 'completed' && completedBytes !== totalBytes)
      || !Array.isArray(peerDeviceIds) || peerDeviceIds.length > 10_000
      || !peerDeviceIds.every(isUuid)
      || !Number.isSafeInteger(createdAt) || createdAt < 0
      || !Number.isSafeInteger(updatedAt) || updatedAt < createdAt)
    throw new Error('Synchronization Service returned invalid transfer metadata');
  return {
    transferId,
    itemId,
    deviceId,
    kind,
    direction,
    state,
    completedBytes,
    totalBytes,
    peerDeviceIds: [...new Set(peerDeviceIds)],
    createdAt,
    updatedAt,
    errorCode: safeString(value['error-code'] ?? '', 128),
    errorMessage: safeString(value['error-message'] ?? '', 512),
  };
}

function validateRepresentation(representation) {
  if (!isContentId(representation.id))
    throw new Error('Synchronization content ID is invalid');
  if (!isMimeType(representation.mimeType))
    throw new Error('Synchronization MIME type is invalid');
  if (!Number.isSafeInteger(representation.size)
      || representation.size < 0
      || representation.size > ABSOLUTE_ITEM_LIMIT_BYTES)
    throw new Error('Synchronization content size is invalid');
  if (!SHA256_PATTERN.test(representation.sha256))
    throw new Error('Synchronization content hash is invalid');
  if (!['eager', 'on-demand'].includes(representation.delivery))
    throw new Error('Synchronization delivery policy is invalid');
}

function validateItemId(itemId) {
  if (!isUuid(itemId))
    throw new Error('Synchronization item ID must be a UUID v4');
}

function isContentId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !/[\r\n\0]/u.test(value);
}

function validateMimeTypes(value) {
  if (!Array.isArray(value) || value.length > 256 || !value.every(isMimeType))
    throw new Error('Synchronization Service returned invalid MIME capabilities');
  return [...new Set(value)];
}

function isMimeType(value) {
  return typeof value === 'string'
    && value.length <= 255
    && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[^\r\n]{1,128})?$/iu.test(value);
}

function safeString(value, maximumLength) {
  if (typeof value !== 'string')
    throw new Error('Synchronization Service returned a non-string metadata value');
  return value.slice(0, maximumLength).replace(/[\r\n\0]/gu, ' ');
}

function safeLimit(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error('Synchronization Service returned an invalid byte limit');
  return number;
}

function effectiveLimit(serviceLimit, localLimit) {
  return serviceLimit > 0 ? Math.min(serviceLimit, localLimit) : localLimit;
}
