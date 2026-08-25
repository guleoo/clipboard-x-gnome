import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../../src/clipboard/item.js';
import {SyncClient} from '../../src/sync/client.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const deviceId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';
const transferId = '33333333-3333-4333-8333-333333333333';
const uploadId = '44444444-4444-4444-8444-444444444444';

class TestSettings {
  constructor() {
    this._values = new Map([
      ['sync-enabled', true],
      ['device-id', deviceId],
      ['device-tag', 'Test laptop'],
      ['device-icon-kind', 'laptop'],
      ['sync-text', true],
      ['sync-html', true],
      ['sync-images', true],
      ['text-preview-limit', 4096],
      ['thumbnail-byte-limit', 256 * 1024],
      ['sync-transfer-timeout-seconds', 30],
    ]);
    this._nextSignal = 1;
    this._signals = new Map();
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

  connect(name, callback) {
    const id = this._nextSignal++;
    this._signals.set(id, {name, callback});
    return id;
  }

  disconnect(id) {
    this._signals.delete(id);
  }
}

class TestStore {
  constructor() {
    this.value = {
      serverAddress: 'http://127.0.0.1:8765',
      apiKey: 'test-api-key',
      activeChannelId: channelId,
      cursors: {},
      workCursor: '',
    };
  }

  async load() {
    return this.current;
  }

  async saveConnection(value) {
    this.value = {
      ...this.value,
      serverAddress: value.serverAddress,
      apiKey: value.apiKey,
      activeChannelId: value.activeChannelId,
    };
    return this.current;
  }

  async saveProgress(value) {
    this.value = {...value, cursors: {...value.cursors}};
    return this.current;
  }

  get current() {
    return {...this.value, cursors: {...this.value.cursors}};
  }
}

class TestTransport {
  constructor() {
    this.uploadedBytes = 0;
    this.aborted = false;
    this.itemId = '';
    this.totalBytes = 0;
  }

  status() {
    return Promise.resolve({
      apiVersion: 1,
      serverVersion: 'test',
      state: 'online',
      capabilities: {
        supportedMimeTypes: ['text/plain;charset=utf-8'],
        maxItemBytes: 64 * 1024 * 1024,
        maxPreviewBytes: 256 * 1024,
      },
    });
  }

  device() {
    return Promise.resolve(this._device());
  }

  updateProfile(profile) {
    return Promise.resolve(this._device(profile));
  }

  channels() {
    return Promise.resolve({channels: [{id: channelId, name: 'Test channel'}]});
  }

  transfers() {
    return Promise.resolve({transfers: []});
  }

  changes(_channelId, cursor) {
    return Promise.resolve({cursor: cursor || 'initial', hasMore: false, changes: []});
  }

  work(cursor) {
    return Promise.resolve({cursor: cursor || 'initial', hasMore: false, work: []});
  }

  createItem(_channelId, manifest) {
    this.itemId = manifest.id;
    const previewIds = manifest.previews.map(value => value.id);
    const contentIds = manifest.contents.filter(value => value.delivery === 'eager').map(value => value.id);
    this.totalBytes = [
      ...manifest.previews.map(value => value.size),
      ...manifest.contents.filter(value => value.delivery === 'eager').map(value => value.size),
    ].reduce((sum, value) => sum + value, 0);
    return Promise.resolve({
      itemId: manifest.id,
      uploadId,
      previewIds,
      contentIds,
      transfer: this._transfer('queued', 0),
    });
  }

  uploadPreview(_uploadId, _previewId, source, onProgress) {
    this.uploadedBytes += source.size;
    onProgress(source.size);
    return Promise.resolve({});
  }

  uploadContent(_uploadId, _contentId, source, onProgress) {
    this.uploadedBytes += source.size;
    onProgress(source.size);
    return Promise.resolve({});
  }

  completeUpload() {
    return Promise.resolve({transfer: this._transfer('completed', this.totalBytes)});
  }

  abort() {
    this.aborted = true;
  }

  _device(profile = {}) {
    return {
      id: deviceId,
      tag: profile.tag ?? 'Test laptop',
      iconKind: profile.iconKind ?? 'laptop',
      state: 'online',
      lastSeenAt: 1,
    };
  }

  _transfer(state, completedBytes) {
    return {
      id: transferId,
      itemId: this.itemId,
      deviceId,
      kind: 'publish',
      direction: 'upload',
      state,
      completedBytes,
      totalBytes: this.totalBytes,
      peerDeviceIds: [],
      createdAt: 1,
      updatedAt: state === 'completed' ? 2 : 1,
    };
  }
}

const directory = GLib.dir_make_tmp('clipboard-x-sync-client-test-XXXXXX');
const path = GLib.build_filenamev([directory, 'content.txt']);
const file = Gio.File.new_for_path(path);
const settings = new TestSettings();
const store = new TestStore();
const transport = new TestTransport();
const client = new SyncClient(settings, {
  configurationStore: store,
  transportFactory: () => transport,
});

try {
  file.replace_contents('hello', null, false, Gio.FileCreateFlags.PRIVATE, null);
  await client.start();
  assert(client.connected && client.channels[0].active,
    'client start must authenticate, register the device and select its channel');
  assert(store.value.cursors[channelId] === 'initial' && store.value.workCursor === 'initial',
    'poll cursors must be persisted without a background Service');

  const item = ClipboardItem.fromText('hello', {originDeviceId: deviceId});
  item.representations[0].path = path;
  const result = await client.publish(item);
  assert(result.itemId === item.id && result.transferId === transferId,
    'publishing must return server item and transfer identities');
  assert(transport.uploadedBytes === transport.totalBytes,
    'preview and eager content must be streamed exactly once');
  assert(client.getTransferForItem(item.id).state === 'completed',
    'completed server progress must replace local streaming progress');
} finally {
  client.destroy();
  try {
    file.delete(null);
  } catch (_error) {
    // The test may fail before creating its fixture.
  }
  Gio.File.new_for_path(directory).delete(null);
}

assert(transport.aborted, 'disabling the extension must abort in-flight HTTP work');
