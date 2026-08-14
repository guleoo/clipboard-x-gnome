import Gio from 'gi://Gio';

import {ClipboardItem} from '../src/clipboard-item.js';
import {SyncClient} from '../src/sync-client.js';

class TestSettings {
  constructor() {
    this._values = new Map(Object.entries({
      'sync-enabled': true,
      'device-id': '',
      'device-tag': 'Offline Transfer Integration',
      'service-bus-name': 'io.github.guleo.ClipboardX.MockService',
      'service-object-path': '/io/github/guleo/ClipboardX/Sync',
      'sync-text': true,
      'sync-html': true,
      'sync-images': true,
      'text-preview-limit': 4096,
      'thumbnail-byte-limit': 262144,
      'sync-transfer-timeout-seconds': 10,
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

const item = ClipboardItem.fromText('offline during synchronized transfer');
item.primary.delivery = 'on-demand';
const [file, stream] = Gio.File.new_tmp('clipboard-x-offline-transfer-XXXXXX');
stream.get_output_stream().write_all(item.primary.bytes.get_data(), null);
stream.close(null);
item.primary.path = file.get_path();

const client = new SyncClient(new TestSettings());
const online = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Offline transfer connection timed out')), 5000);
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
  client.connect('transfer-changed', (_client, transfer) => {
    if (transfer.state === 'queued' && transfer.kind === 'content')
      print('TRANSFER_STARTED');
  });
  try {
    await client.materialize(remote);
    throw new Error('Transfer unexpectedly survived Service shutdown');
  } catch (error) {
    if (!/offline/u.test(error.message))
      throw error;
    if (remote.availability !== 'failed')
      throw new Error('Offline transfer did not leave the item retryable');
    print('TRANSFER_OFFLINE');
  }
} finally {
  client.destroy();
  file.delete(null);
}
