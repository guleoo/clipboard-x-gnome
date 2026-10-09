import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../../src/clipboard/item.js';
import {SyncClient} from '../../src/sync/client.js';
import {createLogger} from '../../src/common/logger.js';

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
      ['sync-poll-interval-seconds', 5],
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

  async changeString(key, value) {
    this.set_string(key, value);
    const callbacks = [...this._signals.values()]
      .filter(({name}) => name === `changed::${key}`)
      .map(({callback}) => callback());
    await Promise.all(callbacks);
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
  constructor(channels = [{id: channelId, name: 'Test channel'}]) {
    this.uploadedBytes = 0;
    this.aborted = false;
    this.itemId = '';
    this.totalBytes = 0;
    this.channelValues = channels;
    this.updatedProfiles = [];
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
    this.updatedProfiles.push({...profile});
    return Promise.resolve(this._device(profile));
  }

  channels() {
    return Promise.resolve({channels: this.channelValues});
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
      iconColor: profile.iconColor ?? {light: '#ffffff'},
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
    'client start must authenticate, load the pre-registered device and select its channel');
  const originalPollSource = client._pollSource;
  settings._values.set('sync-poll-interval-seconds', 15);
  for (const {name, callback} of settings._signals.values()) {
    if (name === 'changed::sync-poll-interval-seconds')
      callback();
  }
  assert(originalPollSource > 0 && client._pollSource > 0
      && client._pollSource !== originalPollSource,
  'changing the poll interval must reschedule the running client without reconnecting');
  assert(transport.updatedProfiles.length === 1
      && transport.updatedProfiles[0].tag === 'Test laptop'
      && transport.updatedProfiles[0].iconKind === 'laptop'
      && !Object.hasOwn(transport.updatedProfiles[0], 'iconColor')
      && !Object.hasOwn(transport.updatedProfiles[0], 'id'),
    'client start must synchronize its profile without changing the pre-bound DeviceId');
  await settings.changeString('device-tag', 'Renamed laptop');
  assert(transport.updatedProfiles.length === 2
      && transport.updatedProfiles[1].tag === 'Renamed laptop',
    'changing the local device profile must synchronize it with the server');
  await settings.changeString('device-icon-kind', 'android');
  assert(transport.updatedProfiles.length === 3
      && transport.updatedProfiles[2].tag === 'Renamed laptop'
      && transport.updatedProfiles[2].iconKind === 'android',
    'changing the local device icon must synchronize the complete profile with the server');
  await settings.changeString('device-icon-color-light', '#2190a4');
  await settings.changeString('device-icon-color-dark', '#174653');
  assert(transport.updatedProfiles.length === 3,
    'disabled icon color settings must not trigger a profile update');
  const originalUpdateProfile = transport.updateProfile.bind(transport);
  const pendingProfiles = [];
  transport.updateProfile = profile => new Promise(resolve => {
    pendingProfiles.push({profile, complete: () => resolve(originalUpdateProfile(profile))});
  });
  const tagChange = settings.changeString('device-tag', 'Renamed again');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(pendingProfiles.length === 1 && pendingProfiles[0].profile.tag === 'Renamed again',
    'the first profile update should begin before the second profile change');
  const iconChange = settings.changeString('device-icon-kind', 'archlinux');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(pendingProfiles.length === 1,
    'a second profile change must wait for the in-flight profile update');
  pendingProfiles[0].complete();
  await tagChange;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(pendingProfiles.length === 2
      && pendingProfiles[1].profile.tag === 'Renamed again'
      && pendingProfiles[1].profile.iconKind === 'archlinux'
      && !Object.hasOwn(pendingProfiles[1].profile, 'iconColor'),
    'the queued profile must send the final device information without colors');
  pendingProfiles[1].complete();
  await iconChange;
  transport.updateProfile = originalUpdateProfile;
  assert(client.devices[0].iconKind === 'archlinux' && !Object.hasOwn(client.devices[0], 'iconColor'),
    'the final server profile must not be overwritten by an older response');
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
  assert(client._remoteTransferIds.size === 0,
    'confirmed upload completion must release remote cancellation markers');
  const createItem = transport.createItem.bind(transport);
  const completeUpload = transport.completeUpload.bind(transport);
  const completedUploadBytes = transport.uploadedBytes;
  transport.createItem = async (...args) => {
    const publication = await createItem(...args);
    return {...publication, transfer: transport._transfer('completed', transport.totalBytes)};
  };
  await client.publish(item);
  assert(transport.uploadedBytes === completedUploadBytes,
    'an already-completed remote publication must be acknowledged without re-uploading bytes');
  transport.createItem = createItem;
  transport.completeUpload = async () => ({transfer: transport._transfer('cancelled', 0)});
  let unconfirmed = null;
  try { await client.publish(item); } catch (error) { unconfirmed = error; }
  assert(unconfirmed?.code === 'upload_failed',
    'a cancelled server acknowledgement must not complete a durable upload intent');
  transport.completeUpload = completeUpload;
  const verificationModes = [];
  transport.downloadContent = async (_channelId, _itemId, _contentId, _targetPath, options) => {
    verificationModes.push(options.useSha256sum);
    options.onProgress(item.primary.size);
    if (options.useSha256sum) {
      options.onVerifying();
      assert(client.getTransferForItem(_itemId).state === 'verifying',
        'external hashing must expose the verifying transfer state');
    }
    return {path, size: item.primary.size, sha256: item.primary.sha256};
  };
  const firstDownload = ClipboardItem.fromText('hello', {originDeviceId: deviceId});
  const secondDownload = ClipboardItem.fromText('hello', {originDeviceId: deviceId});
  await client._downloadRepresentation(channelId, firstDownload, firstDownload.primary);
  settings._values.set('sync-use-sha256sum', true);
  await client._downloadRepresentation(channelId, secondDownload, secondDownload.primary);
  settings._values.set('sync-use-sha256sum', false);
  assert(verificationModes.join() === 'false,true',
    'each download must use the current verification option without restarting the connection');
  assert(client.getTransferForItem(secondDownload.id).state === 'completed',
    'verified downloads must finish only after the hashing operation completes');
  const sensitive = ClipboardItem.fromText('local sensitive content', {
    originDeviceId: deviceId,
    sensitive: true,
  });
  sensitive.primary.path = path;
  let rejection = null;
  const uploadedBytes = transport.uploadedBytes;
  try {
    await client.publish(sensitive);
  } catch (error) {
    rejection = error;
  }
  assert(rejection?.code === 'sensitive_content' && transport.uploadedBytes === uploadedBytes,
    'the sync client must reject sensitive content even when it has a persisted path');
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

const channelRequiredStore = new TestStore();
channelRequiredStore.value.activeChannelId = '';
const channelRequiredClient = new SyncClient(settings, {
  configurationStore: channelRequiredStore,
  transportFactory: () => new TestTransport([]),
});
try {
  await channelRequiredClient.start();
  const item = ClipboardItem.fromText('channel required', {originDeviceId: deviceId});
  item.representations[0].path = path;
  let error = null;
  try {
    await channelRequiredClient.publish(item);
  } catch (caught) {
    error = caught;
  }
  assert(error?.code === 'channel_required',
    'publishing without an active channel must expose the stable localization code');
} finally {
  channelRequiredClient.destroy();
}

const retentionTransport = new TestTransport();
retentionTransport.itemId = GLib.uuid_string_random();
retentionTransport.totalBytes = 10;
let cancellations = 0;
retentionTransport.cancel = async () => { cancellations++; };
let remoteState = 'queued';
retentionTransport.transfer = async () => retentionTransport._transfer(remoteState, 0);
const retentionClient = new SyncClient(new TestSettings(), {
  configurationStore: new TestStore(), transportFactory: () => retentionTransport,
});
const cancelledPublications = [];
retentionClient.connect('publication-cancelled', (_client, id) => cancelledPublications.push(id));
try {
  await retentionClient.start();
  const active = await retentionClient.getTransfer(transferId);
  retentionClient._recordTransfer(active, true);
  await retentionClient.cancelTransfer(transferId);
  assert(cancellations === 1 && retentionClient._remoteTransferIds.size === 0,
    'a looked-up remote task must remain cancellable and release its marker after DELETE');
  assert(cancelledPublications.length === 1 && cancelledPublications[0] === retentionTransport.itemId,
    'explicit cancellation must identify the publication whose durable intent should be removed');

  await retentionClient.getTransfer(transferId);
  retentionClient._recordTransfer(active, true);
  for (let index = 0; index < 1100; index++)
    retentionClient._recordTransfer({...active, transferId: GLib.uuid_string_random(), state: 'completed'}, true);
  assert(!retentionClient._transfers.get(transferId), 'fixture must evict the active UI record');
  await retentionClient.cancelTransfer(transferId);
  assert(cancellations === 2, 'UI eviction must not silently disable remote cancellation');

  await retentionClient.getTransfer(transferId);
  retentionClient._recordTransfer({...active, state: 'failed'}, true);
  assert(retentionClient._remoteTransferIds.has(transferId),
    'a local failure is not proof that the server has finished the task');
  remoteState = 'failed';
  await retentionClient.getTransfer(transferId);
  assert(retentionClient._remoteTransferIds.size === 0,
    'confirmed server failure must release remote cancellation state');

  remoteState = 'queued';
  retentionTransport.cancel = async () => { throw new Error('network disconnected'); };
  await retentionClient.getTransfer(transferId);
  try { await retentionClient.cancelTransfer(transferId); } catch (_error) {}
  assert(retentionClient._remoteTransferIds.has(transferId),
    'a failed remote cancellation must retain the ability to retry');

  const localId = GLib.uuid_string_random();
  const localOperation = new Gio.Cancellable();
  retentionClient._operations.set(localId, localOperation);
  await retentionClient.cancelTransfer(localId);
  assert(localOperation.is_cancelled() && cancellations === 2,
    'local-only download cancellation must not call the server DELETE endpoint');
} finally {
  retentionClient.destroy();
}
assert(retentionClient._remoteTransferIds.size === 0,
  'destroy must clear markers for still-active or unconfirmed remote tasks');

// Exercise the actual initialization pipeline, not a synthetic list of stage names.
for (const phase of ['configuration', 'transport', 'status', 'device', 'profile',
  'channels', 'channel-selection', 'transfers', 'changes', 'work', 'transfer-refresh']) {
  const records = [];
  const localStore = new TestStore();
  const localTransport = new TestTransport();
  const failure = new Error('private clipboard and server response must not appear');
  const fail = () => { throw failure; };
  const methods = {status: 'status', device: 'device', profile: 'updateProfile',
    channels: 'channels', transfers: 'transfers', changes: 'changes', work: 'work'};
  if (phase === 'configuration')
    localStore.load = fail;
  else if (phase === 'channel-selection') {
    localStore.value.activeChannelId = '';
    localStore.saveConnection = fail;
  } else if (methods[phase])
    localTransport[methods[phase]] = fail;
  const diagnosticClient = new SyncClient(new TestSettings(), {
    configurationStore: localStore,
    transportFactory: phase === 'transport' ? fail : () => localTransport,
    logger: createLogger('sync', {sink: record => records.push(record)}),
  });
  if (phase === 'transfer-refresh')
    diagnosticClient._refreshActiveTransfers = fail;
  try {
    let caught = null;
    try { await diagnosticClient.start(); } catch (error) { caught = error; }
    assert(caught === failure, `initialization must preserve the original ${phase} failure`);
    const failed = records.filter(record => record.outcome === 'failed');
    assert(failed.length === 1 && failed[0].phase === phase,
      `initialization failure must identify the exact ${phase} stage once`);
    assert(!JSON.stringify(records).includes(failure.message), 'initialization logs must omit raw error text');
  } finally {
    diagnosticClient.destroy();
  }
}

const pollRecords = [];
const pollClient = new SyncClient(new TestSettings(), {
  configurationStore: new TestStore(), transportFactory: () => new TestTransport(),
  logger: createLogger('sync', {sink: record => pollRecords.push(record)}),
});
try {
  await pollClient.start();
  pollRecords.length = 0;
  await pollClient._poll();
  assert(pollRecords.length === 0, 'healthy polling must remain silent');
  for (const [phase, method] of [['changes', '_syncChanges'], ['work', '_syncWork'],
    ['transfer-refresh', '_refreshActiveTransfers']]) {
    const originalMethod = pollClient[method];
    pollClient[method] = () => { throw new Error('poll failure'); };
    try { await pollClient._poll(); } catch (_) {}
    pollClient[method] = originalMethod;
    assert(pollRecords.at(-1).operation === 'poll' && pollRecords.at(-1).phase === phase,
      `background failures must retain their ${phase} stage`);
    assert(!pollClient._polling, 'diagnostics must not leave polling locked after a failure');
  }
} finally {
  pollClient.destroy();
}
