import {InputError, message} from '../../../../src/clipboard/terminal/errors.js';

function assert(condition, description) {
  if (!condition)
    throw new Error(description);
}

for (const code of ['busy', 'target_unavailable', 'composition_active', 'focus_changed']) {
  let translated = '';
  const result = message(new InputError(code), text => { translated = text; return 'translated: ' + text; });
  assert(translated && result === 'translated: ' + translated,
    code + ': input failures must go through translation');
}
assert(message(new Error('Other failure'), () => { throw new Error('Must not translate unrelated errors'); }) === '',
  'Unrelated errors must retain their existing reporting path');
