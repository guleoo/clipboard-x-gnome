import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../clipboard/item.js';
import {
  ABSOLUTE_ITEM_LIMIT_BYTES,
  ABSOLUTE_PREVIEW_LIMIT_BYTES,
} from '../clipboard/constants.js';
import {devicePaths} from '../clipboard/history/paths.js';
import {sha256, stringFromBytes} from '../common/bytes.js';
import {EventEmitter} from '../common/event-emitter.js';
import {writeFile} from '../common/files.js';
import {createLogger} from '../common/logger.js';
import {isUuid} from '../common/uuid.js';
import {configuration as publicConfiguration} from './configuration.js';
import {SyncConfigurationStore} from './configuration-store.js';
import {SyncProgressStore} from './progress-store.js';
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
  workPage as validateWorkPage,
} from './protocol.js';
import {TransferSession} from './transfer-session.js';
import {delivery} from './policy.js';
import * as publicationPlan from './publication.js';

const TERMINAL_TRANSFER_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

export class SyncClient extends EventEmitter {
  constructor(settings, {
    configurationStore = new SyncConfigurationStore(),
    progressStore = new SyncProgressStore(),
    transportFactory = (configuration, options) => new HttpTransport(configuration, options),
    sourceItem = () => null,
    applyChanges = async () => {},
    logger = createLogger('sync'),
  } = {}) {
    super();
    this._settings = settings;
    this._configurationStore = configurationStore;
    this._progressStore = progressStore;
    this._progressScope = null;
    this._progress = {cursors: {}, workCursor: ''};
    this._transportFactory = transportFactory;
    this._sourceItem = sourceItem;
    this._applyChanges = applyChanges;
    this._logger = logger;
    this._settingsSignals = [];
    this._transport = null;
    this._cancellable = null;
    this._connected = false;
    this._ready = false;
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
    this._transfers = this._newTransferSession();
  }

  get connected() {
    return this._connected;
  }

