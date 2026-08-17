import GLib from 'gi://GLib';

import {ClipboardItem} from '../../src/clipboard/item.js';
import {isUuid} from '../../src/common/uuid.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const item = ClipboardItem.fromText('你好 Clipboard X', {textPreviewLimit: 8});
assert(isUuid(item.id), 'clipboard item ID must be a UUID v4');
assert(item.isText, 'text item must be recognized');
assert(item.preview.truncated, 'UTF-8 preview should be truncated');
assert(new TextEncoder().encode(item.preview.text).length <= 8, 'preview must respect byte limit');

const restored = ClipboardItem.fromJSON(item.toJSON());
assertEqual(restored.toJSON(), item.toJSON(), 'clipboard item JSON roundtrip');
const interrupted = item.toJSON();
interrupted.remote = true;
interrupted.availability = 'waiting-for-source';
assert(ClipboardItem.fromJSON(interrupted).availability === 'failed',
  'interrupted remote transfer must become retryable after restart');

const richItem = ClipboardItem.fromRepresentations([
  {mimeType: 'text/html', bytes: new GLib.Bytes(new TextEncoder().encode('<b>Hello</b>'))},
  {mimeType: 'UTF8_STRING', bytes: new GLib.Bytes(new TextEncoder().encode('Hello'))},
]);
assertEqual(richItem.representations.map(value => value.mimeType),
  ['text/plain;charset=utf-8', 'text/html'], 'multi-MIME representations should be normalized and ordered');
assertEqual(richItem.text, 'Hello', 'plain text should be preferred for text processing');
