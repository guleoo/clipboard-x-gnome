import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {restore} from '../../../src/ui/settings/defaults.js';
import {ClipboardItem} from '../../../src/clipboard/item.js';
import {HistoryStore} from '../../../src/clipboard/history/store.js';
import {PhraseStore} from '../../../src/clipboard/phrases/store.js';
import {DictionaryStore} from '../../../src/clipboard/tokenizer/dictionary/store.js';
import {SyncConfigurationStore} from '../../../src/sync/configuration-store.js';
import {removeTree} from '../clipboard/controller-fixture.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
  throw new Error('Settings reset tests require the memory GSettings backend');

const buildDirectory = GLib.getenv('CBX_TEST_BUILD_DIR');
assert(buildDirectory, 'Settings reset tests must run through Meson');
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
  buildDirectory,
  Gio.SettingsSchemaSource.get_default(),
  false,
);
const settings = new Gio.Settings({
  settings_schema: schemaSource.lookup('org.gnome.shell.extensions.clipboard-x-gnome', false),
});
assert(settings.get_string('sensitive-content-mode') === 'discard',
  'sensitive clipboard content must not be recorded by default');
assert(settings.get_uint('tokenizer-word-limit') === 2000, 'Word selection must default to at most 2000 items');
assert(settings.get_string('simulated-input-speed') === 'standard', 'Simulated keystrokes use standard speed by default');
settings.set_string('simulated-input-speed', 'medium');
settings.set_uint('tokenizer-word-limit', 3000);
settings.set_string('sensitive-content-mode', 'memory');
assert(!settings.get_boolean('sync-use-sha256sum'), 'external file verification must be disabled by default');
settings.set_boolean('sync-use-sha256sum', true);
const deviceId = GLib.uuid_string_random();
settings.set_string('device-id', deviceId);
settings.set_strv('saved-phrases', ['Keep this phrase']);
settings.set_uint('sync-configuration-revision', 17);
settings.set_uint('tokenizer-dictionary-revision', 4);
settings.set_string('editor-command', 'gradia %f');
settings.set_int('panel-width', 480);
settings.set_uint('text-full-threshold', 131072);
settings.set_strv('tokenizer-dictionary-files', ['zh--user.dict']);
settings.set_boolean('sync-enabled', true);
settings.set_strv('entry-actions', ['delete', 'pin', 'sync', 'edit', 'tokenize']);
settings.set_strv('entry-hidden-actions', ['pin', 'delete']);

restore(settings);

assert(settings.get_string('device-id') === deviceId, 'reset changed the stable DeviceId');
assert(settings.get_strv('saved-phrases').join() === 'Keep this phrase',
  'reset removed legacy quick-phrase data');
assert(settings.get_uint('sync-configuration-revision') === 17,
  'reset changed the server-connection revision');
assert(settings.get_uint('tokenizer-dictionary-revision') === 4,
  'reset changed the dictionary revision');
for (const key of settings.list_keys()) {
  if (['device-id', 'saved-phrases', 'sync-configuration-revision',
    'tokenizer-dictionary-revision'].includes(key))
    continue;
  assert(settings.get_value(key).equal(settings.get_default_value(key)),
    `${key} did not return to its schema default`);
}

const observer = new Gio.Settings({settings_schema: settings.settings_schema});
settings.set_boolean('private-mode', true);
settings.set_boolean('sync-enabled', true);
settings.set_int('panel-width', 480);
assert(observer.get_boolean('private-mode') && observer.get_boolean('sync-enabled')
    && observer.get_int('panel-width') === 480 && !settings.get_has_unapplied(),
  'Edits after restoring defaults must immediately reach the backend and other settings instances');
restore(settings);
settings.set_boolean('private-mode', true);
assert(observer.get_boolean('private-mode') && !settings.get_has_unapplied(),
  'Restoring defaults repeatedly must not leave the preferences instance in delayed mode');

// The data-preservation matrix uses real stores and memory-backed GSettings,
// not a desktop, file picker or settings window. All paths are explicit fixtures.
const root = Gio.File.new_for_path(GLib.dir_make_tmp('cbx-reset-data-XXXXXX'));
try {
  const history = new HistoryStore({rootPath: root.get_child('history').get_path(), deviceId});
  const item = ClipboardItem.fromText('History survives settings reset');
  await history.save([item]);
  const phrases = new PhraseStore(settings, {path: root.get_child('quick-phrases.json').get_path()});
  await phrases.ready;
  await phrases.replace(['Quick phrases survive settings reset']);
  const dictionaries = new DictionaryStore({rootPath: root.get_child('dictionaries').get_path()});
  const source = root.get_child('source.dict');
  source.replace_contents(new TextEncoder().encode('# locale: zh_CN\n# name: Reset test\n青铜机械海豚 1000\n'),
    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
  const dictionary = await dictionaries.importFile(source);
  const connection = new SyncConfigurationStore({path: root.get_child('sync.json').get_path()});
  await connection.saveConnection({serverAddress: '127.0.0.1:9', apiKey: 'synthetic-reset-key',
    activeChannelId: GLib.uuid_string_random()});
  const files = [history.directory().index, item.primary.path, phrases.path,
    dictionaries.getFile(dictionary.fileName).get_path(), connection.path];
  const before = files.map(path => GLib.base64_encode(Gio.File.new_for_path(path).load_contents(null)[1]));
  settings.set_boolean('sync-enabled', true);
  settings.set_int('panel-width', 460);
  restore(settings);
  assert(settings.get_string('device-id') === deviceId && !settings.get_boolean('sync-enabled'),
    'Reset must retain identity while disabling integration');
  files.forEach((path, index) => {
    assert(GLib.base64_encode(Gio.File.new_for_path(path).load_contents(null)[1]) === before[index],
      `Reset must preserve existing data bytes: ${GLib.path_get_basename(path)}`);
  });
} finally { removeTree(root); }
