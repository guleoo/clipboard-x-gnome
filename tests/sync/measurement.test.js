import GLib from 'gi://GLib';

import {assertProgress, delay, measure} from './integration/measure.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const responsive = await measure(() => delay(40));
assert(responsive.ticks >= 2, 'measurement must observe actual main-loop ticks');
const blocked = await measure(async probe => {
  await delay(20);
  probe.stage('blocking-tail');
  const until = GLib.get_monotonic_time() + 500_000;
  while (GLib.get_monotonic_time() < until) {
    // Deliberate blocking tail: the old probe incorrectly passed this case.
  }
});
assert(blocked.maximumDelay >= 450, 'measurement must detect a 500ms blocking tail');
assert(blocked.stalls.some(stall => stall.extraMilliseconds >= 450),
  'diagnostics must retain the full long-gap interval');
const blockingStage = blocked.stages.find(stage => stage.name === 'blocking-tail');
const completedStage = blocked.stages.find(stage => stage.name === 'completed');
assert(completedStage.milliseconds - blockingStage.milliseconds >= 490,
  'stage timing must attribute a synchronous blocking tail before the next timer runs');
assert(blocked.stalls.some(stall => stall.fromMilliseconds <= blockingStage.milliseconds
    && stall.toMilliseconds >= completedStage.milliseconds),
  'gap boundaries must expose stage transitions that precede timer dispatch');
for (const values of [[], [{bytes: 10, total: 10}], [
  {bytes: 8, total: 10}, {bytes: 4, total: 10}, {bytes: 10, total: 10},
], [{bytes: 2, total: 20}, {bytes: 10, total: 20}]]) {
  let rejected = false;
  try { assertProgress(values, 10); } catch (_error) { rejected = true; }
  assert(rejected, 'missing, final-only, regressing or wrong-total progress must fail');
}
assertProgress([{bytes: 2, total: 10}, {bytes: 10, total: 10}], 10);
