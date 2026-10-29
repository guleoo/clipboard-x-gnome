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
const MAXIMUM_CHARACTERS = 20_000;

export function checkInput(text) {
  if (typeof text !== 'string')
    throw new TypeError('Text to tokenize must be a string');
  if (text.length <= MAXIMUM_CHARACTERS)
    return;
  // Count Unicode code points, not UTF-16 units. Stop at the first excess
  // character without allocating an array or scanning the rest of the input.
  let characters = 0;
  for (const _character of text) {
    if (++characters > MAXIMUM_CHARACTERS) {
      const error = new RangeError('Text exceeds the 20,000-character word selection limit');
      error.code = 'text_limit_exceeded';
      throw error;
    }
  }
}

export function tokenizeText(text, localeOrOptions = undefined) {
  checkInput(text);
  const options = localeOrOptions && typeof localeOrOptions === 'object'
    ? localeOrOptions
    : {locale: localeOrOptions};
  const {locale = undefined, segmentWordRun = null, maximumTokens = Infinity} = options;
  if (maximumTokens !== Infinity && (!Number.isSafeInteger(maximumTokens) || maximumTokens < 1))
    throw new RangeError('The word limit must be a positive integer');

  const wordSegmenter = new Intl.Segmenter(locale, {granularity: 'word'});
  const graphemeSegmenter = new Intl.Segmenter(locale, {granularity: 'grapheme'});
  const tokens = [];
  const addToken = (tokenText, start, type) => {
    if (tokens.length >= maximumTokens) {
      const error = new RangeError('Text exceeds the word selection limit');
      error.code = 'word_limit_exceeded';
      throw error;
    }
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
  for (const special of specialTokens(text)) {
    addOrdinaryTokens(cursor, special.start);
    addToken(special.text, special.start, special.type);
    cursor = special.end;
  }
  addOrdinaryTokens(cursor, text.length);
  return tokens
    .sort((left, right) => left.start - right.start)
    .map((token, index) => Object.freeze({...token, index}));
}

function* specialCandidates(text, rule) {
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
    yield {text: value, start, end, type: rule.type, priority: rule.priority};
  }
}

function* specialTokens(text) {
  // Each rule already yields in source order. Merge three lookahead values
  // instead of collecting and sorting every match before checking the limit.
  const streams = SPECIAL_TOKEN_RULES.map(rule => {
    const values = specialCandidates(text, rule);
    return {values, current: values.next()};
  });
  let previousEnd = 0;
  while (true) {
    let selected = null;
    for (const stream of streams) {
      if (stream.current.done)
        continue;
      const candidate = stream.current.value;
      const previous = selected?.current.value;
      if (!previous || candidate.start < previous.start
          || (candidate.start === previous.start && (candidate.end > previous.end
            || (candidate.end === previous.end && candidate.priority < previous.priority))))
        selected = stream;
    }
    if (!selected)
      return;
    const candidate = selected.current.value;
    if (candidate.start >= previousEnd) {
      previousEnd = candidate.end;
      yield candidate;
    }
    selected.current = selected.values.next();
  }
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
