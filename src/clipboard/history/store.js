import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {bytesFromString, sha256, stringFromBytes} from '../../common/bytes.js';
import {createLogger} from '../../common/logger.js';
import {loadFile, writeFile} from '../../common/files.js';
import {isUuid} from '../../common/uuid.js';
import {ClipboardItem} from '../item.js';
import {
  devicePaths,
  legacyRootPath,
  rootPath as defaultRootPath,
} from './paths.js';
import {
  ABSOLUTE_ITEM_LIMIT_BYTES,
  ABSOLUTE_PREVIEW_LIMIT_BYTES,
  MAX_ITEM_REPRESENTATIONS,
} from '../constants.js';

const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_STORED_ITEMS = 10_000;
const MAX_PREVIEW_TEXT_LENGTH = 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const INDEX_VERSION = 1;
const MIGRATION_MARKER = '.cache-migrated-v1';
const logger = createLogger('history');

function ensurePrivateDirectory(path) {
  GLib.mkdir_with_parents(path, 0o700);
  Gio.File.new_for_path(path).set_attribute_uint32(
    Gio.FILE_ATTRIBUTE_UNIX_MODE,
    0o700,
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );
}

export class HistoryStore {
  constructor({rootPath = null, deviceId, legacyPath = undefined} = {}) {
    if (!isUuid(deviceId))
      throw new Error('HistoryStore requires a local DeviceId');
    this.rootPath = rootPath ?? defaultRootPath();
    this.deviceId = deviceId;
    this.legacyPath = legacyPath === undefined
      ? (rootPath === null ? legacyRootPath() : null)
      : legacyPath;
    this._saveChain = Promise.resolve();
    this._saveGeneration = 0;
  }

  directory(deviceId = this.deviceId) {
    return devicePaths(deviceId, this.rootPath);
  }

  async load(cancellable = null) {
    ensurePrivateDirectory(this.rootPath);
    const items = await this._loadDevices(cancellable);
    const markerPath = GLib.build_filenamev([this.rootPath, MIGRATION_MARKER]);
    if (this.legacyPath && !await pathExists(markerPath, cancellable)) {
      let legacyItems = [];
      try {
        legacyItems = await this._loadIndex({
          index: GLib.build_filenamev([this.legacyPath, 'history.json']),
          objects: GLib.build_filenamev([this.legacyPath, 'objects']),
          previews: GLib.build_filenamev([this.legacyPath, 'remote-previews']),
        }, '', cancellable, true);
      } catch (error) {
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
          throw error;
        logger.warn('load-legacy', error);
      }
      const knownIds = new Set(items.map(item => item.id));
      for (const item of legacyItems) {
        if (!knownIds.has(item.id))
          items.push(item);
      }
      if (legacyItems.length > 0)
        await this.save(items, cancellable);
      await writeFile(
        Gio.File.new_for_path(markerPath),
        bytesFromString(`${JSON.stringify({version: 1, migratedAt: Date.now()})}\n`),
        cancellable,
      );
    }
    return items;
  }

