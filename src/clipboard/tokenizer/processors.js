const SPECIAL_TOKEN_RULES = Object.freeze([
  {type: 'url', pattern: /https?:\/\/[^\s<>"'，。；！？]+/giu, priority: 0},
  {
    type: 'email',
    pattern: /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/giu,
    priority: 1,
  },
  {type: 'number', pattern: /[+-]?\d(?:[\d.,:/-]*\d)?/gu, priority: 2},
]);
const IDENTIFIER_BOUNDARY_PATTERN = /^[a-z0-9_]$/iu;
const WORD_GRAPHEME_PATTERN = /^[\p{L}\p{M}\p{N}_]+$/u;
const PUNCTUATION_PATTERN = /^\p{P}+$/u;
const APOSTROPHES = new Set(["'", '’']);
const WORD_RUN_PATTERN = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*/gu;

export function tokenizeText(text, localeOrOptions = undefined) {
  if (typeof text !== 'string')
    throw new TypeError('Text to tokenize must be a string');
  const options = localeOrOptions && typeof localeOrOptions === 'object'
    ? localeOrOptions
    : {locale: localeOrOptions};
  const {locale = undefined, segmentWordRun = null} = options;
  const candidates = [];
  for (const rule of SPECIAL_TOKEN_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      let value = match[0];
      if (rule.type === 'url')
        value = value.replace(/[),.;:!?\]}，。；：！？]+$/gu, '');
      if (!value)
        continue;
      const start = match.index;
      const end = start + value.length;
      if (rule.type === 'number') {
        const previous = start > 0 ? text[start - 1] : '';
        const next = end < text.length ? text[end] : '';
        if (IDENTIFIER_BOUNDARY_PATTERN.test(previous) || IDENTIFIER_BOUNDARY_PATTERN.test(next))
          continue;
      }
      candidates.push({text: value, start, end, type: rule.type, priority: rule.priority});
    }
  }

  candidates.sort((left, right) => left.start - right.start
    || right.end - left.end
    || left.priority - right.priority);
  const specials = [];
  let previousEnd = 0;
  for (const candidate of candidates) {
    // Candidates are ordered by start; accepted intervals never overlap. Only
    // the last accepted end can intersect this candidate, not earlier tokens.
    if (candidate.start < previousEnd)
      continue;
    specials.push(candidate);
    previousEnd = candidate.end;
  }

  const wordSegmenter = new Intl.Segmenter(locale, {granularity: 'word'});
  const graphemeSegmenter = new Intl.Segmenter(locale, {granularity: 'grapheme'});
  const tokens = [];
  const addToken = (tokenText, start, type) => {
    tokens.push({text: tokenText, start, end: start + tokenText.length, type});
  };
  const addBaselineTokens = (slice, start) => {
    for (const part of wordSegmenter.segment(slice)) {
      const partStart = start + part.index;
      const graphemes = [...graphemeSegmenter.segment(part.segment)];
      let wordStart = -1;
      let wordText = '';
      const flushWord = () => {
        if (!wordText)
          return;
        addToken(wordText, wordStart, 'word');
        wordStart = -1;
        wordText = '';
      };

      for (const [index, grapheme] of graphemes.entries()) {
        const value = grapheme.segment;
        const absoluteStart = partStart + grapheme.index;
        if (/^\s+$/u.test(value)) {
          flushWord();
          continue;
        }
        if (WORD_GRAPHEME_PATTERN.test(value)) {
          if (!wordText)
            wordStart = absoluteStart;
          wordText += value;
          continue;
        }
        const previousIsWord = Boolean(wordText);
        const nextValue = graphemes[index + 1]?.segment ?? '';
        if (APOSTROPHES.has(value) && previousIsWord && WORD_GRAPHEME_PATTERN.test(nextValue)) {
          wordText += value;
          continue;
        }
        flushWord();
        addToken(value, absoluteStart, PUNCTUATION_PATTERN.test(value) ? 'punctuation' : 'symbol');
      }
      flushWord();
    }
  };
  const addOrdinaryTokens = (start, end) => {
    const slice = text.slice(start, end);
    if (!segmentWordRun) {
      addBaselineTokens(slice, start);
      return;
    }
    let cursor = 0;
    WORD_RUN_PATTERN.lastIndex = 0;
    for (const match of slice.matchAll(WORD_RUN_PATTERN)) {
      addBaselineTokens(slice.slice(cursor, match.index), start + cursor);
      const fallback = [...wordSegmenter.segment(match[0])]
        .map(part => part.segment)
        .filter(Boolean);
      const segmented = segmentWordRun(match[0], fallback);
      let tokenStart = start + match.index;
      for (const value of segmented) {
        addToken(value, tokenStart, 'word');
        tokenStart += value.length;
      }
      cursor = match.index + match[0].length;
    }
    addBaselineTokens(slice.slice(cursor), start + cursor);
  };

  let cursor = 0;
  for (const special of specials) {
    addOrdinaryTokens(cursor, special.start);
    tokens.push({text: special.text, start: special.start, end: special.end, type: special.type});
    cursor = special.end;
  }
  addOrdinaryTokens(cursor, text.length);
  return tokens
    .sort((left, right) => left.start - right.start)
    .map((token, index) => Object.freeze({...token, index}));
}

export function composeTokens(source, tokens, selectedIndexes) {
  const selected = new Set(selectedIndexes);
  const values = tokens.filter(token => selected.has(token.index));
  if (values.length === 0)
    return '';
  let result = values[0].text;
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    const current = values[index];
    const separator = current.index === previous.index + 1
      ? source.slice(previous.end, current.start)
      : ' ';
    result += `${separator}${current.text}`;
  }
  return result;
}
