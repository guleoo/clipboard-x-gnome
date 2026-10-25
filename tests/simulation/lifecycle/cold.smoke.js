import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Desktop, UUID, assert, init, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';
export {init};

function read(path) {
  const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function queues(directory) {
  const documents = [];
  const root = Gio.File.new_for_path(directory);
  if (!root.query_exists(null)) return documents;
  const children = root.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
  try {
    for (let info; (info = children.next_file(null));) {
      if (info.get_name().endsWith('.json')) documents.push(read(root.get_child(info.get_name()).get_path()));
    }
  } finally { children.close(null); }
  return documents;
}

export async function run() {
  const desktop = await Desktop.create();
  const statePath = GLib.getenv('CBX_SIMULATION_COLD_STATE');
  const phase = GLib.getenv('CBX_SIMULATION_COLD_PHASE');
  assert(statePath?.startsWith(`${GLib.getenv('CBX_SIMULATION_RUNTIME')}/`), 'Cold fixture state must be runner-owned');
  if (phase === 'seed') {
    const target = await Target.open(desktop);
    try {
      desktop.settings.set_strv('panel-shortcut', ['<Control><Shift>F8']);
      const pinned = await capture(desktop, target, 'Pinned history across separate Shell processes');
      await desktop.open();
      await desktop.click(desktop.history._itemRows.get(pinned.id).focusActors
        .find(actor => actor._clipboardXGnomeEntryAction === 'pin'));
      await until(() => pinned.favorite, 'native pin before cold shutdown');
      await desktop.phrases.replace(['Phrase across separate Shell processes']);
      const {SyncConfigurationStore} = await import(`${desktop.app.dir.get_uri()}/sync/configuration-store.js`);
      const channelId = GLib.uuid_string_random();
      await new SyncConfigurationStore().saveConnection({serverAddress: 'http://127.0.0.1:1',
        apiKey: 'synthetic-offline-cold-fixture', activeChannelId: channelId});
      desktop.settings.set_uint('sync-configuration-revision', desktop.settings.get_uint('sync-configuration-revision') + 1);
      desktop.settings.set_string('sync-send-mode', 'automatic');
      desktop.settings.set_boolean('sync-enabled', true);
      const queued = await capture(desktop, target, 'Durable upload intent across separate Shell processes');
      const directory = desktop.app._uploadQueue._directory;
      await until(() => !desktop.app._controller._savePending && queues(directory).some(document =>
        document.entries.some(entry => entry.itemId === queued.id && entry.channelId === channelId)),
      'production history save and destination-bound intent are durable', 10000);
      const expected = {pid: new Gio.Credentials().get_unix_pid(), deviceId: desktop.settings.get_string('device-id'),
        pinnedId: pinned.id, queuedId: queued.id, channelId};
      const source = GLib.getenv('CBX_SIMULATION_DICTIONARY_URL');
      if (source) {
        const dictionary = await desktop.app._dictionaryStore.refreshSource(source);
        desktop.settings.set_strv('tokenizer-dictionary-files', [dictionary.fileName]);
        expected.dictionaryFile = dictionary.fileName;
        expected.dictionarySource = source;
      }
      Gio.File.new_for_path(statePath).replace_contents(new TextEncoder().encode(JSON.stringify(expected)), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
      print('[lifecycle] SEEDED actual clipboard, phrase and durable destination-bound upload');
    } finally { await target.close(); }
    // Return normally: the official scripting harness exits this Shell process.
    return;
  }
  assert(phase === 'restore', 'Unknown cold lifecycle phase');
  const expected = read(statePath);
  assert(new Gio.Credentials().get_unix_pid() !== expected.pid, 'Restoration must run in a different Shell PID');
  assert(desktop.settings.get_string('device-id') === expected.deviceId, 'Cold startup preserves device identity');
  assert(desktop.app._controller.items[0]?.id === expected.pinnedId
    && desktop.app._controller.items[0].favorite
    && desktop.app._controller.items.some(item => item.id === expected.queuedId), 'Cold startup restores history and pinned order');
  assert(desktop.phrases.phrases.includes('Phrase across separate Shell processes'), 'Cold startup restores phrases');
  const documents = queues(desktop.app._uploadQueue._directory);
  assert(documents.some(document => document.entries.some(entry => entry.itemId === expected.queuedId
    && entry.channelId === expected.channelId && entry.deviceId === expected.deviceId
    && entry.serverAddress === 'http://127.0.0.1:1')), 'Cold startup must retain the original queue destination');
  if (expected.dictionaryFile) {
    const state = GLib.getenv('CBX_SIMULATION_DICTIONARY_STATE');
    const before = read(state).requests;
    const dictionaries = await desktop.app._dictionaryStore.list();
    assert(dictionaries.some(dictionary => dictionary.fileName === expected.dictionaryFile
      && dictionary.source === expected.dictionarySource), 'Cold startup retains the network source metadata');
    const target = await Target.open(desktop);
    try {
      const item = await capture(desktop, target, '冷启动机械海豚');
      await desktop.open();
      await desktop.click(desktop.history._itemRows.get(item.id).focusActors
        .find(actor => actor._clipboardXGnomeEntryAction === 'tokenize'));
      await until(() => desktop.words.state?.source === '冷启动机械海豚', 'cold dictionary word panel targets the new item, not pinned history');
      assert(desktop.words.state.tokens.some(token => token.text === '冷启动机械海豚'),
        'The actual word panel must use the persisted custom dictionary after cold startup');
      assert(read(state).requests === before, 'Opening the real word panel must not refresh a network dictionary');
      print('[lifecycle] PASS DICT-07-cold');
    } finally { await target.close(); }
  }
  await desktop.destroy();
  print(`[lifecycle] PASS ENV-06: two real Shell PIDs; identity/history/phrases/queue restored (${UUID})`);
}
