export function search(items, query, limit = Infinity, cache = new WeakMap()) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle)
    return items.slice(0, limit);

  const matches = [];
  for (const item of items) {
    let searchable = cache.get(item);
    if (searchable === undefined) {
      searchable = item.preview?.text?.toLocaleLowerCase() ?? '';
      cache.set(item, searchable);
    }
    if (searchable.includes(needle))
      matches.push(item);
    if (matches.length >= limit)
      break;
  }
  return matches;
}
