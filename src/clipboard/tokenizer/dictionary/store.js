import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {loadFile, writeFile} from '../../../common/files.js';
import {parseDictionary, serializeDictionary} from './format.js';
import {inferLocale, localeCandidates} from './locale.js';
import {Lexicon} from './lexicon.js';

const FILE_PATTERN = /^([a-z]{2,3}(?:_[a-z0-9]{2,8})*)--[a-z0-9-]+\.dict$/u;
const MAXIMUM_IMPORT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_IMPORT_ENTRIES = 150_000;
const MAXIMUM_ACTIVE_ENTRIES = 200_000;

function decode(contents) {
  return new TextDecoder().decode(contents).replace(/^\uFEFF/u, '');
}

function ensureDirectory(directory) {
  try {
    directory.make_directory_with_parents(null);
  } catch (error) {
    if (!error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.EXISTS))
      throw error;
  }
}

function loadText(file) {
  const [ok, contents] = file.load_contents(null);
  if (!ok)
    throw new Error(`Unable to read ${file.get_uri()}`);
  return decode(contents);
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
  }

  get path() {
    return this._root.get_path();
  }

  getFile(fileName) {
    if (!FILE_PATTERN.test(fileName))
      throw new Error('Invalid dictionary filename');
    return this._root.get_child(fileName);
  }

  ensureSeeds() {
    if (this._seedsReady)
      return;
    ensureDirectory(this._root);
    const stateFile = this._root.get_child('.seed-state.json');
    let state = {imported: []};
    if (stateFile.query_exists(null)) {
      try {
        const parsed = JSON.parse(loadText(stateFile));
        if (Array.isArray(parsed.imported))
          state = {imported: parsed.imported.filter(value => typeof value === 'string')};
      } catch (error) {
        console.error(`Clipboard X could not read dictionary seed state: ${error.message}`);
      }
    }
    let changed = !stateFile.query_exists(null);
    for (const seedPath of this._seedPaths) {
      const source = Gio.File.new_for_path(seedPath);
      const fileName = source.get_basename();
      if (!FILE_PATTERN.test(fileName))
        throw new Error(`Invalid seed dictionary filename: ${fileName}`);
      if (!state.imported.includes(fileName)) {
        const target = this._root.get_child(fileName);
        if (!target.query_exists(null))
          source.copy(target, Gio.FileCopyFlags.NONE, null, null);
        state.imported.push(fileName);
        changed = true;
      }
    }
    if (changed) {
      stateFile.replace_contents(
        new TextEncoder().encode(`${JSON.stringify(state)}\n`),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
      );
    }
    this._seedsReady = true;
  }

  list() {
    this.ensureSeeds();
    const dictionaries = [];
    for (const file of this._dictionaryFiles()) {
      try {
        const fileName = file.get_basename();
        const locale = fileName.match(FILE_PATTERN)?.[1] ?? '';
        const parsed = parseDictionary(loadText(file), {
          locale,
          name: fileName.replace(/\.dict$/u, ''),
        });
        dictionaries.push({
          fileName,
          locale: parsed.locale,
          name: parsed.name,
          entryCount: parsed.entries.length,
        });
      } catch (error) {
        console.error(`Clipboard X ignored dictionary ${file.get_uri()}: ${error.message}`);
      }
    }
    return dictionaries.sort((left, right) => left.locale.localeCompare(right.locale)
      || left.name.localeCompare(right.name));
  }

  load(languageNames, selectedFiles = []) {
    this.ensureSeeds();
    const locales = new Set(localeCandidates(languageNames));
    if (locales.size === 0)
      return new Lexicon();
    const lexicon = new Lexicon([], MAXIMUM_ACTIVE_ENTRIES);
    const files = this._dictionaryFiles()
      .sort((left, right) => left.get_basename().localeCompare(right.get_basename()))
      .filter(file => locales.has(file.get_basename().match(FILE_PATTERN)?.[1]));
    const enabled = new Set(selectedFiles);
    let selected = enabled.size === 0
      ? files
      : files.filter(file => enabled.has(file.get_basename()));
    if (selected.length === 0)
      selected = files;
    if (selected.length === 0)
      return lexicon;
    for (const file of selected) {
      const locale = file.get_basename().match(FILE_PATTERN)?.[1];
      try {
        lexicon.add(parseDictionary(loadText(file), {
          locale,
          name: file.get_basename(),
        }).entries);
      } catch (error) {
        console.error(`Clipboard X ignored dictionary ${file.get_uri()}: ${error.message}`);
      }
    }
    return lexicon;
  }

  async importFile(file, defaultLocale) {
    this.ensureSeeds();
    const bytes = await loadFile(file);
    if (bytes.get_size() > MAXIMUM_IMPORT_BYTES)
      throw new Error('Dictionary exceeds the 8 MB import limit');
    const basename = file.get_basename();
    const parsed = parseDictionary(decode(bytes.get_data()), {
      locale: inferLocale(basename, defaultLocale),
      name: basename.replace(/\.[^.]+$/u, ''),
    });
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
      entryCount: parsed.entries.length,
    };
  }

  remove(fileName) {
    const file = this.getFile(fileName);
    if (file.query_exists(null))
      file.delete(null);
  }

  _dictionaryFiles() {
    const files = [];
    const enumerator = this._root.enumerate_children(
      Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
    try {
      let info;
      while ((info = enumerator.next_file(null))) {
        if (FILE_PATTERN.test(info.get_name()))
          files.push(this._root.get_child(info.get_name()));
      }
    } finally {
      enumerator.close(null);
    }
    return files;
  }
}
