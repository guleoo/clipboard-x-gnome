import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../../../src/clipboard/item.js';
import {HistoryStore} from '../../../src/clipboard/history/store.js';
import {createThumbnail} from '../../../src/clipboard/thumbnail.js';
import {bytesFromString, sha256} from '../../../src/common/bytes.js';
import {writeFile} from '../../../src/common/files.js';

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

const rootPath = GLib.dir_make_tmp('clipboard-x-gnome-storage-test-XXXXXX');
const localDeviceId = GLib.uuid_string_random();
const remoteDeviceId = GLib.uuid_string_random();
const store = new HistoryStore({rootPath, deviceId: localDeviceId});
const localPaths = store.directory();
const remotePaths = store.directory(remoteDeviceId);

try {
  const first = ClipboardItem.fromText('persistent clipboard content');
  const sensitive = ClipboardItem.fromText('sensitive memory-only content', {sensitive: true});
  await store.save([first, sensitive]);
  assert(first.primary.path?.startsWith(localPaths.objects),
    'save must place local content in its device object directory');
  assert(first.originDeviceId === localDeviceId, 'save must assign legacy local entries to the local device');
  const storageMode = Gio.File.new_for_path(localPaths.objects)
    .query_info(Gio.FILE_ATTRIBUTE_UNIX_MODE, Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE);
  assert((storageMode & 0o077) === 0, 'clipboard storage must not grant group or other access');

  const loaded = await store.load();
  assert(loaded.length === 1 && loaded[0].primary.bytes === undefined,
    'load must restore metadata without eagerly reading object content');
  assert(!loaded.some(item => item.text.includes('sensitive memory-only')),
    'sensitive memory-only content must never be persisted');
  await store.materialize(loaded[0]);
  assert(loaded[0].text === 'persistent clipboard content', 'materialize must restore verified content');

  await writeFile(Gio.File.new_for_path(loaded[0].primary.path), bytesFromString('tampered clipboard content!'));
  loaded[0].primary.bytes = null;
  await assertRejects(store.materialize(loaded[0]), /integrity|size/u, 'tampered object verification');

  const second = ClipboardItem.fromText('second serialized save');
  const third = ClipboardItem.fromText('third serialized save');
  await Promise.all([store.save([second]), store.save([third])]);
  const latest = await store.load();
  assert(latest.length === 1 && latest[0].id === third.id, 'concurrent saves must be serialized in call order');

  const invalid = third.toJSON();
  invalid.representations[0].path = '/etc/passwd';
  await writeFile(
    Gio.File.new_for_path(localPaths.index),
    bytesFromString(JSON.stringify({
      version: 1,
      deviceId: localDeviceId,
      updatedAt: Date.now(),
      items: [invalid],
    })),
  );
  assert((await store.load()).length === 0, 'history paths outside device storage must be rejected');

  const missingLocal = ClipboardItem.fromText('missing local original', {
    originDeviceId: localDeviceId,
  });
  missingLocal.primary.bytes = null;
  await assertRejects(
    store.save([missingLocal]),
    /no content to persist/u,
    'local history without content',
  );

  GLib.mkdir_with_parents(remotePaths.previews, 0o700);
  const previewBytes = bytesFromString('derived preview bytes');
  const previewHash = sha256(previewBytes);
  const previewPath = GLib.build_filenamev([remotePaths.previews, previewHash]);
  const stalePreviewPath = GLib.build_filenamev([remotePaths.previews, 'stale.preview']);
  await writeFile(Gio.File.new_for_path(previewPath), previewBytes);
  await writeFile(Gio.File.new_for_path(stalePreviewPath), bytesFromString('stale'));
  const remote = ClipboardItem.fromText('remote original', {
    originDeviceId: remoteDeviceId,
    remote: true,
    availability: 'preview',
  });
  remote.preview = {
    mimeType: 'image/png',
    path: previewPath,
    size: previewBytes.get_size(),
    sha256: previewHash,
    truncated: true,
    derivedFrom: remote.primary.id,
  };
  await store.save([remote]);
  assert(remote.primary.path.startsWith(remotePaths.objects),
    'remote history content must be partitioned by its origin DeviceId');
  const [, indexBytes] = Gio.File.new_for_path(remotePaths.index).load_contents(null);
  const oldIndex = JSON.parse(new TextDecoder().decode(indexBytes));
  oldIndex.items[0].originDeviceIconColor = {light: '#ffffff', dark: '#454545'};
  await writeFile(Gio.File.new_for_path(remotePaths.index), bytesFromString(JSON.stringify(oldIndex)));
  const restored = (await store.load()).find(item => item.id === remote.id);
  assert(restored && !Object.hasOwn(restored.toJSON(), 'originDeviceIconColor'),
    'existing history icon colors must be ignored without losing the entry');
  await store.save([restored]);
  const [, savedIndexBytes] = Gio.File.new_for_path(remotePaths.index).load_contents(null);
  assert(!Object.hasOwn(JSON.parse(new TextDecoder().decode(savedIndexBytes)).items[0],
    'originDeviceIconColor'), 'subsequent saves must omit disabled icon colors');
  restored.originDeviceIconKind = 'unknown-remote-system';
  await store.save([restored]);
  assert((await store.load()).find(item => item.id === remote.id)?.originDeviceIconKind
    === 'unknown-remote-system', 'history must preserve icon identifiers unknown to this client');
  assert(Gio.File.new_for_path(remotePaths.index).query_exists(null),
    'remote history must have an independent versioned index');
  assert(Gio.File.new_for_path(previewPath).query_exists(null), 'referenced remote preview must be retained');
  assert(!Gio.File.new_for_path(stalePreviewPath).query_exists(null), 'stale remote preview must be pruned');

  const manifestOnly = ClipboardItem.fromText('remote lazy manifest', {
    originDeviceId: remoteDeviceId,
    remote: true,
    availability: 'preview',
  });
  manifestOnly.primary.delivery = 'on-demand';
  manifestOnly.primary.bytes = null;
  const cachedManifest = ClipboardItem.fromText('remote original', {
    originDeviceId: remoteDeviceId,
    remote: true,
    availability: 'preview',
  });
  cachedManifest.primary.delivery = 'on-demand';
  cachedManifest.primary.bytes = null;
  const capturedAfterLazySync = ClipboardItem.fromText('local capture after lazy synchronization', {
    originDeviceId: localDeviceId,
  });
  await store.save([capturedAfterLazySync, remote, manifestOnly, cachedManifest]);
  assert(capturedAfterLazySync.primary.path?.startsWith(localPaths.objects),
    'new local content must persist while remote lazy manifests remain in history');
  assert(manifestOnly.primary.path === null,
    'remote lazy history must preserve a manifest without fabricating a local object path');
  assert(cachedManifest.primary.path === remote.primary.path,
    'remote lazy history must reuse an already cached object with the same hash');
  const restoredRemote = (await store.load()).find(item => item.id === manifestOnly.id);
  assert(restoredRemote?.remote && restoredRemote.primary.path === null,
    'remote lazy manifest must survive a history reload without its original content');

  await store.save([]);
  assert(!Gio.File.new_for_path(previewPath).query_exists(null), 'removed history must release its remote preview');

  const source = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 1024, 512);
  source.fill(0x2f80edff);
  const [encoded, png] = source.save_to_bufferv('png', [], []);
  assert(encoded, 'thumbnail fixture must encode');
  const thumbnail = await createThumbnail(new GLib.Bytes(png), 100, 64 * 1024);
  assert(thumbnail.width === 100 && thumbnail.height === 50, 'thumbnail decode must scale before full allocation');
  assert(thumbnail.bytes.get_size() <= 64 * 1024, 'thumbnail must respect its byte limit');

  const legacyPath = GLib.build_filenamev([rootPath, 'legacy-cache']);
  const migratedPath = GLib.build_filenamev([rootPath, 'migrated-data']);
  const legacyObjectsPath = GLib.build_filenamev([legacyPath, 'objects']);
  GLib.mkdir_with_parents(legacyObjectsPath, 0o700);
  const legacyItem = ClipboardItem.fromText('migrated clipboard content');
  const legacyObjectPath = GLib.build_filenamev([legacyObjectsPath, legacyItem.primary.sha256]);
  await writeFile(Gio.File.new_for_path(legacyObjectPath), legacyItem.primary.bytes);
  legacyItem.primary.path = legacyObjectPath;
  await writeFile(
    Gio.File.new_for_path(GLib.build_filenamev([legacyPath, 'history.json'])),
    bytesFromString(JSON.stringify([legacyItem.toJSON()])),
  );
  const migrationStore = new HistoryStore({
    rootPath: migratedPath,
    deviceId: localDeviceId,
    legacyPath,
  });
  const migrated = await migrationStore.load();
  assert(migrated.length === 1 && migrated[0].originDeviceId === localDeviceId,
    'legacy cache history must migrate into the local device directory');
  assert(migrated[0].primary.path.startsWith(migrationStore.directory().objects),
    'legacy cache objects must move to stable device storage');
  assert((await migrationStore.load()).length === 1,
    'the migration marker must prevent duplicate legacy imports');

  const concurrent = new HistoryStore({rootPath: `${rootPath}/concurrent-test`, deviceId: localDeviceId});
  const downloading = ClipboardItem.fromText('download finishes during index persistence', {
    originDeviceId: remoteDeviceId, remote: true, availability: 'preview',
  });
  const originalBytes = downloading.primary.bytes;
  downloading.primary.bytes = null;
  let enterSave;
  let releaseSave;
  let publishQueued;
  const saveEntered = new Promise(resolve => { enterSave = resolve; });
  const saveRelease = new Promise(resolve => { releaseSave = resolve; });
  const publicationQueued = new Promise(resolve => { publishQueued = resolve; });
  const persistPreview = concurrent._persistPreview;
  const enqueue = concurrent._enqueue;
  concurrent._persistPreview = async function (...args) {
    enterSave();
    await saveRelease;
    return persistPreview.apply(this, args);
  };
  const metadataSave = concurrent.save([downloading]);
  let downloaded;
  try {
    await saveEntered;
    concurrent._enqueue = function (action) {
      const result = enqueue.call(this, action);
      publishQueued();
      return result;
    };
    downloaded = concurrent.stage(downloading.primary,
      path => writeFile(Gio.File.new_for_path(path), originalBytes));
    await publicationQueued;
    assert(!downloading.primary.path,
      'a verified download must not publish its staged path during an active index save');
    releaseSave();
    await Promise.all([metadataSave, downloaded]);
    concurrent._enqueue = enqueue;
    concurrent._persistPreview = persistPreview;
    const [, indexContents] = Gio.File.new_for_path(concurrent.directory(remoteDeviceId).index).load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(indexContents));
    assert(!metadata.items[0].representations[0].path
        && metadata.items[0].availability === 'preview'
        && (await concurrent.load()).some(value => value.id === downloading.id),
      'the completed metadata save must remain reloadable without a follow-up save repairing the index');
    downloading.availability = 'ready';
    await concurrent.save([downloading]);
    const original = (await concurrent.load()).find(value => value.id === downloading.id);
    await concurrent.materialize(original);
    assert(original.text === 'download finishes during index persistence'
        && original.primary.path.startsWith(concurrent.directory(remoteDeviceId).objects),
      'the subsequent content save must adopt and reload the exact verified original');
  } finally {
    releaseSave();
    await Promise.allSettled([metadataSave, downloaded]);
    await concurrent.close();
  }

  const staging = new HistoryStore({rootPath: `${rootPath}/staging-test`, deviceId: localDeviceId});
  try {
    const item = ClipboardItem.fromText('verified staged content', {originDeviceId: localDeviceId});
    const bytes = item.primary.bytes;
    item.primary.bytes = null;
    let enterCleanup;
    let releaseCleanup;
    const cleanupEntered = new Promise(resolve => { enterCleanup = resolve; });
    const cleanupRelease = new Promise(resolve => { releaseCleanup = resolve; });
    const prune = staging._pruneDirectory;
    staging._pruneDirectory = async function (...args) {
      enterCleanup();
      await cleanupRelease;
      return prune.apply(this, args);
    };
    const loading = staging.load();
    await cleanupEntered;
    let path;
    try {
      path = await staging.stage(item.primary, path => writeFile(Gio.File.new_for_path(path), bytes));
    } finally {
      releaseCleanup();
      await loading;
      staging._pruneDirectory = prune;
    }
    assert(path.includes('/.staging/') && !path.startsWith(staging.directory().objects),
      'writers must receive a private staging path, not a permanent history object');
    assert(Gio.File.new_for_path(path).query_exists(null),
      'startup cleanup must preserve a file staged after its asynchronous scan began');
    const sharing = new ClipboardItem({representations: [item.primary]});
    await staging.discard([item], [sharing]);
    assert(Gio.File.new_for_path(path).query_exists(null), 'discard must preserve a retained shared descriptor');
    const read = staging._materialize;
    const save = staging._save;
    let enterRead;
    let releaseRead;
    const readEntered = new Promise(resolve => { enterRead = resolve; });
    const readRelease = new Promise(resolve => { releaseRead = resolve; });
    let savingStarted = false;
    staging._materialize = async function (...args) {
      enterRead();
      await readRelease;
      return read.apply(this, args);
    };
    staging._save = function (...args) {
      savingStarted = true;
      return save.apply(this, args);
    };
    const reading = staging.materialize(item);
    await readEntered;
    const saving = staging.save([item]);
    try {
      await Promise.resolve();
      assert(!savingStarted, 'adoption and GC must wait for an active staged-file read');
    } finally {
      releaseRead();
      await Promise.all([reading, saving]);
      staging._materialize = read;
      staging._save = save;
    }
    assert(item.text === 'verified staged content', 'a read concurrent with adoption must return the exact original');
    assert(!Gio.File.new_for_path(path).query_exists(null)
        && item.primary.path.startsWith(staging.directory().objects)
        && sharing.primary.path === item.primary.path,
      'adoption must move the staged file and update all consumers of the shared descriptor');

    const discarded = ClipboardItem.fromText('discarded staged content');
    const discardedPath = await staging.stage(discarded.primary,
      path => writeFile(Gio.File.new_for_path(path), discarded.primary.bytes));
    await staging.discard([discarded]);
    assert(!Gio.File.new_for_path(discardedPath).query_exists(null),
      'discarded content must not leave a staging file behind');

    const wrong = ClipboardItem.fromText('expected content');
    let failedPath;
    await assertRejects(staging.stage(wrong.primary, path => {
      failedPath = path;
      return writeFile(Gio.File.new_for_path(path), bytesFromString('wrong'));
    }), /metadata/u, 'staging size validation');
    assert(!wrong.primary.path && !Gio.File.new_for_path(failedPath).query_exists(null),
      'a failed writer must not publish a path or retain a partial staging file');

    const pending = ClipboardItem.fromText('cancelled writer');
    const cancellable = new Gio.Cancellable();
    let finishWriter;
    let pendingPath;
    const writing = staging.stage(pending.primary, async path => {
      pendingPath = path;
      await new Promise(resolve => { finishWriter = resolve; });
      await writeFile(Gio.File.new_for_path(path), pending.primary.bytes);
    }, cancellable);
    const rejected = assertRejects(writing, /cancelled|canceled/iu, 'closing an active writer');
    const closing = staging.close();
    assert(cancellable.is_cancelled(), 'closing storage must cancel active staging writes');
    finishWriter();
    await Promise.all([rejected, closing]);
    assert(!pending.primary.path && !Gio.File.new_for_path(pendingPath).query_exists(null),
      'late writer completion after close must be cleaned without exposing an original');
  } finally {
    await staging.close();
  }

} finally {
  await store.close();
  deleteTree(Gio.File.new_for_path(rootPath));
}

function deleteTree(file) {
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
    const enumerator = file.enumerate_children(
      Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
    let info;
    while ((info = enumerator.next_file(null)))
      deleteTree(file.get_child(info.get_name()));
    enumerator.close(null);
  }
  file.delete(null);
}
