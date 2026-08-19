import {ACTIONS, DEFAULT_FOOTER, DEFAULT_TOOLBAR, move, normalize} from '../../src/ui/layouts/panel-actions.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const defaults = normalize(DEFAULT_TOOLBAR, DEFAULT_FOOTER);
assert(defaults.toolbar.join(',') === DEFAULT_TOOLBAR.join(','), 'toolbar defaults changed');
assert(defaults.footer.join(',') === DEFAULT_FOOTER.join(','), 'footer defaults changed');

const repaired = normalize(['unknown', 'sync', 'sync'], ['preferences', 'screenshot']);
assert([...repaired.toolbar, ...repaired.footer].length === ACTIONS.length,
  'normalization did not restore all actions');
assert(new Set([...repaired.toolbar, ...repaired.footer]).size === ACTIONS.length,
  'normalization retained duplicate actions');

const movedAcross = move(defaults, 'quick-phrases', 'footer', 1);
assert(!movedAcross.toolbar.includes('quick-phrases') && movedAcross.footer[1] === 'quick-phrases',
  'moving an action between regions failed');

const movedWithin = move(defaults, 'screenshot', 'toolbar', 3);
assert(movedWithin.toolbar.join(',') === 'color-picker,quick-phrases,screenshot',
  'moving an action within a region failed');
