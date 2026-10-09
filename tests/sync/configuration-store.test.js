import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncConfigurationStore} from '../../src/sync/configuration-store.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const directory = GLib.dir_make_tmp('clipboard-x-gnome-sync-config-test-XXXXXX');
const path = GLib.build_filenamev([directory, 'sync.json']);
const progressPath = GLib.build_filenamev([directory, 'sync-state.json']);
const retryPath = GLib.build_filenamev([directory, 'retry-state.json']);
const channelId = '11111111-1111-4111-8111-111111111111';
const otherChannelId = '22222222-2222-4222-8222-222222222222';

function inode() {
  return Gio.File.new_for_path(progressPath)
    .query_info('unix::inode', Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint64('unix::inode');
}

try {
  const store = new SyncConfigurationStore({path, progressPath});
  const empty = await store.load();
  assert(!store.exists && !empty.serverAddress && !empty.apiKey,
    'a missing sync.json must produce an empty configuration');
  await store.saveProgress({cursors: {}, workCursor: ''});
  assert(!Gio.File.new_for_path(progressPath).query_exists(null),
    'empty unchanged progress must not create a state file');
  await store.saveConnection({
    serverAddress: '192.168.1.2:8765',
    apiKey: 'cbx_device_secret',
    activeChannelId: channelId,
  });
  await store.saveProgress({
    cursors: {[channelId]: 'change-17'},
    workCursor: 'work-9',
  });
  assert(store.exists, 'saving synchronization configuration must create sync.json');

  const restored = new SyncConfigurationStore({path, progressPath});
  const configuration = await restored.load();
  assert(configuration.serverAddress === '192.168.1.2:8765'
      && configuration.apiKey === 'cbx_device_secret'
      && configuration.activeChannelId === channelId
      && configuration.cursors[channelId] === 'change-17'
      && configuration.workCursor === 'work-9',
    'separate connection and progress files must restore one synchronization state');

  let previousInode = inode();
  for (let poll = 0; poll < 3; poll++) {
    await restored.saveProgress(configuration);
    assert(inode() === previousInode, 'an unchanged poll must not replace the persisted state');
  }
  await restored.saveProgress({cursors: {...configuration.cursors, [otherChannelId]: 'change-2'}, workCursor: 'work-9'});
  assert(inode() !== previousInode, 'adding a channel cursor must be persisted');
  previousInode = inode();
  await restored.saveProgress({cursors: {[otherChannelId]: 'change-2', [channelId]: 'change-17'}, workCursor: 'work-9'});
  assert(inode() === previousInode, 'channel key order must not cause redundant writes');
  await restored.saveProgress({cursors: {[channelId]: 'change-18'}, workCursor: 'work-9'});
  assert(inode() !== previousInode, 'changed or removed channel cursors must be persisted');
  previousInode = inode();
  await restored.saveProgress({cursors: {[channelId]: 'change-18'}, workCursor: 'work-10'});
  assert(inode() !== previousInode, 'an advanced work cursor must be persisted immediately');
  const reloaded = await new SyncConfigurationStore({path, progressPath}).load();
  assert(reloaded.cursors[channelId] === 'change-18' && Object.keys(reloaded.cursors).length === 1
      && reloaded.workCursor === 'work-10' && reloaded.apiKey === configuration.apiKey,
    'a new session must restore changed progress without overwriting connection details');

  const retryFile = Gio.File.new_for_path(retryPath);
  retryFile.make_directory(null);
  const retryStore = new SyncConfigurationStore({path, progressPath: retryPath});
  const nextProgress = {cursors: {[channelId]: 'change-19'}, workCursor: 'work-11'};
  let rejected = false;
  try { await retryStore.saveProgress(nextProgress); }
  catch (_) { rejected = true; }
  assert(rejected && retryStore.current.workCursor === '',
    'a failed write must not be considered persisted');
  retryFile.delete(null);
  await retryStore.saveProgress(nextProgress);
  assert((await new SyncConfigurationStore({path, progressPath: retryPath}).load()).workCursor === 'work-11',
    'the same progress must remain writable after a failed save');
} finally {
  for (const filePath of [path, progressPath, retryPath]) {
    try {
      Gio.File.new_for_path(filePath).delete(null);
    } catch (_error) {
      // The test may fail before the file is created.
    }
  }
  Gio.File.new_for_path(directory).delete(null);
}
