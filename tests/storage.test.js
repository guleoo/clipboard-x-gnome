import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';
import {bytesFromString, stringFromBytes, writeFile} from '../src/core.js';
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
  await store.save([first]);
  assert(first.primary.path?.startsWith(store.objectsPath), 'save must place content in the private object cache');

  const loaded = await store.load();
  assert(loaded.length === 1 && loaded[0].primary.bytes === undefined,
    'load must restore metadata without eagerly reading object content');
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

  const source = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 1024, 512);
  source.fill(0x2f80edff);
  const [encoded, png] = source.save_to_bufferv('png', [], []);
  assert(encoded, 'thumbnail fixture must encode');
  const thumbnail = await createThumbnail(new GLib.Bytes(png), 100, 64 * 1024);
  assert(thumbnail.width === 100 && thumbnail.height === 50, 'thumbnail decode must scale before full allocation');
  assert(thumbnail.bytes.get_size() <= 64 * 1024, 'thumbnail must respect its byte limit');

  const body = stringFromBytes(await new Promise((resolve, reject) => {
    Gio.File.new_for_path(store.indexPath).load_contents_async(null, (file, result) => {
      try {
        const [ok, contents] = file.load_contents_finish(result);
        if (!ok)
          throw new Error('Unable to read test index');
        resolve(new GLib.Bytes(contents));
      } catch (error) {
        reject(error);
      }
    });
  }));
  assert(body.includes('/etc/passwd'), 'test fixture must exercise an external path');
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
