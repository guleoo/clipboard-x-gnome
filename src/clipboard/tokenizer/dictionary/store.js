import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {loadFile, writeFile} from '../../../common/files.js';
import {createLogger} from '../../../common/logger.js';
import {parseDictionaryAsync, serializeDictionary} from './format.js';
import {inferLocale, localeCandidates, SYSTEM_DICTIONARY_ID} from './locale.js';
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
  constructor({rootPath = '', seedPaths = []} = {}) {
    const path = rootPath || GLib.build_filenamev([
      GLib.get_user_data_dir(),
      'clipboard-x',
      'dictionaries',
    ]);
    this._root = Gio.File.new_for_path(path);
    this._seedPaths = seedPaths;
    this._seedsReady = false;
    this._seedsPending = null;
  }

  get path() {
    return this._root.get_path();
  }

  getFile(fileName) {
    if (!FILE_PATTERN.test(fileName))
      throw new Error('Invalid dictionary filename');
    return this._root.get_child(fileName);
  }

  async ensureSeeds(cancellable = null) {
    if (this._seedsReady)
      return;
    if (!this._seedsPending) {
      const pending = this._importSeeds(cancellable);
      this._seedsPending = pending;
      pending.finally(() => {
        if (this._seedsPending === pending)
          this._seedsPending = null;
      }).catch(() => {});
    }
    await this._seedsPending;
    cancellable?.set_error_if_cancelled();
  }

  async _importSeeds(cancellable) {
    await ensureDirectory(this._root, cancellable);
    const stateFile = this._root.get_child('.seed-state.json');
    let state = {imported: []};
    let changed = false;
    try {
      const parsed = JSON.parse(await loadText(stateFile, cancellable));
      if (Array.isArray(parsed.imported))
        state = {imported: parsed.imported.filter(value => typeof value === 'string')};
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        throw error;
      changed = true;
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        logger.error('load-seed-state', error);
    }
    for (const seedPath of this._seedPaths) {
      const source = Gio.File.new_for_path(seedPath);
      const fileName = source.get_basename();
      if (!FILE_PATTERN.test(fileName))
        throw new Error(`Invalid seed dictionary filename: ${fileName}`);
      if (!state.imported.includes(fileName)) {
        const target = this._root.get_child(fileName);
        try {
          await new Promise((resolve, reject) => source.copy_async(
            target, Gio.FileCopyFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, null,
            (file, result) => {
              try { resolve(file.copy_finish(result)); } catch (error) { reject(error); }
            },
          ));
        } catch (error) {
          if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw error;
        }
        state.imported.push(fileName);
        changed = true;
      }
    }
    if (changed) {
      await writeFile(stateFile,
        new GLib.Bytes(new TextEncoder().encode(`${JSON.stringify(state)}\n`)), cancellable);
    }
    this._seedsReady = true;
  }

  async list(cancellable = null) {
    await this.ensureSeeds(cancellable);
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
          locale: parsed.locale,
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
    await this.ensureSeeds(cancellable);
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
    await this.ensureSeeds();
    const bytes = await loadFile(file);
    if (bytes.get_size() > MAXIMUM_IMPORT_BYTES)
      throw new Error('Dictionary exceeds the 8 MB import limit');
    const basename = file.get_basename();
    const parsed = await parseDictionaryAsync(decode(bytes.get_data()), {
      locale: inferLocale(basename, defaultLocale),
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
    await this.ensureSeeds();
    const bytes = await loadFile(Gio.File.new_for_uri(source));
    if (bytes.get_size() > MAXIMUM_IMPORT_BYTES)
      throw new Error('Dictionary exceeds the 8 MB import limit');
    const parsed = await parseDictionaryAsync(decode(bytes.get_data()), {
      locale: inferLocale(source, defaultLocale),
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
