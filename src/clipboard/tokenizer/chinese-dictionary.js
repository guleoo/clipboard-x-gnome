const DEFAULT_FREQUENCY = 1;

function codePoints(value) {
  return [...value];
}
function normalizedWords(values) {
  return [...new Set(values
    .map(value => value.trim())
    .filter(value => /^\p{Script=Han}{2,32}$/u.test(value)))];
}

export class ChineseDictionary {
  constructor(text = '') {
    this._frequencies = new Map();
    this._maximumLength = 1;
    this._totalFrequency = 0;
    for (const line of text.split('\n')) {
      const [word, rawFrequency] = line.trim().split(/\s+/u);
      if (!word || !/^\p{Script=Han}{2,32}$/u.test(word))
        continue;
      const frequency = Number.parseInt(rawFrequency, 10);
      const safeFrequency = Number.isFinite(frequency) && frequency > 0
        ? frequency
        : DEFAULT_FREQUENCY;
      this._frequencies.set(word, safeFrequency);
      this._maximumLength = Math.max(this._maximumLength, codePoints(word).length);
      this._totalFrequency += safeFrequency;
    }
  }

  get size() {
    return this._frequencies.size;
  }

  segment(text, fallback = [], customWords = []) {
    const characters = codePoints(text);
    if (characters.length < 2)
      return characters;

    const custom = new Set(normalizedWords(customWords));
    const maximumCustomLength = [...custom]
      .reduce((maximum, word) => Math.max(maximum, codePoints(word).length), 1);
    const maximumLength = Math.max(this._maximumLength, maximumCustomLength);
    const totalFrequency = Math.max(this._totalFrequency, 1);
    const fallbackByStart = this._fallbackCandidates(characters, fallback);
    const route = Array.from({length: characters.length + 1}, () => null);
    route[characters.length] = {score: 0, end: characters.length};

    for (let start = characters.length - 1; start >= 0; start--) {
      const candidates = [];
      const limit = Math.min(characters.length, start + maximumLength);
      let word = '';
      for (let end = start + 1; end <= limit; end++) {
        word += characters[end - 1];
        const customFrequency = custom.has(word) ? totalFrequency : 0;
        const frequency = customFrequency || this._frequencies.get(word);
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
