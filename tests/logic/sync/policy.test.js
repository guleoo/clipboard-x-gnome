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
assert(delivery(thresholds, 'text/plain;charset=utf-8', 64 * 1024) === 'eager',
  'small text must use eager delivery');
assert(delivery(thresholds, 'text/plain;charset=utf-8', 64 * 1024 + 1) === 'on-demand',
  'large text must use on-demand delivery');
assert(delivery(thresholds, 'image/png', 1024 * 1024) === 'eager',
  'small image must use eager delivery');
assert(delivery(thresholds, 'image/png', 1024 * 1024 + 1) === 'on-demand',
  'large image must use on-demand delivery');
