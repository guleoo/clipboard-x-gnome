import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {HistoryStore} from '../../src/clipboard/history/store.js';
import {ClipboardItem} from '../../src/clipboard/item.js';
import {bytesFromString, sha256} from '../../src/common/bytes.js';
import {writeFile} from '../../src/common/files.js';
import {createLogger} from '../../src/common/logger.js';
import {SyncClient} from '../../src/sync/client.js';
import {SyncError} from '../../src/sync/errors.js';
import {isComplete} from '../../src/ui/panels/history/sync-state.js';
import {STRESS_SYNC_LOAD} from './load-profile.js';
import {MAX_TRANSFER_STATES} from '../../src/sync/constants.js';

function assert(value, message) {
  if (!value)
    throw new Error(message);
}

// Optional GVFS metadata services must not outlive this test's isolated storage.
assert(GLib.getenv('GIO_USE_VFS') === 'local', 'Receiving tests require the local VFS; run through Meson');
const directory = GLib.dir_make_tmp('clipboard-x-gnome-receive-test-XXXXXX');
GLib.setenv('XDG_DATA_HOME', directory, true);
const deviceId = GLib.uuid_string_random();
const sourceDeviceId = GLib.uuid_string_random();
const channelId = GLib.uuid_string_random();
const thresholds = {'text-full-threshold': 9, 'image-full-threshold': 8};
const settings = {
  get_uint: key => key === 'sync-transfer-timeout-seconds' ? 5 : thresholds[key] ?? 0,
  get_string: key => key === 'device-id' ? deviceId : 'Test',
  get_boolean: () => false,
};
const store = new HistoryStore({rootPath: `${directory}/clipboard-x-gnome/history`, deviceId});
const manifests = new Map();
const objects = new Map();
const requests = [];
const downloads = [];
const events = [];
let activeDownloads = 0;
let peakDownloads = 0;
let pendingTransfer = null;
let waitForSource = false;
let failDownload = false;
const transport = {
  item: async (_channel, id) => manifests.get(id),
  preview: async (_channel, _item, id) => objects.get(id),
  requestContent: async (_channel, itemId, contentId) => {
    requests.push(contentId);
    const transfer = {
      id: GLib.uuid_string_random(), itemId, deviceId, kind: 'content', direction: 'download',
      state: waitForSource ? 'waiting-for-peer' : 'completed',
      totalBytes: objects.get(contentId).get_size(),
      completedBytes: waitForSource ? 0 : objects.get(contentId).get_size(),
      peerDeviceIds: [sourceDeviceId], createdAt: 1, updatedAt: 1,
    };
    pendingTransfer = transfer;
    return {transfer};
  },
  downloadContent: async (_channel, _item, contentId, target, options) => {
    assert(target.startsWith(`${directory}/`), 'Test download must stay in isolated storage');
    downloads.push(contentId);
    if (failDownload)
      throw new SyncError('hash_mismatch', 'Test integrity failure');
    const bytes = objects.get(contentId);
    assert(options.expectedBytes === bytes.get_size() && options.expectedSha256 === sha256(bytes),
      'Automatic downloads must retain original size and SHA-256 verification');
    GLib.mkdir_with_parents(GLib.path_get_dirname(target), 0o700);
    activeDownloads++;
    peakDownloads = Math.max(peakDownloads, activeDownloads);
    await writeFile(Gio.File.new_for_path(target), bytes);
    activeDownloads--;
    options.onProgress(bytes.get_size());
    options.onVerifying();
    return {path: target, size: bytes.get_size(), sha256: sha256(bytes)};
  },
  abort() {},
};
const client = new SyncClient(settings, {
  configurationStore: {},
  stageFile: (content, write, cancellable) => store.stage(content, write, cancellable),
  logger: createLogger('sync', {sink: () => {}}),
});
client._transport = transport;
client._connected = true;
client._storedConfiguration = {activeChannelId: channelId};
client._capabilities = {maxItemBytes: 1024 * 1024, maxPreviewBytes: 4096};
client.connect('transfer-changed', (_client, transfer) => events.push(transfer));

function manifest(values, delivery = 'eager') {
  const contents = values.map(([mimeType, value]) => {
    const bytes = typeof value === 'string' ? bytesFromString(value) : new GLib.Bytes(value);
    const hash = sha256(bytes);
    objects.set(hash, bytes);
    return {id: hash, sha256: hash, mimeType, size: bytes.get_size(), delivery};
  });
  const first = contents[0];
  const result = {
    id: GLib.uuid_string_random(), createdAt: 1,
    origin: {deviceId: sourceDeviceId, tag: 'Source', iconKind: 'computer'},
    contents,
    previews: first.mimeType.startsWith('text/')
      ? [{...first, contentId: first.id, truncated: false}] : [],
  };
  manifests.set(result.id, result);
  return result;
}

