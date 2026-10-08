import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../../src/clipboard/item.js';
import {TransferTracker} from '../../src/sync/transfers.js';
import {SyncClient} from '../../src/sync/client.js';
import {MAX_TRANSFER_STATES} from '../../src/sync/constants.js';
import {delay} from './integration/measure.js';
import {STRESS_SYNC_LOAD} from './load-profile.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const deviceId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';

class StressSettings {
  constructor() {
    this._values = new Map([
      ['sync-enabled', true], ['device-id', deviceId], ['device-tag', 'Stress laptop'],
      ['device-icon-kind', 'laptop'], ['sync-text', true], ['sync-html', true],
      ['sync-images', true], ['text-preview-limit', 4096], ['thumbnail-byte-limit', 256 * 1024],
      ['sync-transfer-timeout-seconds', 30],
    ]);
    this._nextSignal = 1;
  }

  get_boolean(key) { return Boolean(this._values.get(key)); }
  get_string(key) { return String(this._values.get(key) ?? ''); }
  get_uint(key) { return Number(this._values.get(key) ?? 0); }
  connect() { return this._nextSignal++; }
  disconnect() {}
}

class StressStore {
  constructor() {
    this.value = {
      serverAddress: 'http://127.0.0.1:8765', apiKey: 'stress-key', activeChannelId: channelId,
      cursors: {}, workCursor: '',
    };
    this.progressSaves = 0;
  }

  async load() { return this.current; }
  async saveConnection(value) {
    this.value = {...this.value, ...value, cursors: {...this.value.cursors}};
    return this.current;
  }
  async saveProgress(value) {
    this.progressSaves++;
    this.value = {...value, cursors: {...value.cursors}};
    return this.current;
  }
  get current() { return {...this.value, cursors: {...this.value.cursors}}; }
}

class StressTransport {
  constructor() {
    this._changes = Array.from({length: STRESS_SYNC_LOAD.incomingChanges}, (_, index) => ({
      sequence: index + 1, kind: 'upsert', itemId: GLib.uuid_string_random(), reason: '',
    }));
    this._work = [];
    this._uploads = new Map();
    this.uploadedBytes = 0;
    this.completedUploads = 0;
    this.activeUploads = 0;
    this.maxConcurrentUploads = 0;
  }

  status() {
    return Promise.resolve({apiVersion: 1, serverVersion: 'stress', state: 'online', capabilities: {
      supportedMimeTypes: ['text/plain;charset=utf-8'], maxItemBytes: 64 * 1024 * 1024,
      maxPreviewBytes: 256 * 1024,
    }});
  }
  device() { return Promise.resolve(this._device()); }
  updateProfile(profile) { return Promise.resolve(this._device(profile)); }
  channels() { return Promise.resolve({channels: [{id: channelId, name: 'Stress channel'}]}); }
  transfers() { return Promise.resolve({transfers: []}); }

  changes(_channel, cursor, limit = 200) {
    const offset = Number(cursor || 0);
    const values = this._changes.slice(offset, offset + limit);
    return Promise.resolve({cursor: String(offset + values.length), hasMore: offset + values.length < this._changes.length, changes: values});
  }

  work(cursor, limit = 100) {
    const offset = Number(cursor || 0);
    const values = this._work.slice(offset, offset + limit);
    return Promise.resolve({cursor: String(offset + values.length), hasMore: offset + values.length < this._work.length, work: values});
  }

  createItem(_channel, manifest) {
    const uploadId = GLib.uuid_string_random();
    const previewIds = manifest.previews.map(value => value.id);
    const contentIds = manifest.contents.filter(value => value.delivery === 'eager').map(value => value.id);
    const totalBytes = manifest.previews.reduce((sum, value) => sum + value.size, 0)
      + manifest.contents.filter(value => value.delivery === 'eager').reduce((sum, value) => sum + value.size, 0);
    this._uploads.set(uploadId, {itemId: manifest.id, transferId: GLib.uuid_string_random(), totalBytes, kind: 'publish'});
    return Promise.resolve({itemId: manifest.id, uploadId, previewIds, contentIds,
      transfer: this._transfer(this._uploads.get(uploadId), 'queued', 0, 'publish', 'upload')});
  }

  uploadPreview(uploadId, _previewId, source, onProgress) { return this._upload(uploadId, source, onProgress); }
  uploadContent(uploadId, _contentId, source, onProgress) { return this._upload(uploadId, source, onProgress); }

  async _upload(uploadId, source, onProgress) {
    const session = this._uploads.get(uploadId);
    this.activeUploads++;
    this.maxConcurrentUploads = Math.max(this.maxConcurrentUploads, this.activeUploads);
    const bytes = source.bytes ?? Gio.File.new_for_path(source.path).load_bytes(null)[0];
    assert(bytes.get_size() === source.size, 'control fixture must read the declared source bytes');
    await Promise.resolve();
    this.uploadedBytes += bytes.get_size();
    onProgress(source.size, session.totalBytes);
    this.activeUploads--;
  }

  completeUpload(uploadId) {
    const session = this._uploads.get(uploadId);
    this.completedUploads++;
    return Promise.resolve({transfer: this._transfer(session, 'completed', session.totalBytes, session.kind, 'upload')});
  }

  acceptWork(workId) {
    const work = this._work.find(value => value.id === workId);
    const session = {itemId: work.itemId, transferId: GLib.uuid_string_random(), totalBytes: work.size, kind: 'content'};
    const uploadId = GLib.uuid_string_random();
    this._uploads.set(uploadId, session);
    return Promise.resolve({uploadId, transfer: this._transfer(session, 'queued', 0, 'content', 'upload')});
  }

