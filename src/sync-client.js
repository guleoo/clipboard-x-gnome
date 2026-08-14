import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

import {ClipboardItem} from './clipboard-item.js';
import {EventEmitter} from './event-emitter.js';
import {ensureDeviceIdentity, sha256, stringFromBytes, truncateUtf8, variantDictionary, writeFile} from './core.js';
import {SYNC_API_VERSION, SYNC_INTERFACE, UUID} from './constants.js';

export class SyncClient extends EventEmitter {
  constructor(settings) {
    super();
    this._settings = settings;
    this._proxy = null;
    this._proxySignal = 0;
    this._nameWatchId = 0;
    this._settingsSignals = [];
    this._cancellable = new Gio.Cancellable();
    this._registeredTag = null;
    this._transferWaiters = new Map();
    this._transferStates = new Map();
    this._capabilities = null;
    this._connecting = false;
    this._generation = 0;
    this._destroyed = false;
  }

  get connected() {
    return Boolean(this._proxy?.get_name_owner());
  }

  get capabilities() {
    return this._capabilities ? {...this._capabilities} : null;
  }

  async start() {
    this._settingsSignals.push(
      this._settings.connect('changed::device-tag', () => this._registerDevice().catch(error => this._report(error))),
      this._settings.connect('changed::service-bus-name', () => this.restart()),
      this._settings.connect('changed::service-object-path', () => this.restart()),
    );
    await this._connect();
  }

  async restart() {
    if (this._destroyed)
      return;
    this._generation++;
    this._stopWatchingName();
    this._disconnectProxy();
    if (this._settings.get_boolean('sync-enabled'))
      await this._connect();
  }

