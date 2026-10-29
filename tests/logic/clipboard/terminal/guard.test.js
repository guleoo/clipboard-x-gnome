import {cancel, shouldCancel} from '../../../../src/clipboard/terminal/guard.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const typing = {cancelled: false};
for (const state of [
  {monitoring: false, emitting: false, keyPress: true},
  {monitoring: true, emitting: true, keyPress: true},
  {monitoring: true, emitting: false, keyPress: false},
]) {
  assert(!shouldCancel(state) && !typing.cancelled,
    'Inactive monitoring, own emission and non-key events must not interrupt input');
}
assert(shouldCancel({monitoring: true, emitting: false, keyPress: true}),
  'A key press outside synchronous own emission must request cancellation');
assert(cancel(typing) && typing.cancelled, 'The first interruption must cancel the active operation');
assert(!cancel(typing) && typing.cancelled,
  'Repeated interruption must keep cancellation terminal and must not schedule another notification');
assert(!cancel(null), 'An event without active typing must not schedule a cancellation notification');
const next = {cancelled: false};
assert(cancel(next) && next.cancelled, 'A distinct new typing operation has its own single cancellation');
