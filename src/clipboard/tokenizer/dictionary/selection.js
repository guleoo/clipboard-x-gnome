import {SYSTEM_DICTIONARY_ID} from './locale.js';

export function enabled(configured, dictionaries) {
  return new Set(configured.length > 0
    ? configured
    : [SYSTEM_DICTIONARY_ID, ...dictionaries.map(dictionary => dictionary.fileName)]);
}

export function withEnabled(configured, dictionaries, fileName, active) {
  const next = enabled(configured, dictionaries);
  if (active)
    next.add(fileName);
  else
    next.delete(fileName);
  // An empty persisted list means all sources, not no sources.
  if (next.size === 0)
    throw new Error('At least one word segmentation source must remain enabled');
  const allEnabled = next.has(SYSTEM_DICTIONARY_ID)
    && dictionaries.every(dictionary => next.has(dictionary.fileName));
  return allEnabled ? [] : [...next].sort();
}
