import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncConfigurationStore} from '../../src/sync/configuration-store.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const directory = GLib.dir_make_tmp('clipboard-x-gnome-sync-config-test-XXXXXX');
const path = GLib.build_filenamev([directory, 'sync.json']);
const channelId = '11111111-1111-4111-8111-111111111111';

try {
  const store = new SyncConfigurationStore({path});
  const empty = await store.load();
  assert(!store.exists && !empty.serverAddress && !empty.apiKey,
    'a missing sync.json must produce an empty configuration');
  await store.saveConnection({
    serverAddress: '192.168.1.2:8765', apiKey: 'test-device-key', activeChannelId: channelId,
    cursors: {[channelId]: 'not-connection-data'}, workCursor: 'not-connection-data',
  });
  const restored = await new SyncConfigurationStore({path}).load();
  assert(store.exists && restored.serverAddress === '192.168.1.2:8765'
      && restored.apiKey === 'test-device-key' && restored.activeChannelId === channelId,
    'connection settings must survive a new settings process');
  assert(!Object.hasOwn(restored, 'cursors') && !Object.hasOwn(restored, 'workCursor'),
    'connection settings must not own runtime progress');
  await store.saveConnection({...restored, serverAddress: 'other.invalid:8765'});
  assert((await new SyncConfigurationStore({path}).load()).serverAddress === 'other.invalid:8765',
    'changing servers must only replace connection settings');
} finally {
  const file = Gio.File.new_for_path(path);
  if (file.query_exists(null))
    file.delete(null);
  Gio.File.new_for_path(directory).delete(null);
}
