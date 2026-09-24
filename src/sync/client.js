import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../clipboard/item.js';
import {
  ABSOLUTE_ITEM_LIMIT_BYTES,
  ABSOLUTE_PREVIEW_LIMIT_BYTES,
  MAX_ITEM_REPRESENTATIONS,
} from '../clipboard/constants.js';
import {devicePaths} from '../clipboard/history/paths.js';
import {bytesFromString, sha256, stringFromBytes, truncateUtf8} from '../common/bytes.js';
import {EventEmitter} from '../common/event-emitter.js';
import {writeFile} from '../common/files.js';
import {isUuid} from '../common/uuid.js';
import {configuration as publicConfiguration} from './configuration.js';
import {SyncConfigurationStore} from './configuration-store.js';
import {ensureDeviceIdentity} from './device.js';
import {SyncError} from './errors.js';
import {HttpTransport} from './http/transport.js';
import {
  acceptedWork as validateAcceptedWork,
  changes as validateChanges,
  channels as validateChannels,
  contentRequest as validateContentRequest,
  device as validateDevice,
  item as validateItem,
  publication as validatePublication,
  status as validateStatus,
  transfer as validateTransfer,
  transfers as validateTransfers,
  validateLocalRepresentation,
  workPage as validateWorkPage,
} from './protocol.js';
import {TransferTracker} from './transfers.js';

const TERMINAL_TRANSFER_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

export class SyncClient extends EventEmitter {
  constructor(settings, {
    configurationStore = new SyncConfigurationStore(),
    transportFactory = (configuration, options) => new HttpTransport(configuration, options),
    sourceItem = () => null,
  } = {}) {
    super();
    this._settings = settings;
    this._configurationStore = configurationStore;
    this._transportFactory = transportFactory;
    this._sourceItem = sourceItem;
    this._settingsSignals = [];
    this._transport = null;
    this._cancellable = null;
    this._connected = false;
    this._capabilities = null;
    this._configuration = null;
    this._storedConfiguration = null;
    this._status = null;
    this._devices = new Map();
    this._channels = [];
    this._registeredProfile = '';
    this._profileUpdateChain = Promise.resolve();
    this._pollSource = 0;
    this._polling = false;
    this._generation = 0;
    this._destroyed = false;
    this._transferWaiters = new Map();
    this._operations = new Map();
    this._remoteTransferIds = new Set();
    this._activeCancellables = new Set();
    this._transferChain = Promise.resolve();
    this._transfers = new TransferTracker(transfer => this._transferChanged(transfer));
  }

  get connected() {
    return this._connected;
  }

  get capabilities() {
    return this._capabilities ? {...this._capabilities} : null;
  }

  get devices() {
    return [...this._devices.values()].map(value => ({...value}));
  }

  get channels() {
    return this._channels.map(value => ({...value}));
  }

  get configuration() {
    return this._configuration ? {...this._configuration} : null;
  }

  get status() {
    return this._status ? {...this._status} : null;
  }

  getTransferForItem(itemId) {
    return this._transfers.forItem(itemId);
  }

  async start() {
    this._settingsSignals.push(
      this._settings.connect('changed::device-tag', () => this._queueProfileUpdate().catch(error => this._report(error))),
      this._settings.connect('changed::device-icon-kind', () => this._queueProfileUpdate().catch(error => this._report(error))),
      this._settings.connect('changed::sync-configuration-revision', () => this.restart().catch(error => this._report(error))),
      this._settings.connect('changed::sync-poll-interval-seconds', () => this._reschedulePoll()),
    );
    await this._connect();
  }

  async restart() {
    if (this._destroyed)
      return;
    this._generation++;
    this._resetRuntime(new Error('Synchronization connection was restarted'));
    if (this._settings.get_boolean('sync-enabled'))
      await this._connect();
    else
      this.emit('status-changed', 'offline', null);
  }

