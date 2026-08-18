export const ACTIONS = Object.freeze([
  'screenshot',
  'color-picker',
  'quick-phrases',
  'private-mode',
  'sync',
  'clear-history',
  'preferences',
]);

export const DEFAULT_TOOLBAR = Object.freeze([
  'screenshot',
  'color-picker',
  'quick-phrases',
]);

export const DEFAULT_FOOTER = Object.freeze([
  'private-mode',
  'sync',
  'clear-history',
  'preferences',
]);

export function normalize(toolbar, footer) {
  const known = new Set(ACTIONS);
  const seen = new Set();
  const valid = values => values.filter(action => {
    if (!known.has(action) || seen.has(action))
      return false;
    seen.add(action);
    return true;
  });
  const result = {
    toolbar: valid(toolbar),
    footer: valid(footer),
  };
  for (const action of ACTIONS) {
    if (seen.has(action))
      continue;
    const region = DEFAULT_TOOLBAR.includes(action) ? result.toolbar : result.footer;
    region.push(action);
  }
  return result;
}

export function move(layout, action, region, index) {
  if (!ACTIONS.includes(action) || !['toolbar', 'footer'].includes(region))
    return normalize(layout.toolbar, layout.footer);
  const current = normalize(layout.toolbar, layout.footer);
  const sourceRegion = current.toolbar.includes(action) ? 'toolbar' : 'footer';
  const sourceIndex = current[sourceRegion].indexOf(action);
  current[sourceRegion].splice(sourceIndex, 1);
  let requestedIndex = Number(index) || 0;
  if (sourceRegion === region && sourceIndex < requestedIndex)
    requestedIndex--;
  const targetIndex = Math.max(0, Math.min(requestedIndex, current[region].length));
  current[region].splice(targetIndex, 0, action);
  return current;
}
