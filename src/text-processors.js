function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
