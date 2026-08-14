import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';
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
  await client.publish(item);
  const remote = await client.getItem(item.id);
  assert(remote.primary.bytes === null, '50 MiB image must remain preview-only before materialization');
  await client.materialize(remote);
  assert(remote.primary.bytes.get_size() === payload.length, '50 MiB UNIX FD payload size must be preserved');
  assert(remote.primary.sha256 === item.primary.sha256, '50 MiB UNIX FD payload hash must be preserved');
} finally {
  client.destroy();
  file.delete(null);
}
