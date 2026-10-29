import {submit} from '../../../../src/clipboard/terminal/commit.js';
import {InputError, message} from '../../../../src/clipboard/terminal/errors.js';

function assert(condition, description) {
  if (!condition)
    throw new Error(description);
}

function receiver() {
  const state = {
    target: {window: {}, focus: {}},
    active: true,
    composing: false,
    sent: [],
    waits: [],
  };
  const options = {
    target: state.target,
    current: () => state.target,
    composing: () => state.composing,
    active: () => state.active,
    commit: text => state.sent.push(text),
    wait: async delay => { state.waits.push(delay); return true; },
  };
  return {state, options};
}

async function rejects(operation, code) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof InputError && error.code === code, 'Expected input error: ' + code);
    return;
  }
  throw new Error('Missing input error: ' + code);
}

const text = ('Aa 中文 日本語 한국어 🙂\t\r\n').repeat(40);
{
  const {state, options} = receiver();
  await submit(text, options);
  assert(state.sent.join('') === text.replaceAll('\r\n', '\n'), 'All scripts, tabs and newlines share one ordered delivery channel');
  assert(state.sent.length > 1 && state.waits.length === state.sent.length - 1
    && state.waits.every(delay => delay === 20), 'Yield 20 ms between chunks, never after the final chunk');
}

for (const condition of ['no-focus', 'composition', 'invalid-text']) {
  const {state, options} = receiver();
  if (condition === 'no-focus') state.target.focus = null;
  if (condition === 'composition') state.composing = true;
  const source = condition === 'invalid-text' ? 'a'.repeat(300) + '\0' : text;
  const code = {'no-focus': 'text_unavailable', composition: 'composition_active', 'invalid-text': 'invalid_text'}[condition];
  await rejects(() => submit(source, options), code);
  assert(!state.sent.length, condition + ': rejection must not send a valid prefix');
}

for (const condition of ['window', 'focus', 'composition', 'cancel', 'destroyed-wait']) {
  const {state, options} = receiver();
  options.wait = async () => {
    if (condition === 'window') state.target = {...state.target, window: {}};
    if (condition === 'focus') state.target = {...state.target, focus: {}};
    if (condition === 'composition') state.composing = true;
    if (condition === 'cancel') state.active = false;
    return condition !== 'destroyed-wait';
  };
  if (condition === 'window' || condition === 'focus')
    await rejects(() => submit(text, options), 'focus_changed');
  else if (condition === 'composition')
    await rejects(() => submit(text, options), 'composition_active');
  else
    await submit(text, options);
  assert(state.sent.length === 1, condition + ': no later chunk may escape or be redirected');
}

{
  const {state, options} = receiver();
  const failure = new Error('Receiver failed');
  let calls = 0;
  options.commit = () => { calls++; throw failure; };
  let caught;
  try { await submit(text, options); } catch (error) { caught = error; }
  assert(caught === failure && calls === 1 && !state.waits.length,
    'A submission error propagates without retry or fallback to another delivery path');
}

{
  const {state, options} = receiver();
  await submit('', options);
  assert(!state.sent.length && !state.waits.length, 'An empty task must not emit or wait');
  state.active = false;
  await submit(text, options);
  assert(!state.sent.length, 'An already cancelled task must not submit');
}

for (const code of ['busy', 'target_unavailable', 'text_unavailable', 'composition_active', 'focus_changed', 'invalid_text']) {
  let translated = '';
  const result = message(new InputError(code), text => { translated = text; return 'translated: ' + text; });
  assert(translated && result === 'translated: ' + translated, code + ': user-facing input failures must go through translation');
}
assert(message(new Error('Other failure'), () => { throw new Error('Must not translate unrelated errors'); }) === '',
  'Unrelated errors must retain their existing reporting path');