  async _loadDevices(cancellable) {
    const items = [];
    const directory = Gio.File.new_for_path(this.rootPath);
    let enumerator;
    try {
      enumerator = await enumerateChildren(directory, cancellable);
      while (true) {
        const infos = await nextFiles(enumerator, cancellable);
        if (infos.length === 0)
          break;
        for (const info of infos) {
          const deviceId = info.get_name();
          if (!isUuid(deviceId))
            continue;
          try {
            items.push(...await this._loadIndex(this.directory(deviceId), deviceId, cancellable));
          } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
              throw error;
            logger.warn('load-device', error);
          }
        }
      }
    } finally {
      try {
        enumerator?.close(cancellable);
      } catch (_error) {
        // The enumerator may already have been closed by cancellation.
      }
    }
    return items;
  }

  async _loadIndex(paths, deviceId, cancellable, legacy = false) {
    const indexFile = Gio.File.new_for_path(paths.index);
    let info;
    try {
      info = await queryInfo(indexFile, cancellable);
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        return [];
      throw error;
    }
    if (info.get_file_type() !== Gio.FileType.REGULAR)
      throw new Error('Clipboard history index is not a regular file');
    if (info.get_size() > MAX_INDEX_BYTES)
      throw new Error(`Clipboard history index exceeds ${MAX_INDEX_BYTES} bytes`);

    const bytes = await loadFile(indexFile, cancellable);
    const document = JSON.parse(stringFromBytes(bytes));
    const values = legacy ? document : document?.items;
    const invalid = legacy
      ? !Array.isArray(values)
      : document?.version !== INDEX_VERSION
        || document?.deviceId !== deviceId
        || !Number.isSafeInteger(document?.updatedAt)
        || document.updatedAt < 0
        || !Array.isArray(values);
    if (invalid)
      throw new Error('Clipboard history index has an invalid structure');

    const items = [];
    for (const value of values.slice(0, MAX_STORED_ITEMS)) {
      try {
        validateStoredItem(
          value,
          paths.objects,
          legacy ? [paths.objects, paths.previews] : [paths.previews],
          legacy ? '' : deviceId,
        );
        await validatePreviewFile(value.preview, cancellable);
        items.push(ClipboardItem.fromJSON(value));
      } catch (error) {
        logger.warn('load-entry', error);
      }
    }
    return items;
  }

  save(items, cancellable = null) {
    const snapshot = [...items];
    const generation = ++this._saveGeneration;
    const run = this._saveChain
      .catch(() => {})
      .then(() => this._save(snapshot, cancellable, generation));
    this._saveChain = run;
    return run;
  }

  async _save(items, cancellable, generation) {
    ensurePrivateDirectory(this.rootPath);
    const persistedItems = items.filter(item => !item.sensitive).slice(0, MAX_STORED_ITEMS);
    const groups = new Map();
    for (const item of persistedItems) {
      const deviceId = item.originDeviceId || this.deviceId;
      if (!isUuid(deviceId))
        throw new Error('Clipboard item origin DeviceId is invalid');
      item.originDeviceId = deviceId;
      const group = groups.get(deviceId) ?? [];
      group.push(item);
      groups.set(deviceId, group);
    }
    const knownDeviceIds = new Set([this.deviceId, ...groups.keys(), ...await this._storedDeviceIds(cancellable)]);
    for (const deviceId of knownDeviceIds)
      await this._saveDevice(deviceId, groups.get(deviceId) ?? [], cancellable, generation);
  }

  async materialize(item, cancellable = null) {
    const paths = this.directory(item.originDeviceId || this.deviceId);
    for (const representation of item.representations) {
      if (representation.bytes || !representation.path)
        continue;
      if (!isPathInside(paths.objects, representation.path))
        throw new Error('Clipboard object path is outside its device storage');

      const file = Gio.File.new_for_path(representation.path);
      const info = await queryInfo(file, cancellable);
      if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_is_symlink())
        throw new Error('Clipboard object is not a regular history file');
      if (info.get_size() !== representation.size || info.get_size() > ABSOLUTE_ITEM_LIMIT_BYTES)
        throw new Error('Clipboard object size does not match its metadata');

      const bytes = await loadFile(file, cancellable);
      if (bytes.get_size() !== representation.size || sha256(bytes) !== representation.sha256)
        throw new Error('Clipboard object failed integrity verification');
      representation.bytes = bytes;
    }
    return item;
  }

  async _saveDevice(deviceId, items, cancellable, generation) {
    const paths = this.directory(deviceId);
    ensurePrivateDirectory(paths.objects);
    ensurePrivateDirectory(paths.previews);
    for (const item of items) {
      for (const representation of item.representations)
        await this._persistRepresentation(item, representation, paths.objects, cancellable);
      await this._persistPreview(item.preview, paths.previews, cancellable);
    }
    const document = {
      version: INDEX_VERSION,
      deviceId,
      updatedAt: Date.now(),
      items: items.map(item => item.toJSON()),
    };
    const body = JSON.stringify(document);
    if (new TextEncoder().encode(body).length > MAX_INDEX_BYTES)
      throw new Error(`Clipboard history index exceeds ${MAX_INDEX_BYTES} bytes`);
    await writeFile(Gio.File.new_for_path(paths.index), bytesFromString(body), cancellable);
    if (generation === this._saveGeneration)
      await this._removeUnreferencedFiles(items, paths, cancellable);
  }

  async _persistRepresentation(item, representation, objectsPath, cancellable) {
    if (representation.size > ABSOLUTE_ITEM_LIMIT_BYTES)
      throw new Error('Clipboard representation exceeds the local persistence limit');
    const targetPath = GLib.build_filenamev([objectsPath, representation.sha256]);
    if (await pathExists(targetPath, cancellable)) {
      representation.path = targetPath;
      return;
    }

    if (!representation.bytes && !representation.path) {
      if (item.remote && item.availability !== 'ready')
        return;
      throw new Error('Local clipboard representation has no content to persist');
    }

    const bytes = representation.bytes
      ?? await this._loadManagedFile(
        representation.path,
        representation.size,
        representation.sha256,
        cancellable,
      );
    await writeFile(Gio.File.new_for_path(targetPath), bytes, cancellable);
    representation.path = targetPath;
  }

  async _persistPreview(preview, previewsPath, cancellable) {
    if (!preview?.path)
      return;
    const targetPath = GLib.build_filenamev([previewsPath, preview.sha256]);
    if (!await pathExists(targetPath, cancellable)) {
      const bytes = await this._loadManagedFile(
        preview.path,
        preview.size,
        preview.sha256,
        cancellable,
      );
      await writeFile(Gio.File.new_for_path(targetPath), bytes, cancellable);
    }
    preview.path = targetPath;
  }

  async _loadManagedFile(path, size, expectedHash, cancellable) {
    if (!this._isManagedPath(path))
      throw new Error('Clipboard content path is outside managed storage');
    const file = Gio.File.new_for_path(path);
    const info = await queryInfo(file, cancellable);
    if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_is_symlink()
        || info.get_size() !== size)
      throw new Error('Clipboard content file does not match its metadata');
    const bytes = await loadFile(file, cancellable);
    if (sha256(bytes) !== expectedHash)
      throw new Error('Clipboard content failed integrity verification');
    return bytes;
  }

  _isManagedPath(path) {
    if (typeof path !== 'string' || !path)
      return false;
    const root = `${GLib.canonicalize_filename(this.rootPath, null)}${GLib.DIR_SEPARATOR_S}`;
    const candidate = GLib.canonicalize_filename(path, null);
    if (candidate.startsWith(root)) {
      const parts = candidate.slice(root.length).split(GLib.DIR_SEPARATOR_S);
      return parts.length === 3 && isUuid(parts[0])
        && ['objects', 'previews'].includes(parts[1]) && parts[2].length > 0;
    }
    if (!this.legacyPath)
      return false;
    return isPathInside(GLib.build_filenamev([this.legacyPath, 'objects']), candidate)
      || isPathInside(GLib.build_filenamev([this.legacyPath, 'remote-previews']), candidate);
  }

  async _storedDeviceIds(cancellable) {
    const ids = [];
    const enumerator = await enumerateChildren(Gio.File.new_for_path(this.rootPath), cancellable);
    try {
      while (true) {
        const infos = await nextFiles(enumerator, cancellable);
        if (infos.length === 0)
          break;
        ids.push(...infos.map(info => info.get_name()).filter(isUuid));
      }
    } finally {
      enumerator.close(cancellable);
    }
    return ids;
  }

  async _removeUnreferencedFiles(items, paths, cancellable) {
    const referenced = new Set();
    for (const item of items) {
      for (const representation of item.representations) {
        if (isPathInside(paths.objects, representation.path))
          referenced.add(GLib.canonicalize_filename(representation.path, null));
      }
      if (isPathInside(paths.previews, item.preview?.path))
        referenced.add(GLib.canonicalize_filename(item.preview.path, null));
    }

    await this._pruneDirectory(paths.objects, referenced, cancellable);
    await this._pruneDirectory(paths.previews, referenced, cancellable);
  }

  async _pruneDirectory(path, referenced, cancellable) {
    const directory = Gio.File.new_for_path(path);
    let enumerator;
    try {
      enumerator = await enumerateChildren(directory, cancellable);
      while (true) {
        const infos = await nextFiles(enumerator, cancellable);
        if (infos.length === 0)
          break;
        for (const info of infos) {
          const child = directory.get_child(info.get_name());
          if (!referenced.has(GLib.canonicalize_filename(child.get_path(), null))) {
            try {
              await deleteFile(child, cancellable);
            } catch (error) {
              if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                logger.warn('remove-stale-object', error);
            }
          }
        }
      }
    } catch (error) {
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
          && !error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        logger.warn('prune', error);
    } finally {
      try {
        enumerator?.close(cancellable);
      } catch (_error) {
        // The enumerator may already have been closed by cancellation.
      }
    }
  }
}

