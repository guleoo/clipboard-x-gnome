import {SyncClient} from '../src/sync-client.js';

class TestSettings {
  constructor() {
    this._values = new Map(Object.entries({
      'sync-enabled': true,
      'device-id': '',
      'device-tag': 'Reconnect Stress',
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
let onlineCount = 0;
let offlineCount = 0;
let complete;
const completed = new Promise((resolve, reject) => {
  complete = resolve;
  setTimeout(() => reject(new Error('Reconnect stress test timed out')), 20_000);
});

client.connect('status-changed', (_client, status) => {
  if (status === 'online') {
    onlineCount++;
    print(`STRESS_ONLINE_${onlineCount}`);
    if (onlineCount === 6 && offlineCount === 5)
      complete();
  } else if (status === 'offline' && onlineCount > offlineCount) {
    offlineCount++;
    print(`STRESS_OFFLINE_${offlineCount}`);
  }
});

await client.start();
await completed;
client.destroy();

if (onlineCount !== 6 || offlineCount !== 5)
  throw new Error(`Unexpected reconnect counts: ${onlineCount} online, ${offlineCount} offline`);