try {
  const small = manifest([['text/plain;charset=utf-8', '几个字']]);
  const received = await client.getItem(small.id);
  assert(received.availability === 'preview' && requests.length === 0,
    'Manifest and preview reception must remain separate from automatic materialization');
  await client.materialize(received, {withinThreshold: true});
  assert(received.availability === 'ready' && received.primary.path && isComplete(received),
    'UTF-8 text exactly at the local byte threshold must be downloaded and show completion');
  assert(events.some(value => value.state === 'verifying') && events.at(-1).state === 'completed',
    'Automatic receiving must emit verifying and completed progress states');

  await store.save([received]);
  const restored = (await store.load())[0];
  assert(restored && !restored.primary.bytes && isComplete(restored),
    'Received completion must survive storage reload without transfer records or eager memory reads');
  await store.materialize(restored);
  assert(restored.text === '几个字', 'Stored automatic downloads must restore the exact original text');

  // Pause an older snapshot immediately before GC, then receive both an image
  // preview and its original through the real client/store integration.
  const prior = ClipboardItem.fromText('previous remote snapshot', {originDeviceId: sourceDeviceId});
  await store.save([prior]);
  let enterCleanup;
  let releaseCleanup;
  const cleanupEntered = new Promise(resolve => { enterCleanup = resolve; });
  const cleanupRelease = new Promise(resolve => { releaseCleanup = resolve; });
  const cleanup = store._removeUnreferencedFiles;
  const enqueue = store._enqueue;
  store._removeUnreferencedFiles = async function (items, paths, cancellable) {
    if (paths.directory === this.directory(sourceDeviceId).directory) {
      enterCleanup();
      await cleanupRelease;
    }
    return cleanup.call(this, items, paths, cancellable);
  };
  let previousSave;
  try {
    previousSave = store.save([prior]);
    await cleanupEntered;
    const imageManifest = manifest([['image/png', new Uint8Array(8)]]);
    const thumbnail = bytesFromString('preview');
    const thumbnailId = sha256(thumbnail);
    objects.set(thumbnailId, thumbnail);
    imageManifest.previews = [{id: thumbnailId, sha256: thumbnailId, size: thumbnail.get_size(),
      contentId: imageManifest.contents[0].id, mimeType: 'image/png', truncated: true}];
    let publishQueued;
    const publicationQueued = new Promise(resolve => { publishQueued = resolve; });
    store._enqueue = function (action) {
      const result = enqueue.call(this, action);
      publishQueued();
      return result;
    };
    const receiving = client.getItem(imageManifest.id);
    await publicationQueued;
    assert([...store._staged.keys()].some(path => Gio.File.new_for_path(path).query_exists(null)),
      'Preview I/O may finish concurrently with GC, before its descriptor is published');
    releaseCleanup();
    await previousSave;
    const image = await receiving;
    store._enqueue = enqueue;
    await client.materialize(image);
    const temporaryPaths = [image.preview.path, image.primary.path];
    assert(temporaryPaths.every(path => Gio.File.new_for_path(path).query_exists(null)),
      'An older snapshot GC must not delete newly received previews or originals');
    store._removeUnreferencedFiles = cleanup;
    await store.save([prior, image]);
    assert(image.preview.path.startsWith(store.directory(sourceDeviceId).previews)
        && image.primary.path.startsWith(store.directory(sourceDeviceId).objects)
        && temporaryPaths.every(path => !Gio.File.new_for_path(path).query_exists(null)),
      'History persistence must adopt both staged files and release their temporary locations');
    const savedImage = (await store.load()).find(value => value.id === image.id);
    assert(savedImage && isComplete(savedImage) && savedImage.preview.path === image.preview.path,
      'A received image must reload with its durable preview and original after concurrent GC');
  } finally {
    releaseCleanup();
    await previousSave;
    store._removeUnreferencedFiles = cleanup;
    store._enqueue = enqueue;
  }

  const large = await client.getItem(manifest([['text/plain;charset=utf-8', '0123456789']]).id);
  const beforeLarge = requests.length;
  await client.materialize(large, {withinThreshold: true});
  assert(large.availability === 'preview' && !large.primary.path && requests.length === beforeLarge,
    'An eager source above the receiver threshold must remain lazy locally');
  thresholds['text-full-threshold'] = 10;
  await client.materialize(large, {withinThreshold: true});
  assert(isComplete(large), 'Receiving must read the current threshold rather than a cached value');
  thresholds['text-full-threshold'] = 9;

  const smallImage = await client.getItem(manifest([['image/png', new Uint8Array(8)]], 'on-demand').id);
  await client.materialize(smallImage, {withinThreshold: true});
  assert(isComplete(smallImage),
    'Images at the local threshold must be fetched even when the source advertised on-demand delivery');
  const largeImage = await client.getItem(manifest([['image/png', new Uint8Array(9)]]).id);
  const beforeImage = requests.length;
  await client.materialize(largeImage, {withinThreshold: true});
  assert(!isComplete(largeImage) && requests.length === beforeImage,
    'Images above their own threshold must remain lazy independently of the text threshold');

  const mixed = await client.getItem(manifest([
    ['text/plain;charset=utf-8', 'plain'], ['text/html', '<p>plain</p>'],
  ]).id);
  await client.materialize(mixed, {withinThreshold: true});
  assert(mixed.primary.path && !mixed.representations[1].path && mixed.availability === 'preview'
      && !isComplete(mixed, {state: 'completed'}),
    'Completing a small representation must not mark a mixed partial entry as complete');
  await client.materialize(mixed);
  assert(mixed.availability === 'ready' && isComplete(mixed),
    'Explicit use must still materialize representations above the automatic threshold');

  waitForSource = true;
  const lazySource = await client.getItem(manifest([['text/plain;charset=utf-8', 'lazy']], 'on-demand').id);
  const beforeConcurrent = requests.length;
  const beforeDownloads = downloads.length;
  const automatic = client.materialize(lazySource, {withinThreshold: true});
  const manual = client.materialize(lazySource);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(requests.length === beforeConcurrent + 1 && lazySource.availability === 'waiting-for-peer',
    'Automatic and manual use must share one source request while waiting');
  assert(downloads.length === beforeDownloads && !isComplete(lazySource, {state: 'completed'}),
    'Source readiness must precede local original download');
  client._transfers.record({...pendingTransfer, transferId: pendingTransfer.id,
    state: 'completed', completedBytes: pendingTransfer.totalBytes, updatedAt: 2}, true);
  await Promise.all([automatic, manual]);
  assert(isComplete(lazySource) && downloads.length === beforeDownloads + 1
      && client._transfers._materializations.size === 0,
    'Shared materialization must download once and release its operation state');
  waitForSource = false;

  failDownload = true;
  const failed = await client.getItem(manifest([['text/plain;charset=utf-8', 'failed']]).id);
  let error;
  try {
    await client.materialize(failed, {withinThreshold: true});
  } catch (value) {
    error = value;
  }
  assert(error?.code === 'hash_mismatch' && failed.availability === 'failed'
      && failed.preview.text === 'failed' && !failed.primary.path && !isComplete(failed)
      && client._transfers._materializations.size === 0,
    'Failed verification must retain the preview without declaring completion or retaining operations');
  failDownload = false;
  await client.materialize(failed);
  assert(isComplete(failed), 'A failed automatic download must remain manually retryable');

  if (ARGV.includes('--stress')) {
    const beforeBurst = downloads.length;
    const burst = Array.from({length: STRESS_SYNC_LOAD.incomingChanges}, (_value, index) =>
      manifest([['text/plain;charset=utf-8', String(index).padStart(4, '0')]],
        index % 2 ? 'eager' : 'on-demand'));
    const receivedBurst = await Promise.all(burst.map(async value => {
      const item = await client.getItem(value.id);
      await client.materialize(item, {withinThreshold: true});
      return item;
    }));
    assert(receivedBurst.every(item => item.availability === 'ready' && isComplete(item))
        && downloads.length - beforeBurst === STRESS_SYNC_LOAD.incomingChanges,
      'A 10x daily incoming burst must complete every below-threshold original');
    print(`Receiving stress: ${receivedBurst.length} items completed.`);
  }
  assert(peakDownloads === 1 && client._transfers._materializations.size === 0
      && client._transfers._waiters.size === 0 && client._transfers.values().length <= MAX_TRANSFER_STATES,
    'Automatic receiving must serialize file movement and release bounded operation state');
} finally {
  client.destroy();
  await store.close();
  deleteTree(Gio.File.new_for_path(directory));
}

function deleteTree(file) {
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
    const entries = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let entry;
    while ((entry = entries.next_file(null)))
      deleteTree(file.get_child(entry.get_name()));
    entries.close(null);
  }
  file.delete(null);
}