function validateStoredItem(value, objectsPath, previewPaths, expectedDeviceId = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('entry is not an object');
  if (!isUuid(value.id))
    throw new Error('entry ID is not a UUID v4');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0)
    throw new Error('entry timestamp is invalid');
  if (typeof value.originDeviceId !== 'string'
      || (value.originDeviceId !== '' && !isUuid(value.originDeviceId)))
    throw new Error('origin device ID is invalid');
  if (expectedDeviceId && value.originDeviceId !== expectedDeviceId)
    throw new Error('origin device ID does not match its history directory');
  if (typeof value.originDeviceTag !== 'string' || value.originDeviceTag.length > 256)
    throw new Error('origin device tag is invalid');
  value.originDeviceIconKind ??= 'computer';
  if (typeof value.originDeviceIconKind !== 'string' || !value.originDeviceIconKind
      || value.originDeviceIconKind.length > 128 || /[\r\n\0]/u.test(value.originDeviceIconKind))
    throw new Error('origin device icon kind is invalid');
  if (typeof value.favorite !== 'boolean'
      || typeof value.remote !== 'boolean'
      || typeof value.sensitive !== 'boolean'
      || !['ready', 'preview', 'waiting-for-source', 'waiting-for-peer', 'failed'].includes(value.availability))
    throw new Error('entry state is invalid');
  if (!Array.isArray(value.representations)
      || value.representations.length === 0
      || value.representations.length > MAX_ITEM_REPRESENTATIONS)
    throw new Error('representation count is invalid');

  const contentIds = new Set();
  for (const representation of value.representations) {
    if (!representation || typeof representation !== 'object')
      throw new Error('representation is invalid');
    if (typeof representation.id !== 'string' || representation.id.length === 0 || representation.id.length > 128)
      throw new Error('content ID is invalid');
    if (contentIds.has(representation.id))
      throw new Error('content ID is duplicated');
    contentIds.add(representation.id);
    if (!isMimeType(representation.mimeType))
      throw new Error('MIME type is invalid');
    if (!Number.isSafeInteger(representation.size)
        || representation.size < 0
        || representation.size > ABSOLUTE_ITEM_LIMIT_BYTES)
      throw new Error('representation size is invalid');
    if (!SHA256_PATTERN.test(representation.sha256))
      throw new Error('representation hash is invalid');
    if (!['eager', 'on-demand'].includes(representation.delivery))
      throw new Error('delivery policy is invalid');
    if (representation.path !== null && !isPathInside(objectsPath, representation.path))
      throw new Error('representation path is outside its device storage');
  }

  if (value.preview !== null) {
    if (!value.preview || typeof value.preview !== 'object' || !isMimeType(value.preview.mimeType))
      throw new Error('preview is invalid');
    if (!contentIds.has(value.preview.derivedFrom) || typeof value.preview.truncated !== 'boolean')
      throw new Error('preview derivation is invalid');
    if (value.preview.text !== undefined
        && (typeof value.preview.text !== 'string' || value.preview.text.length > MAX_PREVIEW_TEXT_LENGTH))
      throw new Error('preview text is invalid');
    if (value.preview.path !== undefined && value.preview.path !== null) {
      if (!previewPaths.some(path => isPathInside(path, value.preview.path)))
        throw new Error('preview path is outside its device storage');
      if (!Number.isSafeInteger(value.preview.size)
          || value.preview.size < 0
          || value.preview.size > ABSOLUTE_PREVIEW_LIMIT_BYTES
          || !SHA256_PATTERN.test(value.preview.sha256 ?? ''))
        throw new Error('preview file metadata is invalid');
    }
  }
}

