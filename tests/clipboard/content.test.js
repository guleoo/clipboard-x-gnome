import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Content} from '../../src/clipboard/content.js';
import {ClipboardItem} from '../../src/clipboard/item.js';
import {HistoryStore} from '../../src/clipboard/history/store.js';
import {bytesFromString} from '../../src/common/bytes.js';
import {launchEditor} from '../../src/screenshot/editor-launcher.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function rejects(operation, message) {
  try { await operation; } catch { return; }
  throw new Error(message);
}

// Exercise the coordinator against real isolated history files. This adapter
// supplies only the Controller contract, not GNOME clipboard or retention policy.
class History {
  constructor(store) {
    this.store = store;
    this.items = [];
    this.writes = 0;
    this.commits = 0;
    this.activations = 0;
    this.commit = () => {};
  }

  add(item, _source, {replaceDuplicate} = {}) {
    const existing = this.items.find(value => value.equals(item));
    if (existing && !replaceDuplicate)
      return existing;
    if (existing) {
      item.favorite = existing.favorite;
      this.remove(existing.id);
    }
    this.items.push(item);
    return item;
  }

  remove(id) { this.items = this.items.filter(item => item.id !== id); }
  async persist() {
    this.writes++;
    await this.store.save(this.items);
  }
  commitContent(item) {
    this.commits++;
    this.commit(item);
    return this.items.includes(item);
  }
  materialize(item) { return this.store.materialize(item); }
  discardContent(items) { return this.store.discard(items); }
  async activate(item, {guard}) {
    await this.materialize(item);
    if (guard())
      this.activations++;
  }
}

const root = GLib.dir_make_tmp('clipboard-x-gnome-content-test-XXXXXX');
const deviceId = GLib.uuid_string_random();
const store = new HistoryStore({rootPath: root, deviceId, items: () => history.items});
const history = new History(store);
const incoming = new Map();
const errors = [];
let mode = 'history';
const remote = {
  getItem: async id => incoming.get(id),
  materialize: async () => {},
};
const content = new Content({
  history, remote, receiveMode: () => mode, deviceId: () => deviceId,
  onError: error => errors.push(error),
});
const receive = changes => content.receive(changes, {isCurrent: () => true});
const upsert = item => ({kind: 'upsert', itemId: item.id});
const remove = item => ({kind: 'remove', itemId: item.id});
const preview = text => {
  const item = ClipboardItem.fromText(text, {originDeviceId: GLib.uuid_string_random(), remote: true});
  item.primary.bytes = null;
  item.availability = 'preview';
  incoming.set(item.id, item);
  return item;
};
const original = text => {
  const item = preview(text);
  item.primary.bytes = bytesFromString(text);
  item.availability = 'ready';
  history.add(item);
  return item;
};

