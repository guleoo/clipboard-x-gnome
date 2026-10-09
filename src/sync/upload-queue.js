import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {bytesFromString, sha256} from '../common/bytes.js';
import {dataPath, readJson, writeJson} from '../common/data-store.js';
import {createLogger} from '../common/logger.js';
import {isUuid} from '../common/uuid.js';
import {SyncError} from './errors.js';
import {normalizeServerAddress} from './http/client.js';

const VERSION = 1;
const MAX_ENTRIES = 10_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH = 20;

// The outbox stores references, not clipboard snapshots or connection credentials.
export class UploadQueue {
  constructor(settings, {
    directory = dataPath('sync-queues'),
    afterShutdown = null,
    configuration,
    current,
    ready,
    source,
    sourceReady,
    prepare,
    publish,
    clock = () => Date.now(),
    logger = createLogger('upload-queue'),
    onError = () => {},
  } = {}) {
    this._settings = settings;
    this._directory = directory;
    this._configuration = configuration;
    this._current = current;
    this._ready = ready;
    this._source = source;
    this._sourceReady = sourceReady;
    this._prepare = prepare;
    this._publish = publish;
    this._clock = clock;
    this._logger = logger;
    this._onError = onError;
    this._queues = new Map();
    this._chain = Promise.resolve(afterShutdown);
    this._worker = null;
    this._destroyed = false;
  }

  enqueue(item, {automatic = false} = {}) {
    if (this._destroyed || !this._settings.get_boolean('sync-enabled'))
      return Promise.resolve(false);
    const itemId = item?.id;
    const deviceId = this._settings.get_string('device-id');
    const revision = this._settings.get_uint('sync-configuration-revision');
    // Capture an established destination before a queued disk write can yield.
    const established = this._ready() ? {...this._current()} : null;
    // Register accepted work before configuration() can yield. Shutdown must wait
    // for this write even if it starts while the configuration read is pending.
    return this._serialize(async () => {
      if (!isUuid(itemId) || !isUuid(deviceId))
        throw new Error('Synchronization outbox requires UUID item and device IDs');
      if (item.sensitive)
        throw new SyncError('sensitive_content', 'Sensitive content cannot be synchronized');
      const raw = established ?? await this._configuration();
      if (!established && (revision !== this._settings.get_uint('sync-configuration-revision')
          || deviceId !== this._settings.get_string('device-id'))) {
        this._logger.info('enqueue-configuration-changed');
        return false;
      }
      const scope = destination(raw, deviceId);
      const queue = await this._load(scope.serverAddress);
      const key = entryKey({...scope, itemId});
      const previous = queue.entries.get(key);
      if (!previous && queue.entries.size >= MAX_ENTRIES)
        throw new Error('Synchronization outbox is full');
      const entry = {
        ...scope,
        itemId,
        automatic: Boolean(automatic) && (previous?.automatic ?? true),
        attempts: 0,
        retryAt: 0,
        blocked: false,
      };
      queue.entries.set(key, entry);
      try {
        await this._save(queue);
      } catch (error) {
        if (previous)
          queue.entries.set(key, previous);
        else
          queue.entries.delete(key);
        throw error;
      }
      return true;
    });
  }

  flush() {
    if (this._destroyed)
      return Promise.resolve();
    if (!this._worker) {
      this._worker = this._flush().finally(() => {
        this._worker = null;
      });
    }
    return this._worker;
  }

  prune() {
    if (this._destroyed)
      return Promise.resolve();
    // Unloaded servers are checked on their next flush; local clipboard changes
    // need not read connection files or load dormant queues.
    return this._serialize(() => this._pruneLoaded());
  }