  publish(item) {
    if (item.sensitive)
      return Promise.reject(new SyncError('sensitive_content', 'Sensitive content cannot be synchronized'));
    return this._enqueueTransfer(() => this._publish(item));
  }

  materialize(item) {
    return this._materialize(item);
  }

  async getChanges(cursor, options = {}) {
    if (!this._connected || !this._storedConfiguration?.activeChannelId)
      return {nextCursor: cursor, changes: [], hasMore: false};
    return validateChanges(await this._transport.changes(
      this._storedConfiguration.activeChannelId,
      cursor,
      options.limit ?? 200,
    ));
  }

  async getItem(itemId) {
    this._requireConnection();
    validateItemId(itemId);
    const channelId = this._requireChannel();
    const remote = validateItem(await this._transport.item(channelId, itemId), itemId);
    const declaredBytes = remote.contents.reduce((sum, content) => sum + content.size, 0);
    const itemLimit = effectiveLimit(this._capabilities.maxItemBytes, ABSOLUTE_ITEM_LIMIT_BYTES);
    if (declaredBytes > itemLimit)
      throw new Error(`Synchronization item exceeds the effective limit of ${itemLimit} bytes`);

    const representations = remote.contents.map(content => ({
      id: content.id,
      mimeType: content.mimeType,
      size: content.size,
      sha256: content.sha256,
      delivery: content.delivery,
      bytes: null,
      path: null,
    }));
    let preview = null;
    const selected = remote.previews.find(value => value.contentId === representations[0].id)
      ?? remote.previews[0];
    if (selected) {
      const maximumBytes = effectiveLimit(
        this._capabilities.maxPreviewBytes,
        ABSOLUTE_PREVIEW_LIMIT_BYTES,
      );
      const bytes = await this._transport.preview(
        channelId,
        itemId,
        selected.id,
        maximumBytes,
        selected.mimeType,
      );
      if (bytes.get_size() !== selected.size || sha256(bytes) !== selected.sha256)
        throw new Error('Synchronization preview does not match its manifest');
      if (selected.mimeType.startsWith('text/')) {
        preview = {
          mimeType: selected.mimeType,
          text: stringFromBytes(bytes),
          truncated: selected.truncated,
          derivedFrom: selected.contentId,
        };
      } else {
        const paths = devicePaths(remote.originDeviceId);
        GLib.mkdir_with_parents(paths.previews, 0o700);
        const path = GLib.build_filenamev([paths.previews, selected.sha256]);
        await writeFile(Gio.File.new_for_path(path), bytes, this._cancellable);
        preview = {
          mimeType: selected.mimeType,
          path,
          size: selected.size,
          sha256: selected.sha256,
          truncated: selected.truncated,
          derivedFrom: selected.contentId,
        };
      }
    }

    return new ClipboardItem({
      id: remote.id,
      createdAt: remote.createdAt,
      originDeviceId: remote.originDeviceId,
      originDeviceTag: remote.originDeviceTag,
      originDeviceIconKind: remote.originDeviceIconKind,
      representations,
      preview,
      favorite: false,
      remote: true,
      availability: 'preview',
    });
  }

  async cancelTransfer(transferId) {
    if (!isUuid(transferId))
      throw new Error('Synchronization transfer ID is invalid');
    this._operations.get(transferId)?.cancel();
    if (this._connected && this._remoteTransferIds.has(transferId)) {
      try {
        await this._transport.cancel(transferId);
      } catch (error) {
        if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
          throw error;
      }
    }
    const current = this._transfers.get(transferId);
    if (current && !TERMINAL_TRANSFER_STATES.has(current.state))
      this._recordTransfer({...current, state: 'cancelled', updatedAt: Date.now()}, true);
  }

  async getTransfer(transferId) {
    this._requireConnection();
    if (!isUuid(transferId))
      throw new Error('Synchronization transfer ID is invalid');
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const transfer = validateTransfer(await this._transport.transfer(transferId), deviceId);
    this._remoteTransferIds.add(transferId);
    return transfer;
  }

