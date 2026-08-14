import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';
import {buildEditorArgv} from '../src/editor-launcher.js';
import {EventEmitter} from '../src/event-emitter.js';
import {ensureDeviceIdentity, isUuid, truncateUtf8} from '../src/core.js';
import {processText, TextProcessors} from '../src/text-processors.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function testClipboardItem() {
  const item = ClipboardItem.fromText('你好 Clipboard X', {textPreviewLimit: 8});
  assert(isUuid(item.id), 'clipboard item ID must be a UUID v4');
  assert(item.isText, 'text item must be recognized');
  assert(item.preview.truncated, 'UTF-8 preview should be truncated');
  assert(new TextEncoder().encode(item.preview.text).length <= 8, 'preview must respect byte limit');

  const restored = ClipboardItem.fromJSON(item.toJSON());
  assertEqual(restored.toJSON(), item.toJSON(), 'clipboard item JSON roundtrip');

  const richItem = ClipboardItem.fromRepresentations([
    {mimeType: 'text/html', bytes: new GLib.Bytes(new TextEncoder().encode('<b>Hello</b>'))},
    {mimeType: 'UTF8_STRING', bytes: new GLib.Bytes(new TextEncoder().encode('Hello'))},
  ]);
  assertEqual(richItem.representations.map(value => value.mimeType),
    ['text/plain;charset=utf-8', 'text/html'], 'multi-MIME representations should be normalized and ordered');
  assertEqual(richItem.text, 'Hello', 'plain text should be preferred for text processing');
}

function testTextProcessors() {
  assertEqual(processText('lines', ' a\n\n b '), ['a', 'b'], 'line processor');
  assertEqual(processText('identifiers', 'clipboardSync_device-id'),
    ['clipboard', 'Sync', 'device', 'id'], 'identifier processor');
  assertEqual(processText('urls', 'see https://example.com/a and https://example.com/a'),
    ['https://example.com/a'], 'URL processor should deduplicate');
  const words = processText('words', '中文分词 works');
  assert(words.includes('works') && words.some(word => word !== 'works'),
    'word processor should segment mixed text without assuming a specific ICU dictionary');
  TextProcessors.register('brackets', text => text.match(/\[[^\]]+\]/gu) ?? []);
  assertEqual(processText('brackets', 'a [one] [二]'), ['[one]', '[二]'],
    'custom text processor registration');
}

function testTruncation() {
  const result = truncateUtf8('A👨‍👩‍👧‍👦B', 2);
  assertEqual(result.text, 'A', 'truncation must preserve grapheme clusters');
  assert(result.truncated, 'truncation flag');
}

function testDeviceIdentity() {
  const values = new Map([
    ['device-id', 'not-a-uuid'],
    ['device-tag', ' 工作电脑 '],
  ]);
  const settings = {
    get_string: key => values.get(key),
    set_string: (key, value) => values.set(key, value),
  };
  const first = ensureDeviceIdentity(settings);
  const second = ensureDeviceIdentity(settings);
  assert(isUuid(first.deviceId), 'invalid persisted DeviceId must be replaced with UUID v4');
  assertEqual(second.deviceId, first.deviceId, 'DeviceId must remain stable after generation');
  assertEqual(first.deviceTag, '工作电脑', 'Device Tag should be trimmed for registration');
}

function testEditorArgv() {
  assertEqual(buildEditorArgv('gradia %u', 'file:///tmp/a b.png', '/tmp/a b.png'),
    ['gradia', 'file:///tmp/a b.png'], 'URI placeholder');
  assertEqual(buildEditorArgv('gimp %f', 'file:///tmp/a.png', '/tmp/a.png'),
    ['gimp', '/tmp/a.png'], 'file placeholder');
  assertEqual(buildEditorArgv('editor --label=100%%', 'file:///tmp/a.png', '/tmp/a.png'),
    ['editor', '--label=100%', 'file:///tmp/a.png'], 'literal percent and implicit URI');
}

function testEventEmitter() {
  const emitter = new EventEmitter();
  let value = 0;
  const id = emitter.connect('change', (_source, next) => value = next);
  emitter.emit('change', 3);
  assertEqual(value, 3, 'event emitter delivery');
  emitter.disconnect(id);
  emitter.emit('change', 4);
  assertEqual(value, 3, 'event emitter disconnect');
}

testClipboardItem();
testTextProcessors();
testTruncation();
testDeviceIdentity();
testEditorArgv();
testEventEmitter();
