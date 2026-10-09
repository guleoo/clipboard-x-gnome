import {normalizeLocale} from './locale.js';
import {dictionaryEntries, parseEntries} from './lexicon.js';

const METADATA_PATTERN = /^#\s*([a-z-]+)\s*:\s*(.*?)\s*$/iu;

export function parseDictionary(text, defaults = {}) {
  return completeDictionary(dictionaryMetadata(text, defaults), parseEntries(text));
}

export async function parseDictionaryAsync(text, defaults, {checkpoint}) {
  const metadata = dictionaryMetadata(text, defaults);
  const entries = [];
  let lines = 0;
  for (const entry of dictionaryEntries(text)) {
    if (entry)
      entries.push(entry);
    if (++lines % 512 === 0)
      await checkpoint();
  }
  return completeDictionary(metadata, entries);
}

function dictionaryMetadata(text, defaults) {
  const metadata = new Map();
  for (const line of text.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const value = line[0].trimEnd();
    if (!value.trim().startsWith('#'))
      break;
    const match = value.match(METADATA_PATTERN);
    if (match)
      metadata.set(match[1].toLowerCase(), match[2]);
  }
  const locale = normalizeLocale(metadata.get('locale') ?? defaults.locale);
  const name = (metadata.get('name') ?? defaults.name ?? '').trim();
  const source = (metadata.get('source') ?? defaults.source ?? '').trim();
  if (!locale)
    throw new Error('Dictionary locale is missing or invalid');
  if (!name)
    throw new Error('Dictionary name is missing');
  return {locale, name, source};
}

function completeDictionary(metadata, entries) {
  if (entries.length === 0)
    throw new Error('Dictionary contains no valid entries');
  return {...metadata, entries};
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