  async listTransfers() {
    this._requireConnection();
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const values = validateTransfers(await this._transport.transfers(), deviceId);
    for (const transfer of values) {
      this._remoteTransferIds.add(transfer.transferId);
      this._recordTransfer(transfer, true);
    }
    return values;
  }

  async listChannels() {
    this._requireConnection();
    this._channels = validateChannels(
      await this._transport.channels(),
      this._storedConfiguration.activeChannelId,
    );
    this.emit('channels-changed', this.channels);
    return this.channels;
  }

  async testConnection() {
    this._requireConnection();
    const started = GLib.get_monotonic_time();
    const status = validateStatus(await this._transport.status());
    return {
      state: 'online',
      latencyMs: Math.max(0, Math.round((GLib.get_monotonic_time() - started) / 1000)),
      serverVersion: status.implementationVersion,
      message: 'Connected',
    };
  }

  async _connect() {
    if (this._destroyed || !this._settings.get_boolean('sync-enabled'))
      return;
    const generation = ++this._generation;
    this._storedConfiguration = await this._configurationStore.load();
    this._applyPublicConfiguration();
    if (!this._storedConfiguration.serverAddress || !this._storedConfiguration.apiKey) {
      this._setStatus('offline', null, 'not-configured');
      return;
    }

    this._cancellable = new Gio.Cancellable();
    const identity = ensureDeviceIdentity(this._settings);
    this._transport = this._transportFactory(this._storedConfiguration, {
      deviceId: identity.deviceId,
      cancellable: this._cancellable,
    });
    try {
      this._capabilities = validateStatus(await this._transport.status());
      if (this._destroyed || generation !== this._generation)
        return;
      this._connected = true;
      const currentDevice = validateDevice(await this._transport.device(), identity.deviceId);
      this._devices.set(currentDevice.deviceId, currentDevice);
      await this._queueProfileUpdate(true);
      await this.listChannels();
      if (this._channels.length > 0
          && !this._channels.some(channel => channel.id === this._storedConfiguration.activeChannelId)) {
        this._storedConfiguration.activeChannelId = this._channels[0].id;
        await this._saveConnection();
        await this.listChannels();
      }
      this._applyPublicConfiguration();
      await this.listTransfers();
      await this._poll();
      this._setStatus(this._capabilities.status, this._capabilities, 'online');
      this._schedulePoll();
    } catch (error) {
      if (generation === this._generation) {
        this._closeConnection();
        this._setStatus('error', {
          error: error.message,
          errorCode: String(error.code ?? 'request_failed'),
        }, 'request-failed');
      }
      throw error;
    }
  }

