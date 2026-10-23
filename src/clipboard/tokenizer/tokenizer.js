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
    this._generation = 0;
    this._watching = null;
    this._stopWatching = null;
  }

  async tokenize(text, {revision = 0, dictionaryFiles = [], maximumTokens = Infinity} = {}) {
    this._cancellable.set_error_if_cancelled();
    if (this._store.watch) {
      this._watching ??= this._store.watch(() => {
        this._generation++;
        this._cacheKey = '';
        this._lexicon = null;
      }, this._cancellable).then(stop => {
        if (this._cancellable.is_cancelled())
          stop();
        else
          this._stopWatching = stop;
      }).catch(error => {
        this._watching = null;
        throw error;
      });
      await this._watching;
    }
    const languageNames = this._languageNames();
    const locales = localeCandidates(languageNames);
    let loaded;
    while (true) {
      this._cancellable.set_error_if_cancelled();
      const generation = this._generation;
      const cacheKey = `${generation}:${revision}:${dictionaryFiles.join(',')}:${locales.join(',')}`;
      this._requestedKey = cacheKey;
      loaded = {lexicon: this._lexicon, systemEnabled: this._systemEnabled};
      if (cacheKey !== this._cacheKey) {
        if (!this._pending.has(cacheKey)) {
          const pending = Promise.resolve()
            .then(() => this._store.load(languageNames, dictionaryFiles, this._cancellable))
            .then(value => {
              if (generation === this._generation && cacheKey === this._requestedKey
                  && !this._cancellable.is_cancelled()) {
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
      // A save during parsing invalidates both cached and in-flight indexes.
      // Retry against the new generation rather than returning the old words.
      if (generation === this._generation)
        break;
    }
    this._cancellable.set_error_if_cancelled();
    if (!loaded.lexicon || loaded.lexicon.size === 0)
      return tokenizeText(text, {maximumTokens});
    return tokenizeText(text, {
      maximumTokens,
      segmentWordRun: (value, fallback) => loaded.lexicon.segment(
        value,
        loaded.systemEnabled ? fallback : [],
      ),
    });
  }

  destroy() {
    this._cancellable.cancel();
    this._stopWatching?.();
    this._stopWatching = null;
    this._pending.clear();
    this._lexicon = null;
    this._cacheKey = '';
  }
}