async function validatePreviewFile(preview, cancellable) {
  if (!preview?.path)
    return;
  const info = await queryInfo(Gio.File.new_for_path(preview.path), cancellable);
  if (info.get_file_type() !== Gio.FileType.REGULAR
      || info.get_is_symlink()
      || info.get_size() !== preview.size)
    throw new Error('preview history file is invalid');
  const bytes = await loadFile(Gio.File.new_for_path(preview.path), cancellable);
  if (sha256(bytes) !== preview.sha256)
    throw new Error('preview history file failed integrity verification');
}

function isMimeType(value) {
  return typeof value === 'string'
    && value.length <= 255
    && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[^\r\n]{1,128})?$/iu.test(value);
}

function isPathInside(parentPath, candidatePath) {
  if (typeof candidatePath !== 'string' || !candidatePath)
    return false;
  const parent = `${GLib.canonicalize_filename(parentPath, null)}${GLib.DIR_SEPARATOR_S}`;
  const candidate = GLib.canonicalize_filename(candidatePath, null);
  return candidate.startsWith(parent);
}

function queryInfo(file, cancellable) {
  return new Promise((resolve, reject) => {
    file.query_info_async(
      `${Gio.FILE_ATTRIBUTE_STANDARD_TYPE},${Gio.FILE_ATTRIBUTE_STANDARD_SIZE},${Gio.FILE_ATTRIBUTE_STANDARD_IS_SYMLINK}`,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      cancellable,
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

async function pathExists(path, cancellable) {
  try {
    await queryInfo(Gio.File.new_for_path(path), cancellable);
    return true;
  } catch (error) {
    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
      return false;
    throw error;
  }
}

function enumerateChildren(directory, cancellable) {
  return new Promise((resolve, reject) => {
    directory.enumerate_children_async(
      Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          resolve(source.enumerate_children_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function nextFiles(enumerator, cancellable) {
  return new Promise((resolve, reject) => {
    enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
      try {
        resolve(source.next_files_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function deleteFile(file, cancellable) {
  return new Promise((resolve, reject) => {
    file.delete_async(GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
      try {
        source.delete_finish(result);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}
