import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';
import {sha256} from '../src/core.js';
import {SyncClient} from '../src/sync-client.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

class TestSettings {
  constructor() {
    this._values = new Map(Object.entries({
      'sync-enabled': true,
      'device-id': '',
      'device-tag': 'Large FD Integration',
      'service-bus-name': 'io.github.guleo.ClipboardX.MockService',
      'service-object-path': '/io/github/guleo/ClipboardX/Sync',
      'sync-text': true,
      'sync-html': true,
      'sync-images': true,
      'text-preview-limit': 4096,
      'thumbnail-byte-limit': 262144,
      'sync-transfer-timeout-seconds': 10,
    }));
    this._signals = new Map();
    this._nextSignal = 1;
  }

  get_boolean(key) { return Boolean(this._values.get(key)); }
  get_string(key) { return String(this._values.get(key) ?? ''); }
  get_uint(key) { return Number(this._values.get(key) ?? 0); }
  set_string(key, value) { this._values.set(key, value); }
  connect(name, callback) {
    const id = this._nextSignal++;
    this._signals.set(id, {name, callback});
    return id;
  }
  disconnect(id) { this._signals.delete(id); }
}

const payload = new Uint8Array(50 * 1024 * 1024);
for (let offset = 0; offset < payload.length; offset += 1024 * 1024)
  payload[offset] = offset / (1024 * 1024);
const item = ClipboardItem.fromBytes('image/png', new GLib.Bytes(payload));
item.primary.delivery = 'on-demand';

const [file, stream] = Gio.File.new_tmp('clipboard-x-large-sync-XXXXXX');
stream.get_output_stream().write_all(payload, null);
stream.close(null);
item.primary.path = file.get_path();
const thumbnailPayload = GLib.base64_decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);
const thumbnailBytes = new GLib.Bytes(thumbnailPayload);
const [thumbnailFile, thumbnailStream] = Gio.File.new_tmp('clipboard-x-large-thumbnail-XXXXXX.png');
thumbnailStream.get_output_stream().write_all(thumbnailPayload, null);
thumbnailStream.close(null);
item.preview = {
  mimeType: 'image/png',
  path: thumbnailFile.get_path(),
  size: thumbnailBytes.get_size(),
  sha256: sha256(thumbnailBytes),
  truncated: true,
  derivedFrom: item.primary.id,
};

const textPayload = '剪切板 Clipboard X 👋\n'.repeat(Math.ceil(10 * 1024 * 1024 / 28));
const textItem = ClipboardItem.fromText(textPayload, {textPreviewLimit: 4096});
textItem.primary.delivery = 'on-demand';
const [textFile, textStream] = Gio.File.new_tmp('clipboard-x-large-text-sync-XXXXXX');
textStream.get_output_stream().write_all(textItem.primary.bytes.get_data(), null);
textStream.close(null);
textItem.primary.path = textFile.get_path();

const client = new SyncClient(new TestSettings());
const online = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Large SyncClient connection timed out')), 5000);
  client.connect('status-changed', (_client, status) => {
    if (status === 'online') {
      clearTimeout(timeout);
      resolve();
    }
  });
});

try {
  await client.start();
  await online;
  await client.publish(textItem);
  const remoteText = await client.getItem(textItem.id);
  assert(remoteText.primary.bytes === null && remoteText.preview.truncated,
    '10 MiB text must remain a truncated preview before materialization');
  assert(new TextEncoder().encode(remoteText.preview.text).length <= 4096,
    '10 MiB synchronized text preview must respect the configured limit');
  await client.materialize(remoteText);
  assert(remoteText.primary.bytes.get_size() === textItem.primary.size,
    '10 MiB text UNIX FD payload size must be preserved');
  assert(remoteText.primary.sha256 === textItem.primary.sha256,
    '10 MiB text UNIX FD payload hash must be preserved');

  await client.publish(item);
  const remote = await client.getItem(item.id);
  assert(remote.primary.bytes === null && remote.preview?.path,
    '50 MiB image must expose only its thumbnail before materialization');
  assert(remote.preview.size < remote.primary.size && remote.preview.derivedFrom === remote.primary.id,
    'large image thumbnail must be marked as derived and smaller than the original');
  await client.materialize(remote);
  assert(remote.primary.bytes.get_size() === payload.length, '50 MiB UNIX FD payload size must be preserved');
  assert(remote.primary.sha256 === item.primary.sha256, '50 MiB UNIX FD payload hash must be preserved');
} finally {
  client.destroy();
  file.delete(null);
  thumbnailFile.delete(null);
  textFile.delete(null);
}
