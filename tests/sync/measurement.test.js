import GLib from 'gi://GLib';

import {assertProgress, delay, measure} from './integration/measure.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const responsive = await measure(() => delay(40));
assert(responsive.ticks >= 2, 'measurement must observe actual main-loop ticks');
const blocked = await measure(async () => {
  await delay(20);
  const until = GLib.get_monotonic_time() + 500_000;
  while (GLib.get_monotonic_time() < until) {
    // Deliberate blocking tail: the old probe incorrectly passed this case.
  }
});
assert(blocked.maximumDelay >= 450, 'measurement must detect a 500ms blocking tail');
for (const values of [[], [{bytes: 10, total: 10}], [
  {bytes: 8, total: 10}, {bytes: 4, total: 10}, {bytes: 10, total: 10},
], [{bytes: 2, total: 20}, {bytes: 10, total: 20}]]) {
  let rejected = false;
  try { assertProgress(values, 10); } catch (_error) { rejected = true; }
  assert(rejected, 'missing, final-only, regressing or wrong-total progress must fail');
}
assertProgress([{bytes: 2, total: 10}, {bytes: 10, total: 10}], 10);