try {
  const page = [preview('incoming one'), preview('incoming two')];
  const downloaded = deferred();
  let downloads = 0;
  remote.materialize = async (item, options) => {
    assert(history.writes === 1 && options.withinThreshold,
      'Automatic originals must start after one durable metadata write per page');
    item.primary.bytes = bytesFromString(item.preview.text);
    item.availability = 'ready';
    if (++downloads === page.length)
      downloaded.resolve();
  };
  await receive(page.map(upsert));
  await downloaded.promise;
  await Promise.resolve();
  assert(history.writes === 1 && history.commits === 2,
    'Received originals must be committed without another immediate whole-history write');
  await history.persist();
  const restored = await store.load();
  assert(page.every(item => restored.some(value => value.id === item.id)),
    'Accepted metadata must survive a new history load');

  const fullText = 'The full original extends well beyond its preview.';
  const text = original(fullText);
  text.preview.text = 'The full';
  await history.persist();
  text.primary.bytes = null;
  remote.materialize = async () => {};
  await content.read(text);
  assert(text.text === fullText, 'Interactive text use must read the full locally cached original');

  const edited = preview('original prepared for editing');
  history.add(edited);
  let localReads = 0;
  const read = history.materialize;
  history.materialize = async item => { localReads++; return read.call(history, item); };
  remote.materialize = async item => {
    item.primary.bytes = bytesFromString(item.preview.text);
    item.availability = 'ready';
  };
  const beforeEdit = history.writes;
  const path = await content.file(edited);
  assert(path === edited.primary.path && history.writes === beforeEdit + 1 && localReads === 0,
    'Preparing an editor file must flush once without rereading the full original');
  history.materialize = read;

  const image = ClipboardItem.fromBytes('image/png', new GLib.Bytes(new Uint8Array([137, 80, 78, 71])));
  history.add(image);
  await history.persist();
  const cachedImage = (await store.load()).find(item => item.id === image.id);
  assert(cachedImage.primary.path && !cachedImage.primary.bytes,
    'A reloaded image must start with a file path and no in-memory original');
  const imagePath = await content.file(cachedImage);
  const editor = await launchEditor({
    command: `/usr/bin/cmp - %i '${imagePath}'`,
    uri: Gio.File.new_for_path(imagePath).get_uri(),
    bytes: cachedImage.primary.bytes,
  });
  await new Promise((resolve, reject) => editor.wait_check_async(null, (process, result) => {
    try { process.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
  }));
  assert(!cachedImage.primary.bytes,
    'A standard-input editor must receive the exact cached file without loading it into the item');

  const previous = preview('duplicate across destinations');
  previous.favorite = true;
  history.add(previous);
  const replacement = preview('duplicate across destinations');
  let requested;
  remote.materialize = async item => { requested = item.id; };
  await receive([upsert(replacement)]);
  assert(requested === replacement.id && replacement.favorite && !history.items.includes(previous),
    'Incomplete duplicates must request the incoming locator while preserving the pin');

  const deleted = preview('deletion persisted before cursor acceptance');
  history.add(deleted);
  await history.persist();
  const persist = history.persist;
  history.persist = async () => { throw new Error('Temporary disk failure'); };
  await rejects(receive([remove(deleted)]), 'Failed deletion persistence must reject acceptance');
  history.persist = persist;
  await receive([remove(deleted)]);
  assert(!(await store.load()).some(item => item.id === deleted.id),
    'Replaying an already removed item must still persist its deletion');

  const obsolete = preview('obsolete session');
  const manifest = deferred();
  const getItem = remote.getItem;
  remote.getItem = () => manifest.promise;
  let current = true;
  const receiving = content.receive([upsert(obsolete)], {isCurrent: () => current});
  current = false;
  manifest.resolve(obsolete);
  await receiving;
  assert(!history.items.includes(obsolete), 'A superseded manifest must not enter the new history');
  remote.getItem = getItem;

  mode = 'activate';
  const superseded = preview('session switched during download');
  const obsoleteDownload = deferred();
  const obsoleteFinished = deferred();
  remote.materialize = async () => {
    await obsoleteDownload.promise;
    obsoleteFinished.resolve();
  };
  current = true;
  const beforeSwitch = history.commits;
  await content.receive([upsert(superseded)], {isCurrent: () => current});
  current = false;
  obsoleteDownload.resolve();
  await obsoleteFinished.promise;
  await Promise.resolve();
  assert(history.commits === beforeSwitch && history.activations === 0,
    'A superseded background download must not commit state or activate');

  const delayed = preview('deleted during download');
  const download = deferred();
  const finished = deferred();
  remote.materialize = async item => {
    await download.promise;
    item.primary.bytes = bytesFromString(item.preview.text);
    item.availability = 'ready';
    finished.resolve();
  };
  await receive([upsert(delayed)]);
  await receive([remove(delayed)]);
  download.resolve();
  await finished.promise;
  await Promise.resolve();
  assert(history.activations === 0, 'An item removed during download must not activate');

  const reading = original('deleted during final clipboard read');
  await history.persist();
  const enteredRead = deferred();
  const finalRead = deferred();
  remote.materialize = async () => {};
  history.materialize = async () => { enteredRead.resolve(); await finalRead.promise; };
  const activating = content.activate(reading);
  await enteredRead.promise;
  history.remove(reading.id);
  finalRead.resolve();
  await rejects(activating, 'Removal during the final read must cancel activation');
  assert(history.activations === 0, 'The final clipboard write must recheck retention');
  history.materialize = read;

  const evicted = preview('evicted when original exceeds capacity');
  history.add(evicted);
  history.commit = item => history.remove(item.id);
  remote.materialize = async item => {
    item.primary.bytes = bytesFromString(item.preview.text);
    item.availability = 'ready';
  };
  await rejects(content.activate(evicted), 'A capacity-evicted item must not activate');
  assert(history.activations === 0, 'Content commit must precede activation');
  history.commit = () => {};

  const screenshot = ClipboardItem.fromText('local transient screenshot stand-in');
  await content.activate(screenshot);
  assert(history.activations === 1, 'Local transient content need not be retained in history to activate');

  const stopped = preview('disabled during local read');
  history.add(stopped);
  const stoppedRead = deferred();
  const releaseRead = deferred();
  history.materialize = async () => { stoppedRead.resolve(); await releaseRead.promise; };
  const operation = content.read(stopped);
  await stoppedRead.promise;
  content.destroy();
  releaseRead.resolve();
  await rejects(operation, 'Disabling the coordinator must invalidate a pending local read');
  assert(errors.length === 0, 'Expected supersession or deletion must not report background errors');
  print('Content coordination: durable pages, originals, retention and lifecycle passed');
} finally {
  content.destroy();
  deleteTree(Gio.File.new_for_path(root));
}

function deleteTree(file) {
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
    const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = enumerator.next_file(null)))
      deleteTree(file.get_child(info.get_name()));
    enumerator.close(null);
  }
  file.delete(null);
}
