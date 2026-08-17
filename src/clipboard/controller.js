import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {ClipboardItem} from './item.js';
import {ABSOLUTE_ITEM_LIMIT_BYTES, ClipboardMimeTypes, SensitiveClipboardMimeTypes} from './constants.js';
import {search as searchHistory} from './history/search.js';
import {HistoryStore} from './history/store.js';
import {delivery} from '../sync/policy.js';
import {EventEmitter} from '../common/event-emitter.js';
import {createThumbnail} from './thumbnail.js';
import {sha256} from '../common/bytes.js';
import {diagnosticCode} from '../common/errors.js';
import {loadFile, writeFile} from '../common/files.js';
import {ensureDeviceIdentity} from '../sync/device.js';

const CLIPBOARD = St.ClipboardType.CLIPBOARD;

export class ClipboardController extends EventEmitter {
  constructor(settings) {
    super();
    this._settings = settings;
    this._clipboard = St.Clipboard.get_default();
    this._store = new HistoryStore();
    this._items = [];
    this._selection = null;
    this._selectionSignal = 0;
    this._settingsSignals = [];
    this._saveTimeout = 0;
    this._captureInProgress = false;
    this._captureQueued = false;
    this._destroyed = false;
    this._suppressedHash = null;
    this._searchCache = new WeakMap();
    this._cancellable = new Gio.Cancellable();
    this._loading = true;
    this._error = null;
  }

  get items() {
    return [...this._items];
  }

  get loading() {
    return this._loading;
  }

  get error() {
    return this._error;
  }

  async start() {
    try {
      this._items = await this._store.load(this._cancellable);
      this._trim();
    } catch (error) {
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        this._error = error;
        console.error(`Clipboard X: unable to load history (${diagnosticCode(error)})`);
      }
    } finally {
      this._loading = false;
      this.emit('changed');
    }

    if (this._destroyed)
      return;

