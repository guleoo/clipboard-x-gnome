import {dataPath, readJson, writeJson} from '../../common/data-store.js';

export const MAX_PHRASE_LENGTH = 4096;
const MAX_PHRASES = 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FILE_VERSION = 1;

export function quickPhrasesPath() {
  return dataPath('quick-phrases.json');
}

export class PhraseStore {
  constructor(settings, {path = quickPhrasesPath()} = {}) {
    this._settings = settings;
    this.path = path;
    this._phrases = [];
    this._operation = this._load();
    this.ready = this._operation;
  }

  get all() {
    return [...this._phrases];
  }

  add(text) {
    const phrase = normalize(text);
    if (!phrase)
      return Promise.resolve(false);
    return this._mutate(current => {
      const remaining = current.filter(value => value !== phrase);
      const newestFirst = this._settings.get_boolean('saved-phrase-newest-first');
      const limit = this._limit();
      const ordered = newestFirst ? [phrase, ...remaining] : [...remaining, phrase];
      return newestFirst ? ordered.slice(0, limit) : ordered.slice(-limit);
    });
  }

  remove(phrase) {
    return this._mutate(current => current.filter(value => value !== phrase));
  }

  trim() {
    return this._mutate(current => {
      const limit = this._limit();
      return this._settings.get_boolean('saved-phrase-newest-first')
        ? current.slice(0, limit)
        : current.slice(-limit);
    });
  }

  replace(phrases) {
    return this._mutate(() => normalizeList(phrases).slice(0, this._limit()));
  }

  _mutate(createNext) {
    const run = this._operation.then(async () => {
      const next = createNext(this.all);
      if (same(this._phrases, next))
        return false;
      await writeJson(this.path, {version: FILE_VERSION, phrases: next});
      this._phrases = next;
      return true;
    });
    this._operation = run.catch(() => {});
    return run;
  }

  async _load() {
    const document = await readJson(this.path, MAX_FILE_BYTES);
    if (document === null) {
      const legacy = normalizeList(this._settings.get_strv?.('saved-phrases') ?? []);
      if (legacy.length > 0) {
        const limit = this._limit();
        this._phrases = this._settings.get_boolean('saved-phrase-newest-first')
          ? legacy.slice(0, limit)
          : legacy.slice(-limit);
        await writeJson(this.path, {version: FILE_VERSION, phrases: this._phrases});
        this._settings.set_strv?.('saved-phrases', []);
      }
      return;
    }
    if (!document || document.version !== FILE_VERSION || !Array.isArray(document.phrases))
      throw new Error('Quick phrases file has an invalid structure');
    const phrases = normalizeList(document.phrases);
    if (phrases.length !== document.phrases.length || phrases.length > MAX_PHRASES)
      throw new Error('Quick phrases file contains invalid entries');
    const limit = this._limit();
    this._phrases = this._settings.get_boolean('saved-phrase-newest-first')
      ? phrases.slice(0, limit)
      : phrases.slice(-limit);
  }

  _limit() {
    return Math.min(MAX_PHRASES, Math.max(1, this._settings.get_int('saved-phrase-limit')));
  }
}

function normalize(value) {
  if (typeof value !== 'string')
    return '';
  return [...value.trim()].slice(0, MAX_PHRASE_LENGTH).join('');
}

function normalizeList(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const phrase = normalize(value);
    if (!phrase || seen.has(phrase))
      continue;
    seen.add(phrase);
    result.push(phrase);
  }
  return result;
}

function same(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