  rejectWork() { return Promise.resolve({}); }
  abort() {}

  seedWork(items) {
    this._work = items.map(item => ({id: GLib.uuid_string_random(), type: 'materialize-content', itemId: item.id,
      contentId: item.primary.id, size: item.primary.size}));
  }

  _device(profile = {}) {
    return {id: deviceId, tag: profile.tag ?? 'Stress laptop', iconKind: profile.iconKind ?? 'laptop',
      iconColor: profile.iconColor ?? {light: '#ffffff'}, state: 'online', lastSeenAt: 1};
  }
  _transfer(session, state, completedBytes, kind, direction) {
    return {id: session.transferId, itemId: session.itemId, deviceId, kind, direction, state,
      completedBytes, totalBytes: session.totalBytes, peerDeviceIds: [], createdAt: 1, updatedAt: state === 'completed' ? 2 : 1};
  }
}

const directory = GLib.dir_make_tmp('clipboard-x-sync-stress-XXXXXX');
const files = [];
function createItem(prefix, index) {
  const text = `${prefix} payload ${index}`;
  const item = ClipboardItem.fromText(text, {originDeviceId: deviceId});
  const path = GLib.build_filenamev([directory, item.id]);
  const file = Gio.File.new_for_path(path);
  file.replace_contents(text, null, false, Gio.FileCreateFlags.PRIVATE, null);
  files.push(file);
  item.primary.path = path;
  return item;
}
const settings = new StressSettings();
const store = new StressStore();
const transport = new StressTransport();
const sources = Array.from({length: STRESS_SYNC_LOAD.publishedItems}, (_, index) => createItem('publish', index));
const workItems = Array.from({length: STRESS_SYNC_LOAD.onDemandWork}, (_, index) => createItem('work', index));
const sourceById = new Map(workItems.map(item => [item.id, item]));
const client = new SyncClient(settings, {
  configurationStore: store,
  transportFactory: () => transport,
  sourceItem: itemId => sourceById.get(itemId),
});
const available = new Set();
client.connect('item-available', (_client, itemId) => available.add(itemId));

try {
  const started = GLib.get_monotonic_time();
  await client.start();
  transport.seedWork(workItems);
  await Promise.all([client._syncWork(), ...sources.map(source => client.publish(source))]);
  const elapsedSeconds = (GLib.get_monotonic_time() - started) / 1_000_000;

  assert(available.size === STRESS_SYNC_LOAD.incomingChanges, '10x distinct changes must all be observed');
  assert(store.value.cursors[channelId] === String(STRESS_SYNC_LOAD.incomingChanges), 'changes cursor must reach the final page');
  assert(store.value.workCursor === String(STRESS_SYNC_LOAD.onDemandWork), 'work cursor must reach the final page');
  assert(transport.completedUploads === STRESS_SYNC_LOAD.publishedItems + STRESS_SYNC_LOAD.onDemandWork,
    'all 10x publish and on-demand uploads must complete');
  assert(transport.maxConcurrentUploads === 1, 'the transfer queue must keep network uploads serialized');
  assert(client._transfers.values().length <= MAX_TRANSFER_STATES
      && client._transfers._lastEmittedAt.size <= MAX_TRANSFER_STATES
      && client._transfers._pendingSources.size === 0,
    'all local transfer metadata must remain bounded');
  assert(client._remoteTransferIds.size === 0 && client._operations.size === 0
      && client._activeCancellables.size === 0,
    'completed transfers must not retain cancellation state');
  assert(new Set([...transport._uploads.values()].map(value => value.itemId)).size
      === STRESS_SYNC_LOAD.publishedItems + STRESS_SYNC_LOAD.onDemandWork,
    'the control workload must use unique item identities');
  assert(elapsedSeconds < 60, `10x control-plane load took too long: ${elapsedSeconds.toFixed(2)}s`);
} finally {
  client.destroy();
  for (const file of files)
    try { file.delete(null); } catch (_error) {}
  Gio.File.new_for_path(directory).delete(null);
}

const emitted = [];
const tracker = new TransferTracker(value => emitted.push(value));
const transfer = {transferId: GLib.uuid_string_random(), itemId: GLib.uuid_string_random(), deviceId,
  kind: 'content', direction: 'upload', state: 'transferring', completedBytes: 0, totalBytes: 1_000_000,
  peerDeviceIds: [], createdAt: 1, updatedAt: 1};
for (let index = 1; index <= STRESS_SYNC_LOAD.progressUpdates; index++) {
  tracker.update({...transfer, completedBytes: index, updatedAt: index});
  if (index % 10_000 === 0)
    await delay(60);
}
tracker.update({...transfer, completedBytes: transfer.totalBytes, state: 'completed', updatedAt: transfer.totalBytes + 1}, {immediate: true});
assert(tracker.get(transfer.transferId).state === 'completed', 'progress flood must retain terminal state');
assert(emitted.length > 2 && emitted.length < 100,
  'progress must deliver throttled intermediate notifications, not silently drop all updates');
const terminal = emitted.at(-1);
assert(terminal.state === 'completed' && terminal.completedBytes === terminal.totalBytes
    && terminal.totalBytes === transfer.totalBytes,
  'the exact terminal progress must be delivered to the observer');
for (let index = 1; index < emitted.length; index++)
  assert(emitted[index].completedBytes >= emitted[index - 1].completedBytes,
    'delivered progress must never go backwards');
const terminalCount = emitted.length;
await delay(60);
assert(emitted.length === terminalCount && tracker._pendingSources.size === 0,
  'completion must cancel queued progress callbacks');
tracker.clear();