  get ready() {
    return this._ready;
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

  publish(item, {guard = () => true, manifest = null, saveManifest = async value => value} = {}) {
    if (item.sensitive)
      return Promise.reject(new SyncError('sensitive_content', 'Sensitive content cannot be synchronized'));
    const generation = this._generation;
    return this._logger.run('publish', () => {
      this._requireCurrent(generation);
      return this._transfers.enqueue(() => this._publish(item, {guard, manifest, saveManifest}));
    }, {quiet: true});
  }

  materialize(item, options = {}) {
    return this._logger.run('materialize', () => this._materialize(item, options), {quiet: true});
  }

  async getChanges(cursor, options = {}) {
    if (!this._connected || !this._storedConfiguration?.activeChannelId)
      return {nextCursor: cursor, changes: [], hasMore: false};
    const transport = this._transport;
    return validateChanges(await transport.changes(
      this._storedConfiguration.activeChannelId,
      cursor,
      options.limit ?? 200,
    ));
  }

  async getItem(itemId) {
    this._requireConnection();
    validateItemId(itemId);
    const channelId = this._requireChannel();
    return this._transfers.run(async ({transport, cancellable, check}) => {
      const response = await transport.item(channelId, itemId);
      check();
      const remote = validateItem(response, itemId);
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
        const bytes = await transport.preview(
          channelId,
          itemId,
          selected.id,
          maximumBytes,
          selected.mimeType,
          cancellable,
        );
        check();
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
          await writeFile(Gio.File.new_for_path(path), bytes, cancellable);
          check();
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
    }, {errorCode: 'download_failed'});
  }

  async cancelTransfer(transferId) {
    if (!isUuid(transferId))
      throw new Error('Synchronization transfer ID is invalid');
    const publication = this._transfers.get(transferId);
    if (publication?.kind === 'publish' && !TERMINAL_TRANSFER_STATES.has(publication.state))
      this.emit('publication-cancelled', publication.itemId);
    await this._transfers.cancel(transferId);
  }

  async getTransfer(transferId) {
    this._requireConnection();
    const generation = this._generation;
    const transport = this._transport;
    if (!isUuid(transferId))
      throw new Error('Synchronization transfer ID is invalid');
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const transfer = validateTransfer(await transport.transfer(transferId), deviceId);
    if (this._isCurrent(generation))
      this._transfers.observe(transfer);
    return transfer;
  }

  async listTransfers() {
    this._requireConnection();
    const generation = this._generation;
    const transport = this._transport;
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const values = validateTransfers(await transport.transfers(), deviceId);
    if (!this._isCurrent(generation))
      return [];
    for (const transfer of values) {
      this._transfers.observe(transfer);
      this._transfers.record(transfer, true);
    }
    return values;
  }

  async listChannels() {
    this._requireConnection();
    const generation = this._generation;
    const transport = this._transport;
    const channelId = this._storedConfiguration.activeChannelId;
    const channels = validateChannels(await transport.channels(), channelId);
    if (!this._isCurrent(generation))
      return [];
    this._channels = channels;
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
    return this._logger.run('initialize', scope => this._initialize(scope));
  }

  async _initialize(scope) {
    const generation = ++this._generation;
    this._transfers.close(new Error('Synchronization connection was initialized'));
    this._transfers = this._newTransferSession();
    let transport = null;
    let cancellable = null;
    try {
      const configuration = await scope.step('configuration', () => this._configurationStore.load());
      if (!this._isCurrent(generation))
        return;
      this._storedConfiguration = configuration;
      this._applyPublicConfiguration();
      if (!this._isCurrent(generation))
        return;
      if (!configuration.serverAddress || !configuration.apiKey) {
        this._setStatus('offline', null, 'not-configured');
        this._logger.info('not-configured');
        return;
      }

      const progressScope = {
        serverAddress: configuration.serverAddress,
        deviceId: ensureDeviceIdentity(this._settings).deviceId,
      };
      const progress = await scope.step('progress', () => this._progressStore.load(progressScope));
      if (!this._isCurrent(generation))
        return;
      this._progressScope = progressScope;
      this._progress = progress;

      const identity = scope.step('transport', () => {
        this._closeConnection();
        cancellable = new Gio.Cancellable();
        const value = ensureDeviceIdentity(this._settings);
        transport = this._transportFactory(configuration, {deviceId: value.deviceId, cancellable});
        this._cancellable = cancellable;
        this._transport = transport;
        return value;
      });
      const capabilities = await scope.step('status', async () => validateStatus(await transport.status()));
      if (!this._isCurrent(generation))
        return;
      this._capabilities = capabilities;
      this._connected = true;
      const currentDevice = await scope.step('device', async () => validateDevice(await transport.device(), identity.deviceId));
      if (!this._isCurrent(generation))
        return;
      this._devices.set(currentDevice.deviceId, currentDevice);
      await scope.step('profile', () => this._queueProfileUpdate(true));
      if (!this._isCurrent(generation))
        return;
      await scope.step('channels', () => this.listChannels());
      if (!this._isCurrent(generation))
        return;
      if (this._channels.length > 0
          && !this._channels.some(channel => channel.id === this._storedConfiguration.activeChannelId)) {
        this._storedConfiguration.activeChannelId = this._channels[0].id;
        await scope.step('channel-selection', () => this._saveConnection());
        if (!this._isCurrent(generation))
          return;
        await scope.step('channels', () => this.listChannels());
        if (!this._isCurrent(generation))
          return;
      }
      this._applyPublicConfiguration();
      if (!this._isCurrent(generation))
        return;
      await scope.step('transfers', () => this.listTransfers());
      if (!this._isCurrent(generation))
        return;
      let pollError = null;
      try {
        await this._poll();
      } catch (error) {
        pollError = error;
      }
      if (!this._isCurrent(generation))
        return;
      this._ready = true;
      if (pollError) {
        this._setStatus('error', {
          error: pollError.message,
          errorCode: String(pollError.code ?? 'request_failed'),
        }, 'request-failed');
        this._report(pollError);
      } else {
        this._setStatus(capabilities.status, capabilities, 'online');
      }
      this._schedulePoll();
    } catch (error) {
      if (!this._isCurrent(generation))
        return;
      this._closeConnection();
      this._setStatus('error', {
        error: error.message,
        errorCode: String(error.code ?? 'request_failed'),
      }, 'request-failed');
      throw error;
    } finally {
      // Restart/destroy normally close the old session immediately. Never close
      // a newer session when an older asynchronous initialization finishes.
      if (transport && transport !== this._transport && !cancellable.is_cancelled()) {
        cancellable.cancel();
        transport.abort();
      }
    }
  }

  _isCurrent(generation) {
    return !this._destroyed && generation === this._generation;
  }

  _requireCurrent(generation) {
    if (!this._isCurrent(generation))
      throw new Gio.IOErrorEnum({
        code: Gio.IOErrorEnum.CANCELLED,
        message: 'Synchronization operation is no longer current',
      });
  }

  async _publish(item, {guard = () => true, manifest = null, saveManifest = async value => value} = {}) {
    if (item.sensitive)
      throw new SyncError('sensitive_content', 'Sensitive content cannot be synchronized');
    this._requireConnection();
    const generation = this._generation;
    this._requireOperation(generation, guard);
    if (!isUuid(item.id))
      throw new Error('Item ID must be a UUID v4');
    const channelId = this._requireChannel();
    const {deviceId} = ensureDeviceIdentity(this._settings);
    manifest = manifest ? publicationPlan.validate(manifest, {itemId: item.id, deviceId})
      : publicationPlan.create(item, {settings: this._settings, capabilities: this._capabilities, deviceId});
    const preflight = value => {
      const declaredBytes = value.contents.reduce((sum, content) => sum + content.size, 0);
      const itemLimit = effectiveLimit(this._capabilities.maxItemBytes, ABSOLUTE_ITEM_LIMIT_BYTES);
      if (declaredBytes > itemLimit)
        throw new Error(`Synchronization item exceeds the effective limit of ${itemLimit} bytes`);
      return publicationPlan.sources(item, value);
    };
    // Local rejection must not freeze a manifest that has never reached the server.
    preflight(manifest);
    // Freeze before POST: a response can disappear after the server commits it.
    manifest = publicationPlan.validate(await saveManifest(manifest), {itemId: item.id, deviceId});
    this._requireOperation(generation, guard);
    // Persistence may return an existing frozen contract instead of the candidate.
    const sources = preflight(manifest);
    const representations = manifest.contents;

    let completedBytes = 0;
    return this._transfers.run(async ({transport, cancellable, check, track, update}) => {
      const confirm = completed => {
        check();
        if (completed.state !== 'completed')
          throw new SyncError('upload_failed', 'Publication was not confirmed complete by the server');
        // Delivery is a fact about the last confirmed manifest, not capture-time policy.
        for (const representation of representations) {
          const original = item.representations.find(value => value.id === representation.id);
          if (original)
            original.delivery = representation.delivery;
        }
        track({...completed, updatedAt: Math.max(Date.now(), completed.updatedAt)});
        return {itemId: item.id, transferId: completed.transferId};
      };
      const rawPublication = await transport.createItem(channelId, manifest);
      check();
      const publication = validatePublication(rawPublication, item.id);
      const transfer = publication.transfer;
      if (transfer.kind !== 'publish' || transfer.direction !== 'upload')
        throw new Error('Synchronization server returned an invalid publication transfer');
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
      if (transfer.state === 'completed')
        return confirm(transfer);
      track(transfer);
      if (TERMINAL_TRANSFER_STATES.has(transfer.state))
        throw new Error(transfer.errorMessage || `Transfer ${transfer.state}`);
      for (const [key, id, preview] of requested) {
        check();
        const source = sources.get(key);
        const base = completedBytes;
        const progress = bytes => update({
          state: 'transferring',
          completedBytes: Math.min(totalBytes, base + bytes),
          totalBytes,
        });
        if (preview)
          await transport.uploadPreview(publication.uploadId, id, source, progress, cancellable);
        else
          await transport.uploadContent(publication.uploadId, id, source, progress, cancellable);
        check();
        completedBytes += source.size;
      }
      const rawCompleted = await transport.completeUpload(publication.uploadId);
      check();
      const completed = validateTransfer(rawCompleted.transfer, deviceId);
      return confirm(completed);
    }, {guard, errorCode: 'upload_failed'});
  }

  async _materialize(item, {withinThreshold = false} = {}) {
    if (!item.remote)
      return item;
    if (item.representations.every(value => value.bytes || value.path)) {
      item.availability = 'ready';
      return item;
    }
    const needed = item.representations.filter(value => !value.bytes && !value.path
      && (!withinThreshold || delivery(this._settings, value.mimeType, value.size) === 'eager'));
    if (needed.length === 0)
      return item;
    this._requireConnection();
    const generation = this._generation;
    const channelId = this._requireChannel();
    item.availability = 'waiting-for-peer';
    try {
      for (const representation of needed)
        await this._materializeRepresentation(channelId, item, representation, generation);
      this._requireCurrent(generation);
      item.availability = item.representations.every(value => value.bytes || value.path)
        ? 'ready' : 'preview';
      return item;
    } catch (error) {
      this._requireCurrent(generation);
      item.availability = 'failed';
      throw error;
    }
  }

  async _materializeRepresentation(channelId, item, representation, generation) {
    this._requireCurrent(generation);
    if (representation.bytes || representation.path)
      return;
    const key = `${channelId}:${item.id}:${representation.id}`;
    const path = await this._transfers.materialize(key, () =>
      this._requestRepresentation(channelId, item, representation, generation).then(() => representation.path));
    this._requireCurrent(generation);
    representation.path = path;
  }

  async _requestRepresentation(channelId, item, representation, generation) {
    this._requireCurrent(generation);
    const transport = this._transport;
    const {deviceId} = ensureDeviceIdentity(this._settings);
    const response = await transport.requestContent(channelId, item.id, representation.id);
    this._requireCurrent(generation);
    const request = validateContentRequest(
      response,
      deviceId,
    );
    if (request.transfer.kind !== 'content' || request.transfer.direction !== 'download'
        || request.transfer.itemId !== item.id)
      throw new Error('Synchronization server returned an invalid content request transfer');
    this._transfers.observe(request.transfer);
    this._transfers.record(request.transfer, true);
    if (!TERMINAL_TRANSFER_STATES.has(request.transfer.state))
      await this._transfers.wait(request.transfer.transferId);
    else if (request.transfer.state !== 'completed')
      throw new Error(request.transfer.errorMessage || `Transfer ${request.transfer.state}`);
    this._requireCurrent(generation);
    await this._transfers.enqueue(() => this._downloadRepresentation(channelId, item, representation, generation));
    this._requireCurrent(generation);
  }

  async _downloadRepresentation(channelId, item, representation, generation = this._generation) {
    this._requireCurrent(generation);
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
    const targetPath = GLib.build_filenamev([
      devicePaths(item.originDeviceId).objects,
      representation.sha256,
    ]);
    return this._transfers.run(async ({transport, cancellable, check, track, update}) => {
      track(transfer, {remote: false});
      const result = await transport.downloadContent(
        channelId,
        item.id,
        representation.id,
        targetPath,
        {
          maximumBytes: effectiveLimit(this._capabilities.maxItemBytes, ABSOLUTE_ITEM_LIMIT_BYTES),
          expectedBytes: representation.size,
          expectedSha256: representation.sha256,
          mimeType: representation.mimeType,
          useSha256sum: this._settings.get_boolean('sync-use-sha256sum'),
          cancellable,
          onProgress: completedBytes => update({completedBytes}),
          onVerifying: () => update({
            state: 'verifying',
            completedBytes: representation.size,
          }, true),
        },
      );
      check();
      representation.path = result.path;
      update({
        state: 'completed',
        completedBytes: representation.size,
      }, true);
    }, {errorCode: 'download_failed'});
  }

  async _poll() {
    if (this._polling || !this._connected || this._destroyed)
      return;
    this._polling = true;
    const generation = this._generation;
    try {
      const poll = async context => {
        await context.step('changes', () => this._syncChanges());
        if (!this._isCurrent(generation))
          return;
        await context.step('work', () => this._syncWork());
        if (!this._isCurrent(generation))
          return;
        await context.step('transfer-refresh', () => this._refreshActiveTransfers());
      };
      await this._logger.run('poll', poll, {quiet: true});
      if (this._isCurrent(generation) && this._status?.state === 'error')
        this._setStatus(this._capabilities.status, this._capabilities, 'online');
    } catch (error) {
      if (this._isCurrent(generation))
        throw error;
    } finally {
      if (this._isCurrent(generation)) {
        this._polling = false;
        if (this._ready)
          this.emit('poll-completed');
      }
    }
  }

  async _syncChanges() {
    const generation = this._generation;
    const channelId = this._storedConfiguration.activeChannelId;
    if (!channelId)
      return;
    let cursor = this._progress.cursors[channelId] ?? '';
    let hasMore;
    do {
      const page = await this.getChanges(cursor, {limit: 200});
      if (!this._isCurrent(generation))
        return;
      if (page.changes.length > 0)
        await this._applyChanges(page.changes, {isCurrent: () => this._isCurrent(generation)});
      for (const change of page.changes) {
        if (!this._isCurrent(generation))
          return;
        if (change.kind === 'upsert')
          this.emit('item-available', change.itemId);
        else
          this.emit('item-removed', change.itemId, change.reason);
      }
      if (!this._isCurrent(generation))
        return;
      if (page.nextCursor === cursor && page.hasMore)
        throw new Error('Synchronization server returned a non-advancing changes cursor');
      cursor = page.nextCursor;
      await this._saveProgress({...this._progress, cursors: {...this._progress.cursors, [channelId]: cursor}});
      if (!this._isCurrent(generation))
        return;
      hasMore = page.hasMore;
    } while (hasMore);
  }

  async _syncWork() {
    const generation = this._generation;
    const transport = this._transport;
    let cursor = this._progress.workCursor;
    let hasMore;
    do {
      const page = validateWorkPage(await transport.work(cursor));
      if (!this._isCurrent(generation))
        return;
      for (const work of page.work) {
        await this._transfers.enqueue(() => this._performWork(work));
        if (!this._isCurrent(generation))
          return;
      }
      if (page.cursor === cursor && page.hasMore)
        throw new Error('Synchronization server returned a non-advancing work cursor');
      cursor = page.cursor;
      await this._saveProgress({...this._progress, workCursor: cursor});
      if (!this._isCurrent(generation))
        return;
      hasMore = page.hasMore;
    } while (hasMore);
  }

  async _performWork(work) {
    const item = this._sourceItem(work.itemId);
    const representation = item?.representations.find(value => value.id === work.contentId);
    const {deviceId} = ensureDeviceIdentity(this._settings);
    return this._transfers.run(async ({transport, cancellable, check, track, update}) => {
      if (!item || !representation || (!representation.path && !representation.bytes)) {
        await transport.rejectWork(work.id, 'source_content_missing');
        check();
        return;
      }
      const response = await transport.acceptWork(work.id);
      check();
      const accepted = validateAcceptedWork(response, work.itemId, deviceId);
      if (accepted.transfer.kind !== 'content' || accepted.transfer.direction !== 'upload'
          || accepted.transfer.totalBytes !== representation.size)
        throw new Error('Synchronization server returned an inconsistent source upload size');
      track(accepted.transfer);
      if (accepted.transfer.state === 'completed')
        return;
      if (TERMINAL_TRANSFER_STATES.has(accepted.transfer.state))
        throw new Error(accepted.transfer.errorMessage || `Transfer ${accepted.transfer.state}`);
      const source = {
        ...(representation.path ? {path: representation.path} : {bytes: representation.bytes}),
        size: representation.size,
        mimeType: representation.mimeType,
      };
      await transport.uploadContent(
        accepted.uploadId,
        representation.id,
        source,
        completedBytes => update({state: 'transferring', completedBytes}),
        cancellable,
      );
      check();
      const responseCompleted = await transport.completeUpload(accepted.uploadId);
      check();
      const completed = validateTransfer(responseCompleted.transfer, deviceId);
      if (completed.state !== 'completed')
        throw new SyncError('source_upload_failed', 'Source upload was not confirmed complete by the server');
      track({...completed, updatedAt: Math.max(Date.now(), completed.updatedAt)});
    }, {errorCode: 'source_upload_failed'});
  }

  async _refreshActiveTransfers() {
    const generation = this._generation;
    const active = this._transfers.values()
      .filter(value => !TERMINAL_TRANSFER_STATES.has(value.state) && !this._transfers.running(value.transferId));
    for (const current of active) {
      const transfer = await this.getTransfer(current.transferId);
      if (!this._isCurrent(generation))
        return;
      this._transfers.record(transfer, true);
      if (!this._isCurrent(generation))
        return;
    }
  }

  _queueProfileUpdate(force = false) {
    const generation = this._generation;
    const update = this._profileUpdateChain.catch(() => {}).then(() => {
      if (this._isCurrent(generation))
        return this._updateProfile(force);
    });
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
    // Guard the client commit; an already-started store write is not cancellable.
    const generation = this._generation;
    const configuration = await this._configurationStore.saveConnection(
      this._storedConfiguration,
    );
    if (!this._isCurrent(generation))
      return;
    this._storedConfiguration = configuration;
    this._applyPublicConfiguration();
  }

  async _saveProgress(progress) {
    const generation = this._generation;
    const saved = await this._progressStore.save(this._progressScope, progress);
    if (!this._isCurrent(generation))
      return;
    this._progress = saved;
  }

  _schedulePoll() {
    if (this._pollSource || !this._connected || this._destroyed)
      return;
    const generation = this._generation;
    this._pollSource = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._settings.get_uint('sync-poll-interval-seconds') * 1000,
      () => {
        this._poll().catch(error => {
          if (!this._isCurrent(generation))
            return;
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

  _newTransferSession() {
    const generation = this._generation;
    return new TransferSession({
      isCurrent: () => this._isCurrent(generation),
      transport: () => this._transport,
      timeout: () => this._settings.get_uint('sync-transfer-timeout-seconds') * 1000,
      onChange: transfer => this.emit('transfer-changed', transfer),
    });
  }

  _requireConnection() {
    if (!this._connected || !this._transport)
      throw new SyncError('server_unavailable', 'Synchronization server is unavailable');
  }

  _requireOperation(generation, guard) {
    this._requireCurrent(generation);
    if (!guard())
      throw new Gio.IOErrorEnum({
        code: Gio.IOErrorEnum.CANCELLED,
        message: 'Clipboard operation is no longer eligible',
      });
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
      this._logger.error('background', error);
  }

  _resetRuntime(error) {
    this._transfers.close(error);
    if (this._pollSource)
      GLib.Source.remove(this._pollSource);
    this._pollSource = 0;
    this._profileUpdateChain = Promise.resolve();
    this._closeConnection();
    this._polling = false;
  }

  _closeConnection() {
    this._cancellable?.cancel();
    this._transport?.abort();
    this._transport = null;
    this._cancellable = null;
    this._connected = false;
    this._ready = false;
    this._capabilities = null;
    this._devices.clear();
    this._channels = [];
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
    this._applyChanges = null;
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
