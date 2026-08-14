import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';
import {SyncClient} from '../src/sync-client.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function assertRejects(promise, pattern, message) {
  try {
    await promise;
  } catch (error) {
    assert(pattern.test(error.message), `${message}: ${error.message}`);
    return;
  }
  throw new Error(`${message}: promise resolved unexpectedly`);
}

class TestSettings {
  constructor() {
    this._values = new Map(Object.entries({
      'sync-enabled': true,
      'device-id': '',
      'device-tag': 'Policy Integration',
      'service-bus-name': 'io.github.guleo.ClipboardX.MockService',
      'service-object-path': '/io/github/guleo/ClipboardX/Sync',
      'sync-text': true,
      'sync-html': true,
      'sync-images': true,
      'text-preview-limit': 4096,
      'thumbnail-byte-limit': 262144,
      'sync-transfer-timeout-seconds': 5,
    }));
    this._nextSignal = 1;
  }

  get_boolean(key) { return Boolean(this._values.get(key)); }
  get_string(key) { return String(this._values.get(key) ?? ''); }
  get_uint(key) { return Number(this._values.get(key) ?? 0); }
  set_string(key, value) { this._values.set(key, value); }
  connect() { return this._nextSignal++; }
  disconnect() {}
}

function persistRepresentations(item) {
  const files = [];
  for (const representation of item.representations) {
    const [file, stream] = Gio.File.new_tmp('clipboard-x-policy-XXXXXX');
    stream.get_output_stream().write_all(representation.bytes.get_data(), null);
    stream.close(null);
    representation.path = file.get_path();
    files.push(file);
  }
  return files;
}

const settings = new TestSettings();
const client = new SyncClient(settings);
const online = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Policy SyncClient connection timed out')), 5000);
  client.connect('status-changed', (_client, status) => {
    if (status === 'online') {
      clearTimeout(timeout);
      resolve();
    }
  });
});
const files = [];

try {
  await client.start();
  await online;
  assert(client.capabilities.maxItemBytes === 16, 'test Service must advertise its small item limit');
  assert(client.capabilities.maxPreviewBytes === 8, 'test Service must advertise its small preview limit');

  const tooLarge = ClipboardItem.fromText('0123456789abcdefg');
  await assertRejects(client.publish(tooLarge), /Service limit of 16/u,
    'Service item limit must be enforced before opening payload files');

  const previewed = ClipboardItem.fromText('你好abc');
  files.push(...persistRepresentations(previewed));
  await client.publish(previewed);
  const remotePreview = await client.getItem(previewed.id);
  assert(new TextEncoder().encode(remotePreview.preview.text).length <= 8,
    'effective Service preview limit must truncate UTF-8 safely');
  assert(remotePreview.preview.truncated, 'Service-limited preview must be marked truncated');

  const rich = ClipboardItem.fromRepresentations([
    {mimeType: 'text/plain', bytes: new GLib.Bytes(new TextEncoder().encode('plain'))},
    {mimeType: 'text/html', bytes: new GLib.Bytes(new TextEncoder().encode('<b>html</b>'))},
  ]);
  files.push(...persistRepresentations(rich));
  await client.publish(rich);
  const filtered = await client.getItem(rich.id);
  assert(filtered.representations.length === 1
      && filtered.primary.mimeType === 'text/plain;charset=utf-8',
  'Service MIME capabilities must filter unsupported representations');
} finally {
  client.destroy();
  for (const file of files) {
    try {
      file.delete(null);
    } catch (_error) {
      // A failed publication may leave no temporary file.
    }
  }
}
