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
      'device-tag': 'Sync Client Integration',
      'service-bus-name': 'io.github.guleo.ClipboardX.MockService',
      'service-object-path': '/io/github/guleo/ClipboardX/Sync',
      'sync-text': true,
      'sync-html': true,
      'sync-images': true,
      'text-preview-limit': 4096,
      'thumbnail-byte-limit': 262144,
      'sync-transfer-timeout-seconds': 5,
    }));
    this._signals = new Map();
    this._nextSignal = 1;
  }

  get_boolean(key) {
    return Boolean(this._values.get(key));
  }

  get_string(key) {
    return String(this._values.get(key) ?? '');
  }

  get_uint(key) {
    return Number(this._values.get(key) ?? 0);
  }

  set_string(key, value) {
    this._values.set(key, value);
  }

  changeString(key, value) {
    this._values.set(key, value);
    for (const signal of this._signals.values()) {
      if (signal.name === `changed::${key}`)
        signal.callback();
    }
  }

  connect(name, callback) {
    const id = this._nextSignal++;
    this._signals.set(id, {name, callback});
    return id;
  }

  disconnect(id) {
    this._signals.delete(id);
  }
}

const settings = new TestSettings();
const client = new SyncClient(settings);
const online = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('SyncClient connection timed out')), 5000);
  client.connect('status-changed', (_client, status) => {
    if (status === 'online') {
      clearTimeout(timeout);
      resolve();
    }
  });
});
await client.start();
await online;
assert(client.connected, 'SyncClient must connect to the Mock Service');
assert(client.capabilities?.apiVersion === 1, 'SyncClient must negotiate Sync1');
const expectedImplementation = GLib.getenv('CLIPBOARD_X_EXPECTED_IMPLEMENTATION')
  ?? 'Clipboard X Mock Service';
assert(client.capabilities?.implementationName === expectedImplementation,
  'SyncClient must expose Service identity');
assert(settings.get_string('device-id').length === 36, 'SyncClient must generate and persist DeviceId');

const item = ClipboardItem.fromText('full synchronized content');
item.primary.delivery = 'on-demand';
const [file, stream] = Gio.File.new_tmp('clipboard-x-sync-client-XXXXXX');
stream.get_output_stream().write_all(item.primary.bytes.get_data(), null);
stream.close(null);
item.primary.path = file.get_path();

try {
  const publishedId = await client.publish(item);
  assert(publishedId === item.id, 'SyncClient must preserve immutable item IDs');
  assert(await client.publish(item) === item.id, 'repeated Publish must be idempotent');
  const pending = await client.listPending();
  assert(pending.filter(itemId => itemId === item.id).length === 1,
    'repeated Publish must not create duplicate pending items');

  const remote = await client.getItem(item.id);
  assert(remote.remote && remote.availability === 'preview', 'GetItem must create a preview-only remote item');
  assert(remote.primary.bytes === null, 'GetItem must not eagerly read full content');
  assert(remote.preview.text === 'full synchronized content', 'GetItem must receive the text preview');
  assert(remote.originDeviceTag === 'Sync Client Integration', 'GetItem must resolve the friendly Device Tag');
  const stableDeviceId = settings.get_string('device-id');
  settings.changeString('device-tag', '工作设备 🐧');
  let updatedTag = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    updatedTag = (await client.getItem(item.id)).originDeviceTag;
    if (updatedTag === '工作设备 🐧')
      break;
  }
  assert(updatedTag === '工作设备 🐧', 'Device Tag change must update the Service registration');
  assert(settings.get_string('device-id') === stableDeviceId, 'Device Tag change must not alter DeviceId');

  await client.materialize(remote);
  assert(remote.availability === 'ready', 'Materialization must update availability');
  assert(remote.text === 'full synchronized content', 'Materialization must return verified original bytes');
  await client.acknowledge(remote.id, 'accepted');
  await client.acknowledge(remote.id, 'accepted');

  const cancelled = new Promise(resolve => {
    client.connect('transfer-changed', (_client, transferId, state) => {
      if (state === 'cancelled')
        resolve(transferId);
    });
  });
  const transferId = await client.requestContent(remote.id, [remote.primary.id]);
  await client.cancelTransfer(transferId);
  assert(await cancelled === transferId, 'CancelTransfer must report the cancelled state');
  await client.cancelTransfer(transferId);

  const unsupported = ClipboardItem.fromBytes(
    'image/gif',
    new GLib.Bytes(new Uint8Array([0x47, 0x49, 0x46])),
  );
  await assertRejects(client.publish(unsupported), /reject all representations/u,
    'Service MIME capabilities must restrict publication');
  await assertRejects(client.getItem('../../invalid'), /UUID/u, 'invalid item ID must be rejected locally');
  await assertRejects(client.requestContent(item.id, ['bad\ncontent']), /request is invalid/u,
    'invalid content ID must be rejected locally');
  await assertRejects(client.cancelTransfer('not-a-transfer'), /transfer ID is invalid/u,
    'invalid transfer ID must be rejected locally');
} finally {
  client.destroy();
  file.delete(null);
}

const invalidSettings = new TestSettings();
invalidSettings._values.set('service-bus-name', 'invalid bus name');
const invalidClient = new SyncClient(invalidSettings);
let invalidAddressRejected = false;
try {
  await invalidClient.start();
} catch (error) {
  invalidAddressRejected = /bus name is invalid/u.test(error.message);
} finally {
  invalidClient.destroy();
}
assert(invalidAddressRejected, 'SyncClient must reject an invalid configured D-Bus address');
