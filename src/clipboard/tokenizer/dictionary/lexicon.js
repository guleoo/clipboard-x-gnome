const DEFAULT_FREQUENCY = 1;
const MAXIMUM_WORD_LENGTH = 64;
const WORD_PATTERN = /^[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*$/u;

function codePoints(value) {
  return [...value];
}

export function parseEntries(text) {
  return [...dictionaryEntries(text)].filter(Boolean);
}

export function* dictionaryEntries(text) {
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const line = text.slice(start, newline < 0 ? text.length : newline);
    start = newline < 0 ? text.length + 1 : newline + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      yield null;
      continue;
    }
    const [word, rawFrequency] = trimmed.split(/\s+/u);
    const length = codePoints(word ?? '').length;
    if (length < 2 || length > MAXIMUM_WORD_LENGTH || !WORD_PATTERN.test(word)) {
      yield null;
      continue;
    }
    const frequency = Number.parseInt(rawFrequency, 10);
    yield {
      word,
      frequency: Number.isFinite(frequency) && frequency > 0 ? frequency : DEFAULT_FREQUENCY,
    };
  }
}

export class Lexicon {
  constructor(entries = [], maximumEntries = Number.POSITIVE_INFINITY) {
    this._frequencies = new Map();
    this._maximumLength = 1;
    this._totalFrequency = 0;
    this._maximumEntries = maximumEntries;
    this.add(entries);
  }

  get size() {
    return this._frequencies.size;
  }

  add(entries) {
    for (const {word, frequency = DEFAULT_FREQUENCY} of entries) {
      const previous = this._frequencies.get(word) ?? 0;
      if (previous === 0 && this.size >= this._maximumEntries)
        continue;
      const safeFrequency = Math.max(DEFAULT_FREQUENCY, frequency);
      if (safeFrequency <= previous)
        continue;
      this._frequencies.set(word, safeFrequency);
      this._totalFrequency += safeFrequency - previous;
      this._maximumLength = Math.max(this._maximumLength, codePoints(word).length);
    }
  }

  segment(text, fallback = []) {
    const characters = codePoints(text);
    if (characters.length < 2 || this.size === 0)
      return fallback.length > 0 ? fallback : characters;

    const totalFrequency = Math.max(this._totalFrequency, 1);
    const fallbackByStart = this._fallbackCandidates(characters, fallback);
    const route = Array.from({length: characters.length + 1}, () => null);
    route[characters.length] = {score: 0, end: characters.length};

    for (let start = characters.length - 1; start >= 0; start--) {
      const candidates = [];
      const limit = Math.min(characters.length, start + this._maximumLength);
      let word = '';
      for (let end = start + 1; end <= limit; end++) {
        word += characters[end - 1];
        const frequency = this._frequencies.get(word);
        if (frequency)
          candidates.push({end, frequency});
      }
      for (const candidate of fallbackByStart.get(start) ?? [])
        candidates.push(candidate);
      if (candidates.length === 0)
        candidates.push({end: start + 1, frequency: DEFAULT_FREQUENCY});

      for (const candidate of candidates) {
        const tail = route[candidate.end];
        if (!tail)
          continue;
        const score = Math.log(candidate.frequency / totalFrequency) + tail.score;
        if (!route[start] || score > route[start].score
            || (score === route[start].score && candidate.end > route[start].end)) {
          route[start] = {score, end: candidate.end};
        }
      }
    }

    const result = [];
    for (let start = 0; start < characters.length;) {
      const end = route[start]?.end ?? start + 1;
      result.push(characters.slice(start, end).join(''));
      start = end;
    }
    return result;
  }

  _fallbackCandidates(characters, fallback) {
    const candidates = new Map();
    let offset = 0;
    for (const value of fallback) {
      const length = codePoints(value).length;
      if (length === 0)
        continue;
      if (characters.slice(offset, offset + length).join('') !== value)
        return new Map();
      const values = candidates.get(offset) ?? [];
      values.push({end: offset + length, frequency: DEFAULT_FREQUENCY});
      candidates.set(offset, values);
      offset += length;
    }
    return offset === characters.length ? candidates : new Map();
  }
}
