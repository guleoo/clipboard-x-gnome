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

const rootPath = GLib.dir_make_tmp('clipboard-x-storage-test-XXXXXX');
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
    originDeviceIconColor: {light: '#ffffff', dark: '#454545'},
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
  assert((await store.load()).find(item => item.id === remote.id)?.originDeviceIconColor.dark === '#454545',
    'remote device icon colors must survive a history reload');
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

} finally {
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
