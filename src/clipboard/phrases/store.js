export const MAX_PHRASE_LENGTH = 4096;
export const MAX_PHRASE_COUNT = 200;

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
    const next = [phrase, ...current.filter(value => value !== phrase)]
      .slice(0, MAX_PHRASE_COUNT);
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
}
