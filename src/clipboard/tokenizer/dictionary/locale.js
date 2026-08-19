const LOCALE_PATTERN = /^[a-z]{2,3}(?:[_-][a-z0-9]{2,8})*$/iu;

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

export function inferLocale(name, fallback = '') {
  const stem = String(name ?? '').replace(/\.[^.]+$/u, '');
  const header = stem.match(/(?:^|[^a-z])([a-z]{2,3}(?:[_-][a-z0-9]{2,8})*)(?:[^a-z0-9]|$)/iu);
  return normalizeLocale(header?.[1]) || normalizeLocale(fallback);
}
