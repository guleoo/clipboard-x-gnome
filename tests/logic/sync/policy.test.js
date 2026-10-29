import {delivery} from '../../../src/sync/policy.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const thresholds = {
  get_uint: key => ({
    'text-full-threshold': 64 * 1024,
    'image-full-threshold': 1024 * 1024,
  })[key],
};
for (const [mime, boundary] of [['text/plain;charset=utf-8', 64 * 1024], ['image/png', 1024 * 1024]]) {
  for (const delta of [-1, 0, 1]) {
    assert(delivery(thresholds, mime, boundary + delta) === (delta <= 0 ? 'eager' : 'on-demand'),
      `${mime} delivery must apply exact byte limits, including equality (${delta})`);
  }
}
