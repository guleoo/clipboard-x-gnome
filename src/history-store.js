import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from './clipboard-item.js';
import {bytesFromString, fileExists, loadFile, stringFromBytes, writeFile} from './core.js';
import {UUID} from './constants.js';

export class HistoryStore {
  constructor() {
    this.rootPath = GLib.build_filenamev([GLib.get_user_cache_dir(), UUID]);
    this.objectsPath = GLib.build_filenamev([this.rootPath, 'objects']);
    this.indexPath = GLib.build_filenamev([this.rootPath, 'history.json']);
  }

  async load(cancellable = null) {
    if (!fileExists(this.indexPath))
      return [];

    const bytes = await loadFile(Gio.File.new_for_path(this.indexPath), cancellable);
    const values = JSON.parse(stringFromBytes(bytes));
    return values.map(value => ClipboardItem.fromJSON(value));
  }

  async save(items, cancellable = null) {
    GLib.mkdir_with_parents(this.objectsPath, 0o700);

    const persistedItems = items.filter(item => !item.sensitive);

    for (const item of persistedItems) {
      for (const representation of item.representations) {
        if (!representation.bytes)
          continue;

        representation.path ??= GLib.build_filenamev([this.objectsPath, representation.sha256]);
        if (!fileExists(representation.path)) {
          await writeFile(
            Gio.File.new_for_path(representation.path),
            representation.bytes,
            cancellable,
          );
        }
      }
    }

    const body = JSON.stringify(persistedItems.map(item => item.toJSON()));
    await writeFile(Gio.File.new_for_path(this.indexPath), bytesFromString(body), cancellable);
    this._removeUnreferencedObjects(persistedItems, cancellable);
  }

  async materialize(item, cancellable = null) {
    for (const representation of item.representations) {
      if (!representation.bytes && representation.path) {
        representation.bytes = await loadFile(
          Gio.File.new_for_path(representation.path),
          cancellable,
        );
      }
    }
    return item;
  }

  _removeUnreferencedObjects(items, cancellable) {
    const referenced = new Set();
    for (const item of items) {
      for (const representation of item.representations) {
        if (representation.path)
          referenced.add(representation.path);
      }
      if (item.preview?.path)
        referenced.add(item.preview.path);
    }

    const directory = Gio.File.new_for_path(this.objectsPath);
    let enumerator;
    try {
      enumerator = directory.enumerate_children(
        Gio.FILE_ATTRIBUTE_STANDARD_NAME,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        cancellable,
      );
      let info;
      while ((info = enumerator.next_file(cancellable))) {
        const child = directory.get_child(info.get_name());
        if (!referenced.has(child.get_path())) {
          try {
            child.delete(cancellable);
          } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
              console.warn(`Clipboard X: unable to remove stale cache object: ${error.message}`);
          }
        }
      }
    } catch (error) {
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        console.warn(`Clipboard X: unable to prune cache: ${error.message}`);
    } finally {
      enumerator?.close(cancellable);
    }
  }
}
