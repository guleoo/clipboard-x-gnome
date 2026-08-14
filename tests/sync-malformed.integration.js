import {SyncClient} from '../src/sync-client.js';

class TestSettings {
  constructor() {
    this._values = new Map(Object.entries({
      'sync-enabled': true,
      'device-id': '',
      'device-tag': 'Malformed Service Integration',
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

const client = new SyncClient(new TestSettings());
let itemEvents = 0;
const connected = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Malformed Service test timed out')), 5000);
  client.connect('item-available', () => itemEvents++);
  client.connect('status-changed', (_client, status) => {
    if (status === 'online') {
      clearTimeout(timeout);
      resolve();
    }
  });
});

try {
  await client.start();
  await connected;
  await new Promise(resolve => setTimeout(resolve, 50));
  if (itemEvents !== 0)
    throw new Error('Malformed item signal escaped client validation');
  if (client.capabilities === null)
    throw new Error('Malformed notification unnecessarily invalidated the healthy Service connection');
} finally {
  client.destroy();
}
