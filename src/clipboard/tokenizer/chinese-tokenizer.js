import Gio from 'gi://Gio';

import {ChineseDictionary} from './chinese-dictionary.js';
import {tokenizeText} from './processors.js';

export const CHINESE_DICTIONARY_MODE = Object.freeze({
  BUILT_IN: 'built-in',
  SYSTEM: 'system',
});

export class ChineseTokenizer {
  constructor({dictionaryPath = '', dictionaryText = null} = {}) {
    this._dictionaryPath = dictionaryPath;
    this._dictionaryText = dictionaryText;
    this._dictionary = null;
    this._loadAttempted = false;
  }

  tokenize(text, {locale = undefined, mode = CHINESE_DICTIONARY_MODE.BUILT_IN, customWords = []} = {}) {
    const useBuiltIn = mode === CHINESE_DICTIONARY_MODE.BUILT_IN;
    if (!useBuiltIn && customWords.length === 0)
      return tokenizeText(text, {locale});
    return tokenizeText(text, {
      locale,
      segmentHan: (value, fallback) => {
        const dictionary = useBuiltIn ? this._loadDictionary() : new ChineseDictionary();
        return dictionary.segment(value, fallback, customWords);
      },
    });
  }

  _loadDictionary() {
    if (this._loadAttempted)
      return this._dictionary;
    this._loadAttempted = true;
    try {
      let text = this._dictionaryText;
      if (text === null) {
        const [, contents] = Gio.File.new_for_path(this._dictionaryPath).load_contents(null);
        text = new TextDecoder().decode(contents);
      }
      this._dictionary = new ChineseDictionary(text);
    } catch (error) {
      console.error(`Clipboard X could not load the Chinese dictionary: ${error.message}`);
      this._dictionary = new ChineseDictionary();
    }
    return this._dictionary;
  }
}
