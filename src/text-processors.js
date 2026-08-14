function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const SPECIAL_TOKEN_RULES = Object.freeze([
  {type: 'url', pattern: /https?:\/\/[^\s<>"'，。；！？]+/giu, priority: 0},
  {type: 'email', pattern: /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, priority: 1},
  {type: 'number', pattern: /[+-]?\d(?:[\d.,:/-]*\d)?/gu, priority: 2},
]);

export function tokenizeText(text, locale = undefined) {
  if (typeof text !== 'string')
    throw new TypeError('Text to tokenize must be a string');
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
        if (/^[\p{L}\p{N}]$/u.test(previous) || /^[\p{L}\p{N}]$/u.test(next))
          continue;
      }
      candidates.push({text: value, start, end, type: rule.type, priority: rule.priority});
    }
  }

  candidates.sort((left, right) => left.start - right.start
    || right.end - left.end
    || left.priority - right.priority);
  const specials = [];
  for (const candidate of candidates) {
    if (specials.some(value => candidate.start < value.end && candidate.end > value.start))
      continue;
    specials.push(candidate);
  }
  specials.sort((left, right) => left.start - right.start);

  const segmenter = new Intl.Segmenter(locale, {granularity: 'word'});
  const tokens = [];
  const addWords = (start, end) => {
    const slice = text.slice(start, end);
    for (const part of segmenter.segment(slice)) {
      if (!part.isWordLike)
        continue;
      tokens.push({
        text: part.segment,
        start: start + part.index,
        end: start + part.index + part.segment.length,
        type: 'word',
      });
    }
  };

  let cursor = 0;
  for (const special of specials) {
    addWords(cursor, special.start);
    tokens.push({text: special.text, start: special.start, end: special.end, type: special.type});
    cursor = special.end;
  }
  addWords(cursor, text.length);
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

const builtInProcessors = {
  words(text, locale = undefined) {
    const segmenter = new Intl.Segmenter(locale, {granularity: 'word'});
    return [...segmenter.segment(text)]
      .filter(segment => segment.isWordLike)
      .map(segment => segment.segment);
  },

  sentences(text, locale = undefined) {
    const segmenter = new Intl.Segmenter(locale, {granularity: 'sentence'});
    return [...segmenter.segment(text)]
      .map(segment => segment.segment.trim())
      .filter(Boolean);
  },

  graphemes(text, locale = undefined) {
    const segmenter = new Intl.Segmenter(locale, {granularity: 'grapheme'});
    return [...segmenter.segment(text)]
      .map(segment => segment.segment)
      .filter(segment => segment.trim().length > 0);
  },

  lines(text) {
    return text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  },

  separators(text) {
    return text.split(/[\s,，;；|]+/u).map(value => value.trim()).filter(Boolean);
  },

  urls(text) {
    return unique(text.match(/https?:\/\/[^\s<>"']+/giu) ?? []);
  },

  emails(text) {
    return unique(text.match(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu) ?? []);
  },

  numbers(text) {
    return text.match(/[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)/gu) ?? [];
  },

  identifiers(text) {
    return text
      .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')
      .split(/[_\-\s]+/u)
      .filter(Boolean);
  },

  uppercase(text, locale = undefined) {
    return [text.toLocaleUpperCase(locale)];
  },

  lowercase(text, locale = undefined) {
    return [text.toLocaleLowerCase(locale)];
  },

  'title-case'(text, locale = undefined) {
    const graphemes = new Intl.Segmenter(locale, {granularity: 'grapheme'});
    const words = new Intl.Segmenter(locale, {granularity: 'word'});
    return [[...words.segment(text)].map(part => {
      if (!part.isWordLike)
        return part.segment;
      const [first, ...rest] = [...graphemes.segment(part.segment)].map(value => value.segment);
      return `${first?.toLocaleUpperCase(locale) ?? ''}${rest.join('').toLocaleLowerCase(locale)}`;
    }).join('')];
  },
};

const processors = new Map(Object.entries(builtInProcessors));

export const TextProcessors = Object.freeze({
  register(name, processor) {
    if (!/^[a-z][a-z0-9-]*$/u.test(name))
      throw new Error(`Invalid text processor name: ${name}`);
    if (typeof processor !== 'function')
      throw new TypeError('Text processor must be a function');
    if (processors.has(name))
      throw new Error(`Text processor is already registered: ${name}`);
    processors.set(name, processor);
  },

  names() {
    return [...processors.keys()];
  },
});

export function processText(name, text, locale = undefined) {
  const processor = processors.get(name);
  if (!processor)
    throw new Error(`Unknown text processor: ${name}`);
  return processor(text, locale);
}
