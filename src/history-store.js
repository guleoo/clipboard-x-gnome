import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from './clipboard-item.js';
import {
  ABSOLUTE_ITEM_LIMIT_BYTES,
  ABSOLUTE_PREVIEW_LIMIT_BYTES,
  MAX_ITEM_REPRESENTATIONS,
  UUID,
} from './constants.js';
import {
  bytesFromString,
  diagnosticCode,
  isUuid,
  loadFile,
  sha256,
  stringFromBytes,
  writeFile,
} from './core.js';

const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_STORED_ITEMS = 10_000;
const MAX_PREVIEW_TEXT_LENGTH = 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export class HistoryStore {
  constructor(rootPath = null) {
    this.rootPath = rootPath ?? GLib.build_filenamev([GLib.get_user_cache_dir(), UUID]);
    this.objectsPath = GLib.build_filenamev([this.rootPath, 'objects']);
    this.previewsPath = GLib.build_filenamev([this.rootPath, 'remote-previews']);
    this.indexPath = GLib.build_filenamev([this.rootPath, 'history.json']);
    this._saveChain = Promise.resolve();
    this._saveGeneration = 0;
  }

  async load(cancellable = null) {
    const indexFile = Gio.File.new_for_path(this.indexPath);
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
    const values = JSON.parse(stringFromBytes(bytes));
    if (!Array.isArray(values))
      throw new Error('Clipboard history index must contain an array');

    const items = [];
    for (const value of values.slice(0, MAX_STORED_ITEMS)) {
      try {
        validateStoredItem(value, this.objectsPath, this.previewsPath);
        await validatePreviewFile(value.preview, cancellable);
        items.push(ClipboardItem.fromJSON(value));
      } catch (error) {
        console.warn(`Clipboard X: ignored invalid history entry (${diagnosticCode(error)})`);
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
    GLib.mkdir_with_parents(this.objectsPath, 0o700);
    const persistedItems = items.filter(item => !item.sensitive).slice(0, MAX_STORED_ITEMS);

    for (const item of persistedItems) {
      for (const representation of item.representations) {
        if (representation.size > ABSOLUTE_ITEM_LIMIT_BYTES)
          throw new Error('Clipboard representation exceeds the local persistence limit');
        if (!representation.bytes)
          continue;

        if (!isPathInside(this.objectsPath, representation.path))
          representation.path = GLib.build_filenamev([this.objectsPath, representation.sha256]);
        if (!await pathExists(representation.path, cancellable)) {
          await writeFile(
            Gio.File.new_for_path(representation.path),
            representation.bytes,
            cancellable,
          );
        }
      }
    }

    const body = JSON.stringify(persistedItems.map(item => item.toJSON()));
    if (new TextEncoder().encode(body).length > MAX_INDEX_BYTES)
      throw new Error(`Clipboard history index exceeds ${MAX_INDEX_BYTES} bytes`);
    await writeFile(Gio.File.new_for_path(this.indexPath), bytesFromString(body), cancellable);
    if (generation === this._saveGeneration)
      await this._removeUnreferencedCacheFiles(persistedItems, cancellable);
  }

  async materialize(item, cancellable = null) {
    for (const representation of item.representations) {
      if (representation.bytes || !representation.path)
        continue;
      if (!isPathInside(this.objectsPath, representation.path))
        throw new Error('Clipboard object path is outside the private cache');

      const file = Gio.File.new_for_path(representation.path);
      const info = await queryInfo(file, cancellable);
      if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_is_symlink())
        throw new Error('Clipboard object is not a regular cache file');
      if (info.get_size() !== representation.size || info.get_size() > ABSOLUTE_ITEM_LIMIT_BYTES)
        throw new Error('Clipboard object size does not match its metadata');

      const bytes = await loadFile(file, cancellable);
      if (bytes.get_size() !== representation.size || sha256(bytes) !== representation.sha256)
        throw new Error('Clipboard object failed integrity verification');
      representation.bytes = bytes;
    }
    return item;
  }

  async _removeUnreferencedCacheFiles(items, cancellable) {
    const referenced = new Set();
    for (const item of items) {
      for (const representation of item.representations) {
        if (isPathInside(this.objectsPath, representation.path))
          referenced.add(GLib.canonicalize_filename(representation.path, null));
      }
      if (isPathInside(this.objectsPath, item.preview?.path)
          || isPathInside(this.previewsPath, item.preview?.path))
        referenced.add(GLib.canonicalize_filename(item.preview.path, null));
    }

    await this._pruneDirectory(this.objectsPath, referenced, cancellable);
    await this._pruneDirectory(this.previewsPath, referenced, cancellable);
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
                console.warn(`Clipboard X: unable to remove stale cache object (${diagnosticCode(error)})`);
            }
          }
        }
      }
    } catch (error) {
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
          && !error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        console.warn(`Clipboard X: unable to prune cache (${diagnosticCode(error)})`);
    } finally {
      try {
        enumerator?.close(cancellable);
      } catch (_error) {
        // The enumerator may already have been closed by cancellation.
      }
    }
  }
}

function validateStoredItem(value, objectsPath, previewsPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('entry is not an object');
  if (!isUuid(value.id))
    throw new Error('entry ID is not a UUID v4');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0)
    throw new Error('entry timestamp is invalid');
  if (typeof value.originDeviceId !== 'string'
      || (value.originDeviceId !== '' && !isUuid(value.originDeviceId)))
    throw new Error('origin device ID is invalid');
  if (typeof value.originDeviceTag !== 'string' || value.originDeviceTag.length > 256)
    throw new Error('origin device tag is invalid');
  if (typeof value.favorite !== 'boolean'
      || typeof value.remote !== 'boolean'
      || typeof value.sensitive !== 'boolean'
      || !['ready', 'preview', 'waiting-for-source', 'failed'].includes(value.availability))
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
      throw new Error('representation path is outside the private cache');
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
      if (!isPathInside(objectsPath, value.preview.path)
          && !isPathInside(previewsPath, value.preview.path))
        throw new Error('preview path is outside the private cache');
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
    throw new Error('preview cache file is invalid');
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
