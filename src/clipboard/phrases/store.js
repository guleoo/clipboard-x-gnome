export const MAX_PHRASE_LENGTH = 4096;

export class PhraseStore {
  constructor(settings) {
    this._settings = settings;
  }

  get all() {
    return this._settings.get_strv('saved-phrases');
  }

  add(text) {
    const phrase = [...text.trim()].slice(0, MAX_PHRASE_LENGTH).join('');
    if (!phrase)
      return false;
    const current = this.all;
    const remaining = current.filter(value => value !== phrase);
    const newestFirst = this._settings.get_boolean('saved-phrase-newest-first');
    const limit = this._settings.get_int('saved-phrase-limit');
    const ordered = newestFirst ? [phrase, ...remaining] : [...remaining, phrase];
    const next = newestFirst ? ordered.slice(0, limit) : ordered.slice(-limit);
    if (next.length === current.length && next.every((value, index) => value === current[index]))
      return false;
    this._settings.set_strv('saved-phrases', next);
    return true;
  }

  remove(phrase) {
    const current = this.all;
    const next = current.filter(value => value !== phrase);
    if (next.length === current.length)
      return false;
    this._settings.set_strv('saved-phrases', next);
    return true;
  }

  trim() {
    const current = this.all;
    const limit = this._settings.get_int('saved-phrase-limit');
    const next = this._settings.get_boolean('saved-phrase-newest-first')
      ? current.slice(0, limit)
      : current.slice(-limit);
    if (next.length === current.length)
      return false;
    this._settings.set_strv('saved-phrases', next);
    return true;
  }
}
