import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {localeCandidates} from './dictionary/locale.js';
import {tokenizeText} from './processors.js';

export class Tokenizer {
  constructor({store, languageNames = () => GLib.get_language_names()} = {}) {
    this._store = store;
    this._languageNames = languageNames;
    this._cacheKey = '';
    this._lexicon = null;
    this._systemEnabled = true;
    this._pending = new Map();
    this._requestedKey = '';
    this._cancellable = new Gio.Cancellable();
  }

  async tokenize(text, {revision = 0, dictionaryFiles = []} = {}) {
    this._cancellable.set_error_if_cancelled();
    const languageNames = this._languageNames();
    const locales = localeCandidates(languageNames);
    const cacheKey = `${revision}:${dictionaryFiles.join(',')}:${locales.join(',')}`;
    this._requestedKey = cacheKey;
    let loaded = {lexicon: this._lexicon, systemEnabled: this._systemEnabled};
    if (cacheKey !== this._cacheKey) {
      if (!this._pending.has(cacheKey)) {
        const pending = Promise.resolve()
          .then(() => this._store.load(languageNames, dictionaryFiles, this._cancellable))
          .then(value => {
            if (cacheKey === this._requestedKey && !this._cancellable.is_cancelled()) {
              this._lexicon = value.lexicon;
              this._systemEnabled = value.systemEnabled;
              this._cacheKey = cacheKey;
            }
            return value;
          }).finally(() => this._pending.delete(cacheKey));
        this._pending.set(cacheKey, pending);
      }
      loaded = await this._pending.get(cacheKey);
    }
    this._cancellable.set_error_if_cancelled();
    if (!loaded.lexicon || loaded.lexicon.size === 0)
      return tokenizeText(text);
    return tokenizeText(text, {
      segmentWordRun: (value, fallback) => loaded.lexicon.segment(
        value,
        loaded.systemEnabled ? fallback : [],
      ),
    });
  }

  destroy() {
    this._cancellable.cancel();
    this._pending.clear();
    this._lexicon = null;
    this._cacheKey = '';
  }
}