  remove(itemId, {currentOnly = false} = {}) {
    if (this._destroyed)
      return Promise.resolve();
    let scope = null;
    if (currentOnly) {
      try {
        scope = destination(this._current(), this._settings.get_string('device-id'));
      } catch (_error) {
        return Promise.resolve();
      }
    }
    return this._serialize(async () => {
      if (scope) {
        await this._load(scope.serverAddress);
      } else {
        const raw = await this._configuration();
        if (raw?.serverAddress)
          await this._load(normalizeServerAddress(raw.serverAddress));
      }
      for (const queue of this._queues.values()) {
        const entries = [...queue.entries.values()].filter(entry => entry.itemId === itemId
          && (!scope || (entry.serverAddress === scope.serverAddress
            && entry.channelId === scope.channelId && entry.deviceId === scope.deviceId)));
        if (entries.length)
          await this._removeEntries(queue, entries);
      }
    });
  }

  destroy() {
    this._destroyed = true;
    // Network/clipboard preparation is deliberately not part of this chain.
    return this._chain;
  }

  _serialize(callback) {
    const operation = this._chain.then(callback);
    this._chain = operation.catch(() => {});
    return operation;
  }

  async _load(serverAddress) {
    if (this._queues.has(serverAddress))
      return this._queues.get(serverAddress);
    const path = GLib.build_filenamev([
      this._directory, `${sha256(bytesFromString(serverAddress))}.json`,
    ]);
    const document = await readJson(path, MAX_FILE_BYTES);
    if (document !== null && (document.version !== VERSION || !Array.isArray(document.entries)
        || document.entries.length > MAX_ENTRIES))
      throw new Error('Synchronization outbox file has an invalid structure');
    const queue = {path, entries: new Map()};
    for (const value of document?.entries ?? []) {
      const entry = validateEntry(value, serverAddress);
      const key = entryKey(entry);
      if (queue.entries.has(key))
        throw new Error('Synchronization outbox contains duplicate entries');
      queue.entries.set(key, entry);
    }
    this._queues.set(serverAddress, queue);
    return queue;
  }

  _save(queue) {
    const document = {version: VERSION, entries: [...queue.entries.values()]};
    if (bytesFromString(`${JSON.stringify(document, null, 2)}\n`).get_size() > MAX_FILE_BYTES)
      throw new Error('Synchronization outbox exceeds its storage size limit');
    return writeJson(queue.path, document);
  }

  async _removeEntries(queue, entries) {
    for (const entry of entries)
      queue.entries.delete(entryKey(entry));
    try {
      await this._save(queue);
    } catch (error) {
      for (const entry of entries)
        queue.entries.set(entryKey(entry), entry);
      throw error;
    }
  }

  async _pruneLoaded() {
    if (this._destroyed || !this._sourceReady())
      return;
    for (const queue of this._queues.values()) {
      if (this._destroyed || !this._sourceReady())
        return;
      const obsolete = [...queue.entries.values()].filter(entry => {
        const item = this._source(entry.itemId);
        return !item || item.sensitive;
      });
      if (obsolete.length)
        await this._removeEntries(queue, obsolete);
    }
  }

  _matches(entry) {
    if (this._destroyed || !this._settings.get_boolean('sync-enabled') || !this._ready())
      return false;
    try {
      const scope = destination(this._current(), this._settings.get_string('device-id'));
      return scope.serverAddress === entry.serverAddress && scope.channelId === entry.channelId
        && scope.deviceId === entry.deviceId;
    } catch (_error) {
      return false;
    }
  }

  _eligible(entry, item) {
    return !entry.blocked && entry.retryAt <= this._clock() && this._matches(entry)
      && (!entry.automatic || (this._settings.get_string('sync-send-mode') === 'automatic'
        && (!this._settings.get_boolean('sync-favorites-only') || item.favorite)));
  }

  async _flush() {
    const work = await this._serialize(async () => {
      if (this._destroyed || !this._settings.get_boolean('sync-enabled') || !this._sourceReady())
        return [];
      const raw = await this._configuration();
      if (this._destroyed || !raw?.serverAddress)
        return [];
      const queue = await this._load(normalizeServerAddress(raw.serverAddress));
      if (this._destroyed)
        return [];
      await this._pruneLoaded();
      return [...queue.entries.values()].filter(entry => {
        const item = this._source(entry.itemId);
        return item && this._eligible(entry, item);
      }).slice(0, MAX_BATCH).map(entry => ({queue, entry}));
    });
    for (const {queue, entry} of work) {
      if (this._destroyed)
        break;
      await this._attempt(queue, entry);
      if (!this._destroyed)
        await yieldToMainLoop();
    }
  }

