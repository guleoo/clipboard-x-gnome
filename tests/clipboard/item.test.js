import GLib from 'gi://GLib';

import {ClipboardItem} from '../../src/clipboard/item.js';
import {isUuid} from '../../src/common/uuid.js';
import {bytesFromString} from '../../src/common/bytes.js';

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
const legacy = {...item.toJSON(), originDeviceIconColor: {light: '#ffffff', dark: '#555555'}};
const withoutColor = ClipboardItem.fromJSON(legacy);
assert(!Object.hasOwn(withoutColor.toJSON(), 'originDeviceIconColor'),
  'previously stored icon colors must be ignored and not persisted again');
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

const identicalBytes = bytesFromString('Hello');
const identical = ClipboardItem.fromRepresentations([
  {mimeType: 'text/html', bytes: identicalBytes},
  {mimeType: 'UTF8_STRING', bytes: identicalBytes},
  {mimeType: 'text/plain;charset=utf-8', bytes: identicalBytes},
]);
assert(identical.representations.length === 2
    && new Set(identical.representations.map(value => value.id)).size === 2,
  'distinct MIME representations must have distinct IDs even when their payloads are identical');
assert(identical.representations.every(value => value.sha256 === identical.primary.sha256),
  'representation identity must not change the shared payload SHA');
assert(identical.preview.derivedFrom === identical.primary.id && identical.preview.text === 'Hello'
    && !identical.preview.truncated,
  'the complete plain-text preview must reference its own representation');
assertEqual(identical.representations.map(value => value.id),
  ClipboardItem.fromRepresentations([
    {mimeType: 'text/plain', bytes: identicalBytes},
    {mimeType: 'text/html', bytes: identicalBytes},
  ]).representations.map(value => value.id),
  'representation IDs must be stable across MIME aliases, input ordering and repeated capture');
const recorded = item.toJSON();
recorded.representations = recorded.representations.map(value => ({...value, id: 'already-published-content'}));
recorded.preview = {...recorded.preview, derivedFrom: 'already-published-content'};
assertEqual(ClipboardItem.fromJSON(recorded).toJSON(), recorded,
  'loading persisted content must preserve its recorded IDs and preview association');
