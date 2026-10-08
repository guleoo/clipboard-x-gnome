// Clipboard-entry action order shared by the panel and preferences.
export const ACTIONS = Object.freeze(['tokenize', 'edit', 'pin', 'sync', 'delete']);

export function normalize(values) {
  const ordered = [...new Set(values.filter(action => ACTIONS.includes(action)))];
  return [...ordered, ...ACTIONS.filter(action => !ordered.includes(action))];
}

export function normalizeHidden(values) {
  return [...new Set(values.filter(action => ACTIONS.includes(action)))];
}

export function move(values, action, index) {
  const ordered = normalize(values);
  if (!ACTIONS.includes(action))
    return ordered;
  const source = ordered.indexOf(action);
  ordered.splice(source, 1);
  let target = Number(index) || 0;
  if (source < target)
    target--;
  ordered.splice(Math.max(0, Math.min(target, ordered.length)), 0, action);
  return ordered;
}

export function visible(values, hidden, {isText, syncEnabled, sensitive}) {
  const excluded = new Set(normalizeHidden(hidden));
  return normalize(values).filter(action => {
    if (excluded.has(action))
      return false;
    if (action === 'tokenize')
      return isText;
    if (action === 'edit')
      return !isText;
    if (action === 'sync')
      return syncEnabled && !sensitive;
    return true;
  });
}