  async _attempt(queue, entry) {
    const key = entryKey(entry);
    const valid = () => {
      const item = this._source(entry.itemId);
      return queue.entries.get(key) === entry && this._sourceReady()
        && item && !item.sensitive && this._eligible(entry, item);
    };
    if (!valid())
      return;
    try {
      await this._prepare();
      const item = await this._serialize(async () => {
        if (this._destroyed || queue.entries.get(key) !== entry || !this._sourceReady())
          return null;
        const source = this._source(entry.itemId);
        if (!source || source.sensitive) {
          await this._removeEntries(queue, [entry]);
          return null;
        }
        if (!valid())
          return null;
        requireFiles(source);
        return source;
      });
      if (!item || !valid())
        return;
      await this._publish(item, {
        guard: () => valid() && this._source(entry.itemId) === item,
      });
      await this._serialize(async () => {
        if (queue.entries.get(key) === entry && this._matches(entry))
          await this._removeEntries(queue, [entry]);
      });
    } catch (error) {
      if (cancelled(error))
        return;
      await this._serialize(async () => {
        if (queue.entries.get(key) !== entry || !this._matches(entry))
          return;
        const retry = retryable(error);
        const attempts = entry.attempts + 1;
        const replacement = {
          ...entry,
          attempts,
          retryAt: retry ? this._clock() + Math.max(
            Math.min(5000 * 2 ** Math.min(attempts - 1, 4), 60_000),
            this._settings.get_uint('sync-poll-interval-seconds') * 1000,
          ) : 0,
          blocked: !retry,
        };
        queue.entries.set(key, replacement);
        try {
          await this._save(queue);
        } catch (saveError) {
          queue.entries.set(key, entry);
          throw saveError;
        }
        if (entry.attempts === 0 || !retry) {
          this._logger.warn('publish', error);
          this._onError(error);
        }
      });
    }
  }
}

function destination(raw, deviceId) {
  if (!raw?.serverAddress)
    throw new SyncError('invalid_server_address', 'Synchronization server address is not configured');
  if (!isUuid(raw.activeChannelId))
    throw new SyncError('channel_required', 'Synchronization channel is not configured');
  if (!isUuid(deviceId))
    throw new Error('Synchronization device ID is invalid');
  return {
    serverAddress: normalizeServerAddress(raw.serverAddress),
    channelId: raw.activeChannelId,
    deviceId,
  };
}

function entryKey(entry) {
  return `${entry.channelId}:${entry.deviceId}:${entry.itemId}`;
}

function validateEntry(value, serverAddress) {
  if (!value || value.serverAddress !== serverAddress || !isUuid(value.channelId)
      || !isUuid(value.deviceId) || !isUuid(value.itemId) || typeof value.automatic !== 'boolean'
      || typeof value.blocked !== 'boolean' || !Number.isSafeInteger(value.attempts)
      || value.attempts < 0 || !Number.isSafeInteger(value.retryAt) || value.retryAt < 0)
    throw new Error('Synchronization outbox entry is invalid');
  return {
    serverAddress, channelId: value.channelId, deviceId: value.deviceId, itemId: value.itemId,
    automatic: value.automatic, attempts: value.attempts, retryAt: value.retryAt,
    blocked: value.blocked,
  };
}

function requireFiles(item) {
  if (!Array.isArray(item.representations) || item.representations.length === 0
      || item.representations.some(representation => !representation.path
        || !GLib.file_test(representation.path, GLib.FileTest.IS_REGULAR)))
    throw new SyncError('source_content_missing', 'Persisted clipboard content is unavailable');
}

function cancelled(error) {
  return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}

function retryable(error) {
  return ['server_unavailable', 'network_error', 'transfer_expired'].includes(error?.code)
    || [408, 429].includes(error?.status) || (error?.status >= 500 && error?.status <= 599);
}

function yieldToMainLoop() {
  return new Promise(resolve => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
}