  async publish(item) {
    if (!this.connected)
      throw new Error('Synchronization service is unavailable');

    const {deviceId} = ensureDeviceIdentity(this._settings);
    const representations = item.representations.filter(representation => this._canPublish(representation.mimeType));
    if (representations.length === 0)
      throw new Error('The synchronization policy or Service capabilities reject all representations');
    const totalBytes = representations.reduce((sum, representation) => sum + representation.size, 0);
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
        const path = GLib.build_filenamev([GLib.get_tmp_dir(), `clipboard-x-${item.id}-preview.txt`]);
        await writeFile(
          Gio.File.new_for_path(path),
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
        favorite: item.favorite,
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
      const parameters = new GLib.Variant('(sa{sv}a(sa{sv}h)a(sa{sv}h))', [
        deviceId,
        metadata,
        previews,
        contents,
      ]);

      const [reply] = await this._callWithFds('Publish', parameters, fdList);
      return reply.deepUnpack()[0];
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

  async listPending(nameKnownPresent = false) {
    if (!nameKnownPresent && !this.connected)
      return [];
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call('ListPending', new GLib.Variant('(s)', [deviceId]));
    return reply.deepUnpack()[0];
  }

  async requestContent(itemId, contentIds) {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const reply = await this._call(
      'RequestContent',
      new GLib.Variant('(ssas)', [deviceId, itemId, contentIds]),
    );
    return reply.deepUnpack()[0];
  }

  async getItem(itemId) {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const [reply, fdList] = await this._callWithFds(
      'GetItem',
      new GLib.Variant('(ss)', [deviceId, itemId]),
      null,
    );
    const [rawMetadata, rawPreviews] = reply.deepUnpack();
    const metadata = unpackDictionary(rawMetadata);
    const contentValues = metadata.contents ?? [];
    const representations = contentValues.map(rawContent => {
      const content = unpackDictionary(rawContent);
      return {
        id: content['content-id'],
        mimeType: content['mime-type'],
        size: Number(content.size),
        sha256: content.sha256,
        delivery: content.delivery,
        bytes: null,
        path: null,
      };
    });

    let preview = null;
    if (rawPreviews.length > 0) {
      const [mimeType, rawPreviewMetadata, fdIndex] = rawPreviews[0];
      const previewMetadata = unpackDictionary(rawPreviewMetadata);
      const bytes = await readFdListBytes(
        fdList,
        fdIndex,
        this._cancellable,
        this._capabilities?.maxPreviewBytes ?? 0,
      );
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
        const path = GLib.build_filenamev([previewRoot, `${itemId}.png`]);
        await writeFile(Gio.File.new_for_path(path), bytes, this._cancellable);
        preview = {
          mimeType,
          path,
          size: bytes.get_size(),
          truncated: true,
          derivedFrom: previewMetadata['content-id'],
        };
      }
    }

    return new ClipboardItem({
      id: metadata.id ?? itemId,
      createdAt: Number(metadata['created-at'] ?? Date.now()),
      originDeviceId: metadata['origin-device-id'] ?? '',
      originDeviceTag: metadata['origin-device-tag'] ?? '',
      representations,
      preview,
      favorite: Boolean(metadata.favorite),
      remote: true,
      availability: 'preview',
    });
  }

  async materialize(item) {
    if (!item.remote || item.representations.every(representation => representation.bytes))
      return item;

    item.availability = 'waiting-for-source';
    try {
      const contentIds = item.representations.map(representation => representation.id);
      const transferId = await this.requestContent(item.id, contentIds);
      await this._waitForTransfer(transferId);
      for (const representation of item.representations) {
        const {metadata, bytes} = await this.openContent(item.id, representation.id);
        const actualSize = bytes.get_size();
        const actualHash = sha256(bytes);
        if (actualSize !== representation.size || (metadata.size && actualSize !== Number(metadata.size)))
          throw new Error(`Synchronization size mismatch for ${representation.id}`);
        if (actualHash !== representation.sha256 || (metadata.sha256 && actualHash !== metadata.sha256))
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
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const [reply, fdList] = await this._callWithFds(
      'OpenContent',
      new GLib.Variant('(sss)', [deviceId, itemId, contentId]),
      null,
    );
    const [rawMetadata, fdIndex] = reply.deepUnpack();
    const metadata = unpackDictionary(rawMetadata);
    return {
      metadata,
      bytes: await readFdListBytes(
        fdList,
        fdIndex,
        this._cancellable,
        this._capabilities?.maxItemBytes ?? 0,
      ),
    };
  }

  async acknowledge(itemId, result, message = '') {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    await this._call(
      'Acknowledge',
      new GLib.Variant('(ssss)', [deviceId, itemId, result, message]),
    );
  }

  async cancelTransfer(transferId) {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    await this._call('CancelTransfer', new GLib.Variant('(ss)', [deviceId, transferId]));
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
    this._nameWatchId = Gio.bus_watch_name(
      Gio.BusType.SESSION,
      busName,
      Gio.BusNameWatcherFlags.NONE,
      () => {
        if (!this._destroyed && generation === this._generation
            && !this._capabilities && !this._connecting) {
          GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => {
            if (!this._destroyed && generation === this._generation)
              this._createProxy(busName, generation).catch(error => this._report(error));
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
        if (name === 'ItemAvailable')
          this.emit('item-available', values[0]);
        else if (name === 'ItemRemoved')
          this.emit('item-removed', values[0], values[1]);
        else if (name === 'TransferChanged')
          this._handleTransferChanged(...values);
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
      this._registeredTag = null;
      this._capabilities = null;
      this._rejectTransfers(new Error('Synchronization service went offline'));
      this.emit('status-changed', 'offline', null);
      return;
    }

    try {
      this._capabilities = await this._loadCapabilities();
      if (this._capabilities.apiVersion !== SYNC_API_VERSION)
        throw new Error(`Unsupported synchronization API version: ${this._capabilities.apiVersion}`);
      this._registeredTag = null;
      await this._registerDevice(nameKnownPresent);
      const pending = await this.listPending(nameKnownPresent);
      for (const itemId of pending)
        this.emit('item-available', itemId);
      this.emit('status-changed', this._capabilities.status || 'online', this.capabilities);
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
      implementationName: read('ImplementationName', ''),
      implementationVersion: read('ImplementationVersion', ''),
      status: read('Status', 'online'),
      supportedMimeTypes: read('SupportedMimeTypes', []),
      maxItemBytes: Number(read('MaxItemBytes', 0)),
      maxPreviewBytes: Number(read('MaxPreviewBytes', 0)),
    };
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
    return serviceLimit > 0 ? Math.min(serviceLimit, configuredLimit) : configuredLimit;
  }

  async _registerDevice(nameKnownPresent = false) {
    if (!nameKnownPresent && !this.connected)
      return;
    const {deviceId, deviceTag} = ensureDeviceIdentity(this._settings);
    if (deviceTag === this._registeredTag)
      return;
    await this._call('RegisterDevice', new GLib.Variant('(ss)', [deviceId, deviceTag]));
    this._registeredTag = deviceTag;
  }

  _call(method, parameters) {
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

  _handleTransferChanged(transferId, state, received, total, error) {
    this._transferStates.set(transferId, {state, received, total, error});
    const waiter = this._transferWaiters.get(transferId);
    if (waiter && state === 'ready') {
      clearTimeout(waiter.timeout);
      this._transferWaiters.delete(transferId);
      waiter.resolve();
    } else if (waiter && ['cancelled', 'expired', 'failed'].includes(state)) {
      clearTimeout(waiter.timeout);
      this._transferWaiters.delete(transferId);
      waiter.reject(new Error(error || `Transfer ${state}`));
    }
    this.emit('transfer-changed', transferId, state, received, total, error);
  }

  _waitForTransfer(transferId) {
    const current = this._transferStates.get(transferId);
    if (current?.state === 'ready')
      return Promise.resolve();
    if (current && ['cancelled', 'expired', 'failed'].includes(current.state))
      return Promise.reject(new Error(current.error || `Transfer ${current.state}`));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._transferWaiters.delete(transferId);
        this.cancelTransfer(transferId).catch(() => {});
        reject(new Error('Timed out waiting for synchronized content'));
      }, this._settings.get_uint('sync-transfer-timeout-seconds') * 1000);
      this._transferWaiters.set(transferId, {resolve, reject, timeout});
    });
  }

  _report(error) {
    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
      console.error(`Clipboard X sync: ${error.message}`);
  }

  _disconnectProxy() {
    if (this._proxySignal)
      this._proxy.disconnect(this._proxySignal);
    this._proxySignal = 0;
    this._proxy = null;
    this._registeredTag = null;
    this._capabilities = null;
  }

  _stopWatchingName() {
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
