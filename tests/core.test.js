import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';
import {formatColor, sampleRegion} from '../src/color.js';
import {buildEditorArgv} from '../src/editor-launcher.js';
import {EventEmitter} from '../src/event-emitter.js';
import {ensureDeviceIdentity, isUuid, truncateUtf8} from '../src/core.js';
import {processText, TextProcessors} from '../src/text-processors.js';
import {effectiveCapabilities} from '../src/sync-policy.js';

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
  assertEqual(processText('graphemes', 'A 👨‍👩‍👧‍👦 中'), ['A', '👨‍👩‍👧‍👦', '中'],
    'grapheme processor must preserve joined emoji and omit whitespace');
  assertEqual(processText('uppercase', 'Clipboard 中文'), ['CLIPBOARD 中文'], 'uppercase transformation');
  assertEqual(processText('lowercase', 'Clipboard 中文'), ['clipboard 中文'], 'lowercase transformation');
  assertEqual(processText('title-case', 'clipboard_x SYNC'), ['Clipboard_x Sync'], 'title-case transformation');
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
  assertEqual(buildEditorArgv("editor '$(not-a-shell)' %f", 'file:///tmp/a b.png', '/tmp/a b.png'),
    ['editor', '$(not-a-shell)', '/tmp/a b.png'], 'command arguments must never be evaluated by a shell');
  assertEqual(buildEditorArgv('flatpak run be.alexandervanhee.gradia %u',
    'file:///tmp/截图%20“quoted”.png', '/tmp/截图 “quoted”.png'),
  ['flatpak', 'run', 'be.alexandervanhee.gradia', 'file:///tmp/截图%20“quoted”.png'],
  'Flatpak editor command must preserve a Unicode URI as one argument');
  let rejected = false;
  try {
    buildEditorArgv('editor %x', 'file:///tmp/a.png', '/tmp/a.png');
  } catch (_error) {
    rejected = true;
  }
  assert(rejected, 'unknown editor placeholders must be rejected');
  rejected = false;
  try {
    buildEditorArgv('editor %f', 'https://example.test/remote.png', null);
  } catch (_error) {
    rejected = true;
  }
  assert(rejected, 'local-path placeholder must reject a non-local URI');
}

function testColorTools() {
  assertEqual(formatColor([255, 0, 0], 'hex'), '#FF0000', 'HEX color format');
  assertEqual(formatColor([255, 0, 0], 'rgb'), 'rgb(255, 0, 0)', 'RGB color format');
  assertEqual(formatColor([255, 0, 0], 'hsl'), 'hsl(0 100% 50%)', 'HSL color format');
  assertEqual(formatColor([255, 0, 0], 'oklch'), 'oklch(62.80% 0.2577 29.23)', 'OKLCH color format');
  assertEqual(sampleRegion(0, 0, 2, 200, 100, 5),
    {x: 0, y: 0, width: 6, height: 6, centerX: 0, centerY: 0},
    'magnifier region must clamp at the top-left texture edge');
  assertEqual(sampleRegion(49.5, 24.5, 2, 100, 50, 5),
    {x: 94, y: 44, width: 6, height: 6, centerX: 5, centerY: 5},
    'magnifier coordinates must scale and clamp at the bottom-right edge');
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

function testEffectiveSyncCapabilities() {
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
}

testClipboardItem();
testTextProcessors();
testTruncation();
testDeviceIdentity();
testEditorArgv();
testColorTools();
testEventEmitter();
testEffectiveSyncCapabilities();
