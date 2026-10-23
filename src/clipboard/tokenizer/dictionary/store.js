import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {loadFile, writeFile} from '../../../common/files.js';
import {createLogger} from '../../../common/logger.js';
import {parseDictionaryAsync, serializeDictionary} from './format.js';
import {localeCandidates, SYSTEM_DICTIONARY_ID} from './locale.js';
import {Lexicon} from './lexicon.js';

const FILE_PATTERN = /^([a-z]{2,3}(?:_[a-z0-9]{2,8})*)--[a-z0-9-]+\.dict$/u;
const MAXIMUM_IMPORT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_IMPORT_ENTRIES = 150_000;
const MAXIMUM_ACTIVE_ENTRIES = 200_000;
const logger = createLogger('dictionary');

function decode(contents) {
  return new TextDecoder().decode(contents).replace(/^\uFEFF/u, '');
}

async function ensureDirectory(directory, cancellable) {
  try {
    await io(directory, 'make_directory', [], cancellable);
  } catch (error) {
    if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
      return;
    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) || !directory.get_parent())
      throw error;
    await ensureDirectory(directory.get_parent(), cancellable);
    await ensureDirectory(directory, cancellable);
  }
}

function io(object, operation, args, cancellable = null) {
  return new Promise((resolve, reject) => {
    object[`${operation}_async`](...args, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
      try {
        resolve(source[`${operation}_finish`](result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function loadText(file, cancellable) {
  return decode((await loadFile(file, cancellable)).get_data());
}

function checkpoint(cancellable) {
  if (cancellable?.is_cancelled())
    return Promise.reject(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Dictionary loading cancelled'));
  let signal = 0;
  let source = 0;
  return new Promise((resolve, reject) => {
    source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      source = 0;
      resolve();
      return GLib.SOURCE_REMOVE;
    });
    if (cancellable) {
      signal = cancellable.connect(() => {
        if (source)
          GLib.Source.remove(source);
        source = 0;
        reject(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Dictionary loading cancelled'));
      });
    }
  }).finally(() => {
    if (signal)
      cancellable.disconnect(signal);
    if (source)
      GLib.Source.remove(source);
  });
}

async function parse(file, defaults, cancellable) {
  return parseDictionaryAsync(await loadText(file, cancellable), defaults, {
    checkpoint: () => checkpoint(cancellable),
  });
}

function checksum(value) {
  const digest = GLib.Checksum.new(GLib.ChecksumType.SHA256);
  digest.update(value);
  return digest.get_string().slice(0, 24);
}

function validateNetworkLocation(uri) {
  const normalized = String(uri ?? '').trim();
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/iu.test(normalized))
    throw new Error('Network dictionary location must use HTTP or HTTPS');
  return normalized;
}

export class DictionaryStore {
  constructor({rootPath = ''} = {}) {
    const path = rootPath || GLib.build_filenamev([
      GLib.get_user_data_dir(),
      'clipboard-x-gnome',
      'dictionaries',
    ]);
    this._root = Gio.File.new_for_path(path);
  }

  get path() {
    return this._root.get_path();
  }

  getFile(fileName) {
    if (!FILE_PATTERN.test(fileName))
      throw new Error('Invalid dictionary filename');
    return this._root.get_child(fileName);
  }

  async watch(onChanged, cancellable = null) {
    await ensureDirectory(this._root, cancellable);
    cancellable?.set_error_if_cancelled();
    // Monitor the directory, not individual files: editors commonly save by
    // renaming a temporary file over the original dictionary.
    const monitor = this._root.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, cancellable);
    const signal = monitor.connect('changed', (_monitor, file, otherFile) => {
      if (FILE_PATTERN.test(file.get_basename())
          || (otherFile && FILE_PATTERN.test(otherFile.get_basename())))
        onChanged();
    });
    return () => {
      monitor.disconnect(signal);
      monitor.cancel();
    };
  }

  async list(cancellable = null) {
    await ensureDirectory(this._root, cancellable);
    const dictionaries = [];
    for (const file of await this._dictionaryFiles(cancellable)) {
      try {
        const fileName = file.get_basename();
        const locale = fileName.match(FILE_PATTERN)?.[1] ?? '';
        const parsed = await parse(file, {
          locale,
          name: fileName.replace(/\.dict$/u, ''),
        }, cancellable);
        dictionaries.push({
          fileName,
          // Import fixes the language in the filename; editable headers cannot reassign it.
          locale,
          name: parsed.name,
          source: parsed.source,
          entryCount: parsed.entries.length,
        });
      } catch (error) {
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
          throw error;
        logger.error('load-dictionary', error);
      }
    }
    return dictionaries.sort((left, right) => left.locale.localeCompare(right.locale)
      || left.name.localeCompare(right.name));
  }

  async load(languageNames, selectedFiles = [], cancellable = null) {
    await ensureDirectory(this._root, cancellable);
    const locales = new Set(localeCandidates(languageNames));
    if (locales.size === 0)
      return {lexicon: new Lexicon(), systemEnabled: true};
    const lexicon = new Lexicon([], MAXIMUM_ACTIVE_ENTRIES);
    const files = (await this._dictionaryFiles(cancellable))
      .sort((left, right) => left.get_basename().localeCompare(right.get_basename()))
      .filter(file => locales.has(file.get_basename().match(FILE_PATTERN)?.[1]));
    const enabled = new Set(selectedFiles);
    const systemEnabled = enabled.size === 0 || enabled.has(SYSTEM_DICTIONARY_ID);
    let selected = enabled.size === 0
      ? files
      : files.filter(file => enabled.has(file.get_basename()));
    if (selected.length === 0)
      return {lexicon, systemEnabled};
    for (const file of selected) {
      const locale = file.get_basename().match(FILE_PATTERN)?.[1];
      try {
        const dictionary = await parse(file, {
          locale,
          name: file.get_basename(),
        }, cancellable);
        for (let offset = 0; offset < dictionary.entries.length; offset += 512) {
          await checkpoint(cancellable);
          lexicon.add(dictionary.entries.slice(offset, offset + 512));
        }
      } catch (error) {
        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
          throw error;
        logger.error('load-dictionary', error);
      }
    }
    return {lexicon, systemEnabled};
  }

  async importFile(file, defaultLocale) {
    await ensureDirectory(this._root);
    const bytes = await loadFile(file);
    if (bytes.get_size() > MAXIMUM_IMPORT_BYTES)
      throw new Error('Dictionary exceeds the 8 MB import limit');
    const basename = file.get_basename();
    const parsed = await parseDictionaryAsync(decode(bytes.get_data()), {
      locale: defaultLocale,
      name: basename.replace(/\.[^.]+$/u, ''),
    }, {checkpoint: () => checkpoint()});
    if (parsed.entries.length > MAXIMUM_IMPORT_ENTRIES)
      throw new Error(`Dictionary exceeds the ${MAXIMUM_IMPORT_ENTRIES} entry import limit`);
    const fileName = `${parsed.locale}--${GLib.uuid_string_random()}.dict`;
    await writeFile(
      this._root.get_child(fileName),
      new GLib.Bytes(new TextEncoder().encode(serializeDictionary(parsed))),
    );
    return {
      fileName,
      locale: parsed.locale,
      name: parsed.name,
      source: '',
      entryCount: parsed.entries.length,
    };
  }

  async refreshSource(uri, defaultLocale) {
    const source = validateNetworkLocation(uri);
    await ensureDirectory(this._root);
    const bytes = await loadFile(Gio.File.new_for_uri(source));
    if (bytes.get_size() > MAXIMUM_IMPORT_BYTES)
      throw new Error('Dictionary exceeds the 8 MB import limit');
    const parsed = await parseDictionaryAsync(decode(bytes.get_data()), {
      locale: defaultLocale,
      name: source.split('/').pop()?.replace(/\.[^.]+$/u, '') || source,
      source,
    }, {checkpoint: () => checkpoint()});
    if (parsed.entries.length > MAXIMUM_IMPORT_ENTRIES)
      throw new Error(`Dictionary exceeds the ${MAXIMUM_IMPORT_ENTRIES} entry import limit`);
    const previous = (await this.list()).find(dictionary => dictionary.source === source);
    const fileName = previous?.fileName
      ?? `${parsed.locale}--${checksum(source)}.dict`;
    if (previous && !fileName.startsWith(`${parsed.locale}--`))
      await this.remove(previous.fileName);
    const targetName = previous && fileName.startsWith(`${parsed.locale}--`)
      ? fileName
      : `${parsed.locale}--${checksum(source)}.dict`;
    await writeFile(
      this._root.get_child(targetName),
      new GLib.Bytes(new TextEncoder().encode(serializeDictionary({...parsed, source}))),
    );
    return {
      fileName: targetName,
      locale: parsed.locale,
      name: parsed.name,
      source,
      entryCount: parsed.entries.length,
    };
  }

  async remove(fileName) {
    const file = this.getFile(fileName);
    try {
      await io(file, 'delete', []);
    } catch (error) {
      if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        throw error;
    }
  }

  async _dictionaryFiles(cancellable) {
    const files = [];
    const enumerator = await io(this._root, 'enumerate_children', [
      `${Gio.FILE_ATTRIBUTE_STANDARD_NAME},${Gio.FILE_ATTRIBUTE_STANDARD_TYPE}`,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    ], cancellable);
    try {
      while (true) {
        const batch = await io(enumerator, 'next_files', [64], cancellable);
        if (batch.length === 0)
          break;
        for (const info of batch) {
          if (info.get_file_type() === Gio.FileType.REGULAR && FILE_PATTERN.test(info.get_name()))
            files.push(this._root.get_child(info.get_name()));
        }
      }
    } finally {
      await io(enumerator, 'close', []);
    }
    return files;
  }
}
