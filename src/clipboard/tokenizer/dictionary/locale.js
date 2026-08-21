const LOCALE_PATTERN = /^[a-z]{2,3}(?:[_-][a-z0-9]{2,8})*$/iu;

export const SYSTEM_DICTIONARY_ID = 'system';

export const DICTIONARY_REQUIRED_LOCALES = Object.freeze(['ja', 'zh']);

export const DICTIONARY_LOCALES = Object.freeze([
  'ar',
  'bg',
  'ca',
  'cs',
  'de',
  'el',
  'en',
  'es',
  'eu',
  'fa',
  'fi',
  'fr_fr',
  'hu',
  'it',
  'ja',
  'kn',
  'ko',
  'nl',
  'oc',
  'pl',
  'pt_br',
  'ru',
  'sk',
  'tr',
  'uk',
  'zh_cn',
]);

export function normalizeLocale(value) {
  const normalized = String(value ?? '')
    .split('.')[0]
    .split('@')[0]
    .replaceAll('-', '_')
    .toLowerCase();
  return LOCALE_PATTERN.test(normalized) ? normalized : '';
}

export function localeCandidates(languageNames) {
  for (const languageName of languageNames) {
    const locale = normalizeLocale(languageName);
    if (!locale)
      continue;
    const values = [];
    const parts = locale.split('_');
    while (parts.length > 0) {
      values.push(parts.join('_'));
      parts.pop();
    }
    return values;
  }
  return ['en'];
}

export function requiresDictionary(languageNames) {
  return localeCandidates(languageNames)
    .some(candidate => DICTIONARY_REQUIRED_LOCALES.includes(candidate.split('_')[0]));
}

export function selectLocale(languageNames, locales = DICTIONARY_LOCALES) {
  const available = locales.map(normalizeLocale).filter(Boolean);
  const candidates = localeCandidates(languageNames);
  for (const candidate of candidates) {
    if (available.includes(candidate))
      return candidate;
  }
  const language = candidates.at(-1);
  const related = available.find(locale => locale.split('_')[0] === language);
  return related ?? (available.includes('en') ? 'en' : available[0] ?? '');
}

export function inferLocale(name, fallback = '') {
  const stem = String(name ?? '').replace(/\.[^.]+$/u, '');
  const header = stem.match(/(?:^|[^a-z])([a-z]{2,3}(?:[_-][a-z0-9]{2,8})*)(?:[^a-z0-9]|$)/iu);
  return normalizeLocale(header?.[1]) || normalizeLocale(fallback);
}