  async _publish(item) {
    if (item.sensitive)
      throw new SyncError('sensitive_content', 'Sensitive content cannot be synchronized');
    this._requireConnection();
    if (!isUuid(item.id))
      throw new Error('Item ID must be a UUID v4');
    const channelId = this._requireChannel();
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const representations = item.representations
      .filter(representation => this._canPublish(representation.mimeType));
    if (representations.length === 0 || representations.length > MAX_ITEM_REPRESENTATIONS)
      throw new Error('Synchronization policy rejects all representations or their count');
    for (const representation of representations) {
      validateLocalRepresentation(representation);
      if (!representation.path)
        throw new Error('Clipboard snapshot must be persisted before publication');
    }
    const declaredBytes = representations.reduce((sum, representation) => sum + representation.size, 0);
    const itemLimit = effectiveLimit(this._capabilities.maxItemBytes, ABSOLUTE_ITEM_LIMIT_BYTES);
    if (declaredBytes > itemLimit)
      throw new Error(`Synchronization item exceeds the effective limit of ${itemLimit} bytes`);

    const previews = this._publicationPreviews(item);
    const sources = new Map();
    for (const preview of previews)
      sources.set(`preview:${preview.id}`, preview.source);
    for (const representation of representations.filter(value => value.delivery === 'eager')) {
      sources.set(`content:${representation.id}`, {
        path: representation.path,
        size: representation.size,
        mimeType: representation.mimeType,
      });
    }
    const manifest = {
      id: item.id,
      createdAt: item.createdAt,
      originDeviceId: deviceId,
      contents: representations.map(representation => ({
        id: representation.id,
        mimeType: representation.mimeType,
        size: representation.size,
        sha256: representation.sha256,
        delivery: representation.delivery,
      })),
      previews: previews.map(({source: _source, ...preview}) => preview),
    };

    let transfer = null;
    let completedBytes = 0;
    const cancellable = this._newOperationCancellable();
    try {
      const publication = validatePublication(
        await this._transport.createItem(channelId, manifest),
        item.id,
      );
      transfer = publication.transfer;
      if (transfer.kind !== 'publish' || transfer.direction !== 'upload')
        throw new Error('Synchronization server returned an invalid publication transfer');
      this._remoteTransferIds.add(transfer.transferId);
      this._operations.set(transfer.transferId, cancellable);
      const requested = [
        ...publication.previewIds.map(id => [`preview:${id}`, id, true]),
        ...publication.contentIds.map(id => [`content:${id}`, id, false]),
      ];
      const totalBytes = requested.reduce((sum, [key]) => {
        const source = sources.get(key);
        if (!source)
          throw new Error('Synchronization server requested an unknown upload object');
        return sum + source.size;
      }, 0);
      if (!TERMINAL_TRANSFER_STATES.has(transfer.state) && transfer.totalBytes !== totalBytes)
        throw new Error('Synchronization server returned an inconsistent upload size');
      this._recordTransfer(transfer, true);
      if (transfer.state === 'completed')
        return {itemId: publication.itemId, transferId: transfer.transferId};
      if (TERMINAL_TRANSFER_STATES.has(transfer.state))
        throw new Error(transfer.errorMessage || `Transfer ${transfer.state}`);
      for (const [key, id, preview] of requested) {
        const source = sources.get(key);
        const base = completedBytes;
        const progress = bytes => this._recordTransfer({
          ...transfer,
          state: 'transferring',
          completedBytes: Math.min(totalBytes, base + bytes),
          totalBytes,
          updatedAt: Date.now(),
        });
        if (preview)
          await this._transport.uploadPreview(publication.uploadId, id, source, progress, cancellable);
        else
          await this._transport.uploadContent(publication.uploadId, id, source, progress, cancellable);
        completedBytes += source.size;
      }
      const completed = validateTransfer(
        (await this._transport.completeUpload(publication.uploadId)).transfer,
        deviceId,
      );
      this._recordTransfer({...completed, updatedAt: Math.max(Date.now(), completed.updatedAt)}, true);
      return {itemId: publication.itemId, transferId: completed.transferId};
    } catch (error) {
      if (transfer) {
        this._recordTransfer({
          ...transfer,
          state: error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ? 'cancelled' : 'failed',
          completedBytes,
          updatedAt: Date.now(),
          errorCode: String(error.code ?? 'upload_failed'),
          errorMessage: error.message,
        }, true);
      }
      throw error;
    } finally {
      if (transfer)
        this._operations.delete(transfer.transferId);
      this._activeCancellables.delete(cancellable);
    }
  }

  async _materialize(item) {
    if (!item.remote || item.representations.every(value => value.bytes || value.path))
      return item;
    this._requireConnection();
    const channelId = this._requireChannel();
    const {deviceId} = ensureDeviceIdentity(this._settings);
    item.availability = 'waiting-for-peer';
    try {
      for (const representation of item.representations.filter(value => !value.bytes && !value.path)) {
        const request = validateContentRequest(
          await this._transport.requestContent(channelId, item.id, representation.id),
          deviceId,
        );
        if (request.transfer.kind !== 'content' || request.transfer.direction !== 'download'
            || request.transfer.itemId !== item.id)
          throw new Error('Synchronization server returned an invalid content request transfer');
        this._remoteTransferIds.add(request.transfer.transferId);
        this._recordTransfer(request.transfer, true);
        if (!TERMINAL_TRANSFER_STATES.has(request.transfer.state))
          await this._waitForTransfer(request.transfer.transferId);
        else if (request.transfer.state !== 'completed')
          throw new Error(request.transfer.errorMessage || `Transfer ${request.transfer.state}`);
        await this._enqueueTransfer(
          () => this._downloadRepresentation(channelId, item, representation),
        );
      }
      item.availability = 'ready';
      return item;
    } catch (error) {
      item.availability = 'failed';
      throw error;
    }
  }

