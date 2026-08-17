import {delivery, effectiveCapabilities} from '../../src/sync/policy.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const values = new Map(Object.entries({
  'capture-size-limit-mib': 128,
  'text-preview-limit': 4096,
  'thumbnail-byte-limit': 262144,
  'sync-text': true,
  'sync-html': false,
  'sync-images': true,
}));
const settings = {
  get_int: key => values.get(key),
  get_uint: key => values.get(key),
  get_boolean: key => values.get(key),
};
const effective = effectiveCapabilities(settings, {
  MaxItemBytes: 64 * 1024 * 1024,
  MaxPreviewBytes: 64 * 1024,
  SupportedMimeTypes: ['text/plain;charset=utf-8', 'text/html', 'image/png'],
});
assertEqual(effective, {
  itemBytes: 64 * 1024 * 1024,
  previewBytes: 64 * 1024,
  mimeTypes: ['text/plain;charset=utf-8', 'image/png'],
}, 'Service capability display must show effective policy intersections');
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
