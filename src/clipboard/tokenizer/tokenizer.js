import GLib from 'gi://GLib';

import {localeCandidates} from './dictionary/locale.js';
import {tokenizeText} from './processors.js';

export class Tokenizer {
  constructor({store, languageNames = () => GLib.get_language_names()} = {}) {
    this._store = store;
    this._languageNames = languageNames;
    this._cacheKey = '';
    this._lexicon = null;
  }

  tokenize(text, {revision = 0} = {}) {
    const languageNames = this._languageNames();
    const locales = localeCandidates(languageNames);
    const cacheKey = `${revision}:${locales.join(',')}`;
    if (cacheKey !== this._cacheKey) {
      this._lexicon = this._store.load(languageNames);
      this._cacheKey = cacheKey;
    }
    if (!this._lexicon || this._lexicon.size === 0)
      return tokenizeText(text);
    return tokenizeText(text, {
      segmentWordRun: (value, fallback) => this._lexicon.segment(value, fallback),
    });
  }
}
