import {Activity} from '../../../src/clipboard/terminal/activity.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const activity = new Activity(250_000);
const keyboard = {};
assert(activity.ready(0), 'fresh input activity must be idle');

activity.update(keyboard, 30, true, 1_000_000);
assert(!activity.ready(2_000_000), 'held physical key must pause simulated typing');

activity.update(keyboard, 31, true, 2_000_000);
activity.update(keyboard, 30, false, 2_100_000);
assert(!activity.ready(3_000_000), 'simulated typing must wait for every physical key to be released');

activity.update(keyboard, 31, false, 3_000_000);
assert(!activity.ready(3_249_999), 'typing must remain paused during the quiet period');
assert(activity.ready(3_250_000), 'typing must resume after all keys are released and the quiet period expires');

activity.reset();
assert(activity.ready(0), 'reset activity must not delay the next operation');