  async _downloadRepresentation(channelId, item, representation) {
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const transferId = GLib.uuid_string_random();
    const now = Date.now();
    const transfer = {
      transferId,
      itemId: item.id,
      deviceId,
      kind: 'content',
      direction: 'download',
      state: 'transferring',
      completedBytes: 0,
      totalBytes: representation.size,
      peerDeviceIds: [item.originDeviceId],
      createdAt: now,
      updatedAt: now,
      errorCode: '',
      errorMessage: '',
    };
    const cancellable = this._newOperationCancellable();
    this._operations.set(transferId, cancellable);
    this._recordTransfer(transfer, true);
    const targetPath = GLib.build_filenamev([
      devicePaths(item.originDeviceId).objects,
      representation.sha256,
    ]);
    try {
      const result = await this._transport.downloadContent(
        channelId,
        item.id,
        representation.id,
        targetPath,
        {
          maximumBytes: effectiveLimit(this._capabilities.maxItemBytes, ABSOLUTE_ITEM_LIMIT_BYTES),
          expectedBytes: representation.size,
          expectedSha256: representation.sha256,
          mimeType: representation.mimeType,
          cancellable,
          onProgress: completedBytes => this._recordTransfer({
            ...transfer,
            completedBytes,
            updatedAt: Date.now(),
          }),
        },
      );
      representation.path = result.path;
      this._recordTransfer({
        ...transfer,
        state: 'completed',
        completedBytes: representation.size,
        updatedAt: Date.now(),
      }, true);
    } catch (error) {
      this._recordTransfer({
        ...transfer,
        state: error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ? 'cancelled' : 'failed',
        updatedAt: Date.now(),
        errorCode: String(error.code ?? 'download_failed'),
        errorMessage: error.message,
      }, true);
      throw error;
    } finally {
      this._operations.delete(transferId);
      this._activeCancellables.delete(cancellable);
    }
  }

  _publicationPreviews(item) {
    if (item.preview?.text) {
      const result = truncateUtf8(item.preview.text, this._effectivePreviewLimit(false));
      const bytes = bytesFromString(result.text);
      const digest = sha256(bytes);
      return [{
        id: digest,
        contentId: item.preview.derivedFrom,
        mimeType: item.preview.mimeType,
        size: bytes.get_size(),
        sha256: digest,
        truncated: item.preview.truncated || result.truncated,
        source: {bytes, size: bytes.get_size(), mimeType: item.preview.mimeType},
      }];
    }
    if (item.preview?.path && item.preview.size <= this._effectivePreviewLimit(true)) {
      return [{
        id: item.preview.sha256,
        contentId: item.preview.derivedFrom,
        mimeType: item.preview.mimeType,
        size: item.preview.size,
        sha256: item.preview.sha256,
        truncated: true,
        source: {
          path: item.preview.path,
          size: item.preview.size,
          mimeType: item.preview.mimeType,
        },
      }];
    }
    return [];
  }

  async _poll() {
    if (this._polling || !this._connected || this._destroyed)
      return;
    this._polling = true;
    try {
      await this._syncChanges();
      await this._syncWork();
      await this._refreshActiveTransfers();
      if (this._status?.state === 'error')
        this._setStatus(this._capabilities.status, this._capabilities, 'online');
    } finally {
      this._polling = false;
    }
  }

