import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncProgressStore} from '../../src/sync/progress-store.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const directory = GLib.dir_make_tmp('clipboard-x-gnome-progress-test-XXXXXX');
const channel = '11111111-1111-4111-8111-111111111111';
const otherChannel = '22222222-2222-4222-8222-222222222222';
const deviceId = '33333333-3333-4333-8333-333333333333';
const scope = {serverAddress: 'memory.invalid:8765', deviceId};
const progress = {cursors: {[channel]: 'change-17'}, workCursor: 'work-9'};
const store = new SyncProgressStore({directory});

function files() {
  const parent = Gio.File.new_for_path(directory);
  const enumerator = parent.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
  const result = [];
  let info;
  while ((info = enumerator.next_file(null)))
    result.push(parent.get_child(info.get_name()));
  enumerator.close(null);
  return result;
}

function inode(file) {
  return file.query_info('unix::inode', Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint64('unix::inode');
}

try {
  await store.save(scope, {cursors: {}, workCursor: ''});
  assert(files().length === 0, 'unchanged empty progress must not create files');
  await store.save(scope, progress);
  const restored = await new SyncProgressStore({directory}).load(scope);
  assert(restored.cursors[channel] === 'change-17' && restored.workCursor === 'work-9',
    'a new session must restore accepted changes and work');
  const file = files()[0];
  let previous = inode(file);
  await store.save(scope, progress);
  assert(inode(file) === previous, 'unchanged polls must not replace progress files');
  await store.save(scope, {cursors: {...progress.cursors, [otherChannel]: 'change-2'}, workCursor: 'work-9'});
  previous = inode(file);
  await store.save(scope, {cursors: {[otherChannel]: 'change-2', ...progress.cursors}, workCursor: 'work-9'});
  assert(inode(file) === previous, 'key ordering must not cause redundant writes');
  await store.save(scope, {cursors: {[channel]: 'change-18'}, workCursor: 'work-10'});
  assert(inode(file) !== previous, 'advanced and removed cursors must be persisted');
  const normalized = await store.load({...scope, serverAddress: 'http://memory.invalid:8765/'});
  assert(normalized.workCursor === 'work-10', 'equivalent addresses must share progress');
  for (const other of [
    {...scope, serverAddress: 'other.invalid:8765'},
    {...scope, deviceId: '44444444-4444-4444-8444-444444444444'},
  ]) {
    const empty = await store.load(other);
    assert(empty.workCursor === '' && Object.keys(empty.cursors).length === 0,
      'another server or device must never inherit progress');
    await store.save(other, {cursors: {}, workCursor: 'other-work'});
  }
  assert((await store.load(scope)).workCursor === 'work-10',
    'returning to the original destination must restore its own progress');

  const pendingWork = {
    id: '55555555-5555-4555-8555-555555555555',
    type: 'materialize-content', itemId: channel, contentId: 'original',
  };
  await store.save(scope, {...progress, pendingWork});
  const pending = await new SyncProgressStore({directory}).load(scope);
  assert(pending.pendingWork.id === pendingWork.id && pending.pendingWork.contentId === 'original',
    'pending source work must survive a new store instance without storing content or credentials');
  pending.pendingWork.contentId = 'mutated-copy';
  assert((await store.load(scope)).pendingWork.contentId === 'original',
    'callers must not mutate the cached pending work reference');
  const pendingFile = files().find(candidate => {
    const document = JSON.parse(new TextDecoder().decode(candidate.load_contents(null)[1]));
    return document.serverAddress === 'http://memory.invalid:8765' && document.deviceId === deviceId;
  });
  previous = inode(pendingFile);
  await store.save(scope, {...progress, pendingWork});
  assert(inode(pendingFile) === previous, 'unchanged pending work must not rewrite progress');
  for (const invalid of [{...pendingWork, id: '../invalid'}, {...pendingWork, type: 'unknown'}]) {
    let rejected = false;
    try { await store.save(scope, {...progress, pendingWork: invalid}); } catch (_error) { rejected = true; }
    assert(rejected && (await store.load(scope)).pendingWork.id === pendingWork.id,
      'invalid pending work must not replace the durable retry reference');
  }
  assert((await store.load({...scope, serverAddress: 'other.invalid:8765'})).pendingWork === null,
    'pending source work must remain bound to its original server and device');
  await store.save(scope, {cursors: {[channel]: 'change-18'}, workCursor: 'work-10'});

  // Failed atomic writes must not update the cache or poison the write chain.
  file.delete(null);
  file.make_directory(null);
  let rejected = false;
  try { await store.save(scope, progress); } catch (_error) { rejected = true; }
  assert(rejected && (await store.load(scope)).workCursor === 'work-10',
    'failed progress writes must remain retryable');
  file.delete(null);
  await store.save(scope, progress);
  assert((await new SyncProgressStore({directory}).load(scope)).workCursor === 'work-9',
    'retrying the same progress must persist it');
} finally {
  for (const file of files())
    file.delete(null);
  Gio.File.new_for_path(directory).delete(null);
}
