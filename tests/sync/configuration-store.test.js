import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncConfigurationStore} from '../../src/sync/configuration-store.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const directory = GLib.dir_make_tmp('clipboard-x-sync-config-test-XXXXXX');
const path = GLib.build_filenamev([directory, 'sync.json']);
const progressPath = GLib.build_filenamev([directory, 'sync-state.json']);
const channelId = '11111111-1111-4111-8111-111111111111';

try {
  const store = new SyncConfigurationStore({path, progressPath});
  const empty = await store.load();
  assert(!store.exists && !empty.serverAddress && !empty.apiKey,
    'a missing sync.json must produce an empty configuration');
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
} finally {
  for (const filePath of [path, progressPath]) {
    try {
      Gio.File.new_for_path(filePath).delete(null);
    } catch (_error) {
      // The test may fail before the file is created.
    }
  }
  Gio.File.new_for_path(directory).delete(null);
}