  async _syncChanges() {
    const channelId = this._storedConfiguration.activeChannelId;
    if (!channelId)
      return;
    let cursor = this._storedConfiguration.cursors[channelId] ?? '';
    let hasMore;
    do {
      const page = await this.getChanges(cursor, {limit: 200});
      for (const change of page.changes) {
        if (change.kind === 'upsert')
          this.emit('item-available', change.itemId);
        else
          this.emit('item-removed', change.itemId, change.reason);
      }
      if (page.nextCursor === cursor && page.hasMore)
        throw new Error('Synchronization server returned a non-advancing changes cursor');
      cursor = page.nextCursor;
      this._storedConfiguration.cursors[channelId] = cursor;
      await this._saveProgress();
      hasMore = page.hasMore;
    } while (hasMore);
  }

  async _syncWork() {
    let cursor = this._storedConfiguration.workCursor;
    let hasMore;
    do {
      const page = validateWorkPage(await this._transport.work(cursor));
      for (const work of page.work)
        await this._enqueueTransfer(() => this._performWork(work));
      if (page.cursor === cursor && page.hasMore)
        throw new Error('Synchronization server returned a non-advancing work cursor');
      cursor = page.cursor;
      this._storedConfiguration.workCursor = cursor;
      await this._saveProgress();
      hasMore = page.hasMore;
    } while (hasMore);
  }

  async _performWork(work) {
    const item = this._sourceItem(work.itemId);
    const representation = item?.representations.find(value => value.id === work.contentId);
    if (!item || !representation || (!representation.path && !representation.bytes)) {
      await this._transport.rejectWork(work.id, 'source_content_missing');
      return;
    }
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const accepted = validateAcceptedWork(
      await this._transport.acceptWork(work.id),
      work.itemId,
      deviceId,
    );
    if (accepted.transfer.kind !== 'content' || accepted.transfer.direction !== 'upload'
        || accepted.transfer.totalBytes !== representation.size)
      throw new Error('Synchronization server returned an inconsistent source upload size');
    if (accepted.transfer.state === 'completed') {
      this._remoteTransferIds.add(accepted.transfer.transferId);
      this._recordTransfer(accepted.transfer, true);
      return;
    }
    if (TERMINAL_TRANSFER_STATES.has(accepted.transfer.state))
      throw new Error(accepted.transfer.errorMessage || `Transfer ${accepted.transfer.state}`);
    const cancellable = this._newOperationCancellable();
    this._remoteTransferIds.add(accepted.transfer.transferId);
    this._operations.set(accepted.transfer.transferId, cancellable);
    this._recordTransfer(accepted.transfer, true);
    try {
      const source = {
        ...(representation.path ? {path: representation.path} : {bytes: representation.bytes}),
        size: representation.size,
        mimeType: representation.mimeType,
      };
      await this._transport.uploadContent(
        accepted.uploadId,
        representation.id,
        source,
        completedBytes => this._recordTransfer({
          ...accepted.transfer,
          state: 'transferring',
          completedBytes,
          updatedAt: Date.now(),
        }),
        cancellable,
      );
      const completed = validateTransfer(
        (await this._transport.completeUpload(accepted.uploadId)).transfer,
        deviceId,
      );
      this._recordTransfer({...completed, updatedAt: Math.max(Date.now(), completed.updatedAt)}, true);
    } catch (error) {
      this._recordTransfer({
        ...accepted.transfer,
        state: error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ? 'cancelled' : 'failed',
        updatedAt: Date.now(),
        errorCode: String(error.code ?? 'source_upload_failed'),
        errorMessage: error.message,
      }, true);
      throw error;
    } finally {
      this._operations.delete(accepted.transfer.transferId);
      this._activeCancellables.delete(cancellable);
    }
  }

  async _refreshActiveTransfers() {
    const active = this._transfers.values()
      .filter(value => !TERMINAL_TRANSFER_STATES.has(value.state) && !this._operations.has(value.transferId));
    for (const current of active)
      this._recordTransfer(await this.getTransfer(current.transferId), true);
  }