    this._selection = Shell.Global.get().display.get_selection();
    this._selectionSignal = this._selection.connect(
      'owner-changed',
      (_selection, selectionType) => {
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
          if (this._captureInProgress) {
            this._captureQueued = true;
            return;
          }
          this.capture().catch(error => console.error(`Clipboard X: capture failed (${diagnosticCode(error)})`));
        }
      },
    );
    for (const key of ['history-size', 'cache-size-mib', 'history-retention-days']) {
      this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => {
        this._trim();
        this._scheduleSave();
        this.emit('changed');
      }));
    }
  }

  async capture() {
    if (this._destroyed || this._captureInProgress || this._settings.get_boolean('private-mode'))
      return null;

    const focusedWindow = Shell.Global.get().display.focusWindow;
    const appName = focusedWindow?.get_wm_class?.();
    if (appName && this._isExcludedApp(appName))
      return null;

    this._captureInProgress = true;
    try {
      const availableMimeTypes = this._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
      const sensitive = SensitiveClipboardMimeTypes.some(mimeType => availableMimeTypes.includes(mimeType));
      const sensitiveMode = this._settings.get_string('sensitive-content-mode');
      if (sensitive && sensitiveMode === 'discard')
        return null;

      const values = [];
      const seenMimeTypes = new Set();
      let hasImage = false;
      for (const mimeType of ClipboardMimeTypes) {
        if (!availableMimeTypes.includes(mimeType))
          continue;
        const normalizedMimeType = mimeType === 'UTF8_STRING' || mimeType === 'STRING' || mimeType === 'text/plain'
          ? 'text/plain;charset=utf-8'
          : mimeType;
        if (seenMimeTypes.has(normalizedMimeType) || (normalizedMimeType.startsWith('image/') && hasImage))
          continue;
        let bytes;
        try {
          bytes = await this._readSelectionContent(mimeType, this._captureLimitBytes());
        } catch (error) {
          if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.warn(`Clipboard X: rejected ${normalizedMimeType} representation (${diagnosticCode(error)})`);
          continue;
        }
        if (!bytes || bytes.get_size() === 0)
          continue;
        seenMimeTypes.add(normalizedMimeType);
        hasImage ||= normalizedMimeType.startsWith('image/');
        values.push({mimeType, bytes});
      }
      if (values.length === 0)
        return null;

      const identity = ensureDeviceIdentity(this._settings);
      const item = ClipboardItem.fromRepresentations(values, {
        textPreviewLimit: this._settings.get_uint('text-preview-limit'),
        originDeviceId: identity.deviceId,
        originDeviceTag: identity.deviceTag,
        originDeviceIconKind: identity.deviceIconKind,
        sensitive: sensitive && sensitiveMode !== 'store',
      });

      if (this._suppressedHash) {
        const suppressed = this._suppressedHash;
        this._suppressedHash = null;
        if (item.primary.sha256 === suppressed.hash && Date.now() <= suppressed.until)
          return null;
      }

      await this._prepareItem(item);
      if (this._destroyed)
        return null;
      return this.add(item, 'local');
    } finally {
      this._captureInProgress = false;
      if (this._captureQueued && !this._destroyed) {
        this._captureQueued = false;
        this.capture().catch(error => console.error(`Clipboard X: queued capture failed (${diagnosticCode(error)})`));
      }
    }
  }

  async addFromUri(uri, source = 'screenshot') {
    const item = await this.createFromUri(uri);
    this.add(item, source);
    return item;
  }

  async createFromUri(uri) {
    const file = Gio.File.new_for_uri(uri);
    if (!file.is_native())
      throw new Error('Screenshot Portal returned a non-local URI');
    const info = await this._queryInfo(file);
    if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_is_symlink())
      throw new Error('Screenshot Portal result is not a regular file');
    if (info.get_size() > this._captureLimitBytes())
      throw new Error('Screenshot exceeds the configured capture limit');
    const bytes = await loadFile(file, this._cancellable);
    const mimeType = info.get_content_type() || 'image/png';
    const identity = ensureDeviceIdentity(this._settings);
    const item = ClipboardItem.fromBytes(mimeType, bytes, {
      textPreviewLimit: this._settings.get_uint('text-preview-limit'),
      originDeviceId: identity.deviceId,
      originDeviceTag: identity.deviceTag,
      originDeviceIconKind: identity.deviceIconKind,
    });
    await this._prepareItem(item);
    return item;
  }

  add(item, source = 'remote') {
    if (this._destroyed)
      return item;
    const existingIndex = this._items.findIndex(existing => existing.equals(item));
    if (existingIndex >= 0) {
      const [existing] = this._items.splice(existingIndex, 1);
      existing.createdAt = Date.now();
      this._items.unshift(existing);
      this._scheduleSave();
      this.emit('changed');
      return existing;
    }

    this._items.unshift(item);
    this._trim();
    this._scheduleSave();
    this.emit('item-added', item, source);
    this.emit('changed');
    return item;
  }

  remove(itemId) {
    const index = this._items.findIndex(item => item.id === itemId);
    if (index < 0)
      return;
    this._items.splice(index, 1);
    this._scheduleSave();
    this.emit('changed');
  }

  toggleFavorite(itemId) {
    const item = this._items.find(candidate => candidate.id === itemId);
    if (!item)
      return;
    item.favorite = !item.favorite;
    this._items.sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.createdAt - left.createdAt);
    this._scheduleSave();
    this.emit('favorite-changed', item, item.favorite);
    this.emit('changed');
  }

  update(item) {
    if (!this._items.includes(item) || this._destroyed)
      return;
    this._scheduleSave();
    this.emit('changed');
  }

  clear() {
    this._items = this._items.filter(item => item.favorite);
    this._scheduleSave();
    this.emit('changed');
  }

  async activate(item) {
    await this._store.materialize(item, this._cancellable);
    if (!item.primary?.bytes)
      throw new Error('Clipboard content is not materialized');

    this._suppressedHash = {hash: item.primary.sha256, until: Date.now() + 2000};
    this._clipboard.set_content(CLIPBOARD, item.primary.mimeType, item.primary.bytes);
  }

  async writeScreenshot(item) {
    await this.activate(item);
  }

  search(query, limit = Infinity) {
    return searchHistory(this._items, query, limit, this._searchCache);
  }

  async materialize(item) {
    return this._store.materialize(item, this._cancellable);
  }

  async persist() {
    await this._store.save(this._items, this._cancellable);
  }

  async _prepareItem(item) {
    for (const representation of item.representations) {
      representation.delivery = delivery(this._settings, representation.mimeType, representation.size);
    }

    if (!item.isImage || item.sensitive || item.primary.mimeType === 'image/svg+xml')
      return;

    const representation = item.primary;

    try {
      const thumbnail = await createThumbnail(
        representation.bytes,
        this._settings.get_uint('thumbnail-size'),
        this._settings.get_uint('thumbnail-byte-limit'),
        this._cancellable,
      );
      const digest = sha256(thumbnail.bytes);
      const previewPath = GLib.build_filenamev([this._store.objectsPath, `preview-${digest}.png`]);
      GLib.mkdir_with_parents(this._store.objectsPath, 0o700);
      await writeFile(Gio.File.new_for_path(previewPath), thumbnail.bytes, this._cancellable);
      item.preview = {
        mimeType: thumbnail.mimeType,
        path: previewPath,
        size: thumbnail.bytes.get_size(),
        width: thumbnail.width,
        height: thumbnail.height,
        sha256: digest,
        truncated: true,
        derivedFrom: representation.id,
      };
    } catch (error) {
      console.warn(`Clipboard X: thumbnail unavailable (${diagnosticCode(error)})`);
    }
  }

  _readSelectionContent(mimeType, maximumBytes) {
    return new Promise((resolve, reject) => {
      const output = Gio.MemoryOutputStream.new_resizable();
      this._selection.transfer_async(
        Meta.SelectionType.SELECTION_CLIPBOARD,
        mimeType,
        maximumBytes + 1,
        output,
        this._cancellable,
        (selection, result) => {
          try {
            if (!selection.transfer_finish(result))
              throw new Error(`Unable to transfer clipboard MIME type ${mimeType}`);
            output.close(null);
            const bytes = output.steal_as_bytes();
            if (bytes.get_size() > maximumBytes)
              throw new Error(`Clipboard content exceeds the ${maximumBytes} byte capture limit`);
            resolve(bytes);
          } catch (error) {
            try {
              output.close(null);
            } catch (_closeError) {
              // The stream may already be closed after a successful transfer.
            }
            reject(error);
          }
        },
      );
    });
  }

  _isExcludedApp(appName) {
    const normalized = appName.toLocaleLowerCase();
    return this._settings.get_strv('excluded-apps')
      .some(value => value.trim().toLocaleLowerCase() === normalized);
  }

  _captureLimitBytes() {
    return Math.min(
      ABSOLUTE_ITEM_LIMIT_BYTES,
      this._settings.get_int('capture-size-limit-mib') * 1024 * 1024,
    );
  }

  _queryInfo(file) {
    return new Promise((resolve, reject) => {
      file.query_info_async(
        [
          Gio.FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
          Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
          Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
          Gio.FILE_ATTRIBUTE_STANDARD_IS_SYMLINK,
        ].join(','),
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        GLib.PRIORITY_DEFAULT,
        this._cancellable,
        (source, result) => {
          try {
            resolve(source.query_info_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }

  _trim() {
    const limit = this._settings.get_int('history-size');
    const retentionDays = this._settings.get_int('history-retention-days');
    const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86_400_000 : 0;
    const favorites = this._items.filter(item => item.favorite);
    const regular = this._items
      .filter(item => !item.favorite && (!cutoff || item.createdAt >= cutoff))
      .slice(0, limit);
    this._items = [...favorites, ...regular];

    const maxBytes = this._settings.get_int('cache-size-mib') * 1024 * 1024;
    let currentBytes = this._items.reduce((sum, item) => sum + localItemSize(item), 0);
    for (let index = this._items.length - 1; index >= 0 && currentBytes > maxBytes; index--) {
      const item = this._items[index];
      if (item.favorite)
        continue;
      currentBytes -= localItemSize(item);
      this._items.splice(index, 1);
    }
  }

  _scheduleSave() {
    if (this._destroyed)
      return;
    if (this._saveTimeout)
      clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = 0;
      this._store.save(this._items, this._cancellable)
        .catch(error => console.error(`Clipboard X: unable to save history (${diagnosticCode(error)})`));
    }, 150);
  }

  destroy() {
    this._destroyed = true;
    if (this._saveTimeout)
      clearTimeout(this._saveTimeout);
    if (this._selectionSignal)
      this._selection.disconnect(this._selectionSignal);
    this._selectionSignal = 0;
    this._selection = null;
    for (const signal of this._settingsSignals)
      this._settings.disconnect(signal);
    this._settingsSignals = [];
    this._cancellable.cancel();
    this.disconnectAll();
    this._items = [];
    this._searchCache = new WeakMap();
  }
}

function localItemSize(item) {
  const representationBytes = item.representations.reduce(
    (sum, representation) => sum + (representation.path || representation.bytes ? representation.size : 0),
    0,
  );
  return representationBytes + (item.preview?.path ? item.preview.size ?? 0 : 0);
}
