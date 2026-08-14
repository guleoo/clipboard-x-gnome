import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';
import {bytesFromString, sha256, writeFile} from '../src/core.js';
import {HistoryStore} from '../src/history-store.js';
import {createThumbnail} from '../src/thumbnail.js';

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
const store = new HistoryStore(rootPath);

try {
  const first = ClipboardItem.fromText('persistent clipboard content');
  const sensitive = ClipboardItem.fromText('sensitive memory-only content', {sensitive: true});
  await store.save([first, sensitive]);
  assert(first.primary.path?.startsWith(store.objectsPath), 'save must place content in the private object cache');
  const cacheMode = Gio.File.new_for_path(store.objectsPath)
    .query_info(Gio.FILE_ATTRIBUTE_UNIX_MODE, Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE);
  assert((cacheMode & 0o077) === 0, 'clipboard cache directory must not grant group or other access');

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
    Gio.File.new_for_path(store.indexPath),
    bytesFromString(JSON.stringify([invalid])),
  );
  assert((await store.load()).length === 0, 'history paths outside the private cache must be rejected');

  GLib.mkdir_with_parents(store.previewsPath, 0o700);
  const previewBytes = bytesFromString('derived preview bytes');
  const previewPath = GLib.build_filenamev([store.previewsPath, 'referenced.preview']);
  const stalePreviewPath = GLib.build_filenamev([store.previewsPath, 'stale.preview']);
  await writeFile(Gio.File.new_for_path(previewPath), previewBytes);
  await writeFile(Gio.File.new_for_path(stalePreviewPath), bytesFromString('stale'));
  const remote = ClipboardItem.fromText('remote original', {
    originDeviceId: GLib.uuid_string_random(),
    remote: true,
    availability: 'preview',
  });
  remote.preview = {
    mimeType: 'image/png',
    path: previewPath,
    size: previewBytes.get_size(),
    sha256: sha256(previewBytes),
    truncated: true,
    derivedFrom: remote.primary.id,
  };
  await store.save([remote]);
  assert(Gio.File.new_for_path(previewPath).query_exists(null), 'referenced remote preview must be retained');
  assert(!Gio.File.new_for_path(stalePreviewPath).query_exists(null), 'stale remote preview must be pruned');
  await store.save([]);
  assert(!Gio.File.new_for_path(previewPath).query_exists(null), 'removed history must release its remote preview');

  const source = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 1024, 512);
  source.fill(0x2f80edff);
  const [encoded, png] = source.save_to_bufferv('png', [], []);
  assert(encoded, 'thumbnail fixture must encode');
  const thumbnail = await createThumbnail(new GLib.Bytes(png), 100, 64 * 1024);
  assert(thumbnail.width === 100 && thumbnail.height === 50, 'thumbnail decode must scale before full allocation');
  assert(thumbnail.bytes.get_size() <= 64 * 1024, 'thumbnail must respect its byte limit');

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