  _waitForTransfer(transferId) {
    const current = this._transfers.get(transferId);
    if (!current)
      return Promise.reject(new Error('Synchronization transfer ID is unknown'));
    if (current.state === 'completed')
      return Promise.resolve();
    if (TERMINAL_TRANSFER_STATES.has(current.state))
      return Promise.reject(new Error(current.errorMessage || `Transfer ${current.state}`));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._transferWaiters.delete(transferId);
        this.cancelTransfer(transferId).catch(() => {});
        reject(new Error('Timed out waiting for synchronized content'));
      }, this._settings.get_uint('sync-transfer-timeout-seconds') * 1000);
      this._transferWaiters.set(transferId, {resolve, reject, timeout});
    });
  }

  _recordTransfer(transfer, immediate = false) {
    this._transfers.update(transfer, {immediate});
    const waiter = this._transferWaiters.get(transfer.transferId);
    if (!waiter || !TERMINAL_TRANSFER_STATES.has(transfer.state))
      return;
    clearTimeout(waiter.timeout);
    this._transferWaiters.delete(transfer.transferId);
    if (transfer.state === 'completed')
      waiter.resolve();
    else
      waiter.reject(new Error(transfer.errorMessage || `Transfer ${transfer.state}`));
  }

  _transferChanged(transfer) {
    this.emit('transfer-changed', transfer);
  }

  _queueProfileUpdate(force = false) {
    const update = this._profileUpdateChain.catch(() => {}).then(() => this._updateProfile(force));
    this._profileUpdateChain = update;
    return update;
  }

  async _updateProfile(force = false) {
    if (!this._connected)
      return;
    const generation = this._generation;
    const identity = ensureDeviceIdentity(this._settings);
    const serialized = JSON.stringify([identity.deviceTag, identity.deviceIconKind]);
    if (!force && serialized === this._registeredProfile)
      return;
    const raw = await this._transport.updateProfile({
      tag: identity.deviceTag,
      iconKind: identity.deviceIconKind,
    });
    if (!this._connected || this._destroyed || generation !== this._generation)
      return;
    const current = raw ? validateDevice(raw, identity.deviceId) : {
      deviceId: identity.deviceId,
      tag: identity.deviceTag,
      iconKind: identity.deviceIconKind,
      state: 'online',
      lastSeenAt: Date.now(),
      isCurrent: true,
    };
    this._devices.set(current.deviceId, current);
    this._registeredProfile = serialized;
    this.emit('devices-changed', this.devices);
  }

  _canPublish(mimeType) {
    if (mimeType === 'text/html' && !this._settings.get_boolean('sync-html'))
      return false;
    if (mimeType.startsWith('text/') && mimeType !== 'text/html'
        && !this._settings.get_boolean('sync-text'))
      return false;
    if (mimeType.startsWith('image/') && !this._settings.get_boolean('sync-images'))
      return false;
    return this._capabilities.supportedMimeTypes.length === 0
      || this._capabilities.supportedMimeTypes.includes(mimeType);
  }

  _effectivePreviewLimit(image) {
    const configured = this._settings.get_uint(image ? 'thumbnail-byte-limit' : 'text-preview-limit');
    return effectiveLimit(
      this._capabilities.maxPreviewBytes,
      Math.min(configured, ABSOLUTE_PREVIEW_LIMIT_BYTES),
    );
  }

  _setStatus(state, capabilities, networkState) {
    this._status = {
      state,
      networkState,
      pendingItems: this._capabilities?.pendingItems ?? 0,
      activeTransfers: this._capabilities?.activeTransfers ?? 0,
      lastSyncAt: this._capabilities?.lastSyncAt ?? 0,
      revision: this._capabilities?.revision ?? 0,
      errorCode: state === 'error'
        ? String(capabilities?.errorCode ?? 'request_failed')
        : '',
      errorMessage: capabilities?.error ?? '',
    };
    this.emit('status-details-changed', {...this._status});
    this.emit('status-changed', state, capabilities);
  }

  _applyPublicConfiguration() {
    const active = this._channels.find(value => value.id === this._storedConfiguration?.activeChannelId);
    this._configuration = this._storedConfiguration
      ? publicConfiguration(this._storedConfiguration, active?.name ?? '')
      : null;
    this.emit('configuration-changed', this.configuration);
  }

  async _saveConnection() {
    this._storedConfiguration = await this._configurationStore.saveConnection(
      this._storedConfiguration,
    );
    this._applyPublicConfiguration();
  }

  async _saveProgress() {
    this._storedConfiguration = await this._configurationStore.saveProgress(
      this._storedConfiguration,
    );
    this._applyPublicConfiguration();
  }

  _schedulePoll() {
    if (this._pollSource || !this._connected || this._destroyed)
      return;
    this._pollSource = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._settings.get_uint('sync-poll-interval-seconds') * 1000,
      () => {
        this._poll().catch(error => {
          if (this._connected)
            this._setStatus('error', {
              error: error.message,
              errorCode: String(error.code ?? 'request_failed'),
            }, 'request-failed');
          this._report(error);
        });
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _reschedulePoll() {
    if (this._pollSource)
      GLib.Source.remove(this._pollSource);
    this._pollSource = 0;
    this._schedulePoll();
  }

  _enqueueTransfer(operation) {
    const generation = this._generation;
    const guardedOperation = () => {
      if (this._destroyed || generation !== this._generation)
        throw new Error('Synchronization operation is no longer current');
      return operation();
    };
    const result = this._transferChain.then(guardedOperation, guardedOperation);
    this._transferChain = result.catch(() => {});
    return result;
  }

  _newOperationCancellable() {
    const cancellable = new Gio.Cancellable();
    this._activeCancellables.add(cancellable);
    return cancellable;
  }

  _requireConnection() {
    if (!this._connected || !this._transport)
      throw new SyncError('server_unavailable', 'Synchronization server is unavailable');
  }

  _requireChannel() {
    const channelId = this._storedConfiguration?.activeChannelId ?? '';
    if (!isUuid(channelId))
      throw new SyncError(
        'channel_required',
        'No active synchronization channel is configured',
      );
    return channelId;
  }

  _report(error) {
    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
      console.error(`Clipboard X sync operation failed (code ${error.code ?? 'unknown'})`);
  }

  _resetRuntime(error) {
    if (this._pollSource)
      GLib.Source.remove(this._pollSource);
    this._pollSource = 0;
    for (const cancellable of this._activeCancellables)
      cancellable.cancel();
    this._activeCancellables.clear();
    this._operations.clear();
    this._remoteTransferIds.clear();
    this._transferChain = Promise.resolve();
    this._closeConnection();
    this._polling = false;
    for (const waiter of this._transferWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this._transferWaiters.clear();
    this._transfers.clear();
  }

  _closeConnection() {
    this._cancellable?.cancel();
    this._transport?.abort();
    this._transport = null;
    this._cancellable = null;
    this._connected = false;
    this._capabilities = null;
    this._devices.clear();
    this._channels = [];
    this._remoteTransferIds.clear();
    this._registeredProfile = '';
  }

  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this._generation++;
    for (const signal of this._settingsSignals)
      this._settings.disconnect(signal);
    this._settingsSignals = [];
    this._resetRuntime(new Error('Synchronization client was destroyed'));
    this._configurationStore = null;
    this._transportFactory = null;
    this._sourceItem = null;
    this.disconnectAll();
  }
}

function validateItemId(itemId) {
  if (!isUuid(itemId))
    throw new Error('Synchronization item ID must be a UUID v4');
}

function effectiveLimit(serverLimit, localLimit) {
  return serverLimit > 0 ? Math.min(serverLimit, localLimit) : localLimit;
}
