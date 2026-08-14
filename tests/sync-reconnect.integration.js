import {SyncClient} from '../src/sync-client.js';

class TestSettings {
  constructor() {
    this._values = new Map(Object.entries({
      'sync-enabled': true,
      'device-id': '',
      'device-tag': 'Reconnect Integration',
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
let sawOfflineAfterOnline = false;
let complete;
const completed = new Promise((resolve, reject) => {
  complete = resolve;
  setTimeout(() => reject(new Error('Reconnect test timed out')), 15_000);
});

client.connect('status-changed', (_client, status) => {
  if (status === 'online') {
    onlineCount++;
    if (onlineCount === 1)
      print('FIRST_ONLINE');
    else if (onlineCount === 2 && sawOfflineAfterOnline) {
      print('RECONNECTED');
      complete();
    }
  } else if (status === 'offline' && onlineCount === 1) {
    sawOfflineAfterOnline = true;
    print('OFFLINE_AGAIN');
  }
});

await client.start();
if (client.connected)
  throw new Error('Reconnect test must start without the Service');
print('OFFLINE_READY');
await completed;
client.destroy();

if (onlineCount !== 2 || !sawOfflineAfterOnline)
  throw new Error('SyncClient did not recover after the Service restarted');
