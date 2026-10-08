import {ACTIONS, move, normalize, normalizeHidden, visible} from '../../src/ui/layouts/entry-actions.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const text = {isText: true, syncEnabled: true, sensitive: false};
const image = {...text, isText: false};
assert(normalize([]).join() === ACTIONS.join(), 'Empty order must restore defaults');
assert(normalize(['delete', 'unknown', 'delete', 'pin']).join() === 'delete,pin,tokenize,edit,sync',
  'Unknown and duplicate actions must be removed while keeping configured order');
assert(normalizeHidden(['sync', 'unknown', 'sync', 'pin']).join() === 'sync,pin',
  'Only known, unique hidden actions may remain');
assert(visible(ACTIONS, [], text).join() === 'tokenize,pin,sync,delete',
  'Text actions must preserve the original default order');
assert(visible(ACTIONS, [], image).join() === 'edit,pin,sync,delete',
  'Image actions must preserve the original default order');
assert(visible(['delete', 'sync', 'pin'], ['pin'], text).join() === 'delete,sync,tokenize',
  'Visible actions must follow configured order and visibility');
assert(!visible(ACTIONS, [], {...text, syncEnabled: false}).includes('sync'),
  'Disabled synchronization must hide its action');
assert(!visible(ACTIONS, [], {...image, sensitive: true}).includes('sync'),
  'Private content must never expose a synchronization action');
assert(visible(ACTIONS, ACTIONS, text).length === 0,
  'Hiding every action must leave no action icons');
assert(visible(ACTIONS, ['tokenize'], image).includes('edit'),
  'Text and image actions must have independent visibility');
assert(move(ACTIONS, 'pin', 1).join() === 'tokenize,pin,edit,sync,delete',
  'Moving an action left failed');
assert(move(ACTIONS, 'pin', 4).join() === 'tokenize,edit,sync,pin,delete',
  'Moving an action right failed');
assert(move(ACTIONS, 'delete', -5)[0] === 'delete', 'Left boundary must clamp');
assert(move(ACTIONS, 'tokenize', 100).at(-1) === 'tokenize', 'Right boundary must clamp');
assert(move(ACTIONS, 'unknown', 0).join() === ACTIONS.join(), 'Unknown move must be ignored');
assert(ACTIONS.join() === 'tokenize,edit,pin,sync,delete', 'Moves must not mutate their input');
