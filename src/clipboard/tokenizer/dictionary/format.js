import {normalizeLocale} from './locale.js';
import {parseEntries} from './lexicon.js';

const METADATA_PATTERN = /^#\s*([a-z-]+)\s*:\s*(.*?)\s*$/iu;

export function parseDictionary(text, defaults = {}) {
  const metadata = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('#'))
      break;
    const match = line.match(METADATA_PATTERN);
    if (match)
      metadata.set(match[1].toLowerCase(), match[2]);
  }
  const locale = normalizeLocale(metadata.get('locale') ?? defaults.locale);
  const name = (metadata.get('name') ?? defaults.name ?? '').trim();
  const source = (metadata.get('source') ?? defaults.source ?? '').trim();
  const entries = parseEntries(text);
  if (!locale)
    throw new Error('Dictionary locale is missing or invalid');
  if (!name)
    throw new Error('Dictionary name is missing');
  if (entries.length === 0)
    throw new Error('Dictionary contains no valid entries');
  return {locale, name, source, entries};
}

export function serializeDictionary(dictionary) {
  const lines = [
    '# clipboard-x-dictionary: 1',
    `# locale: ${dictionary.locale}`,
    `# name: ${dictionary.name.replaceAll('\n', ' ')}`,
    ...(dictionary.source ? [`# source: ${dictionary.source}`] : []),
    '',
    ...dictionary.entries.map(({word, frequency}) => `${word} ${frequency}`),
    '',
  ];
  return lines.join('\n');
}
