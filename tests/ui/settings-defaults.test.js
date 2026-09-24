import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {restore} from '../../src/ui/settings/defaults.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
  throw new Error('Settings reset tests require the memory GSettings backend');

const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_path();
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
  GLib.build_filenamev([directory, 'build']),
  Gio.SettingsSchemaSource.get_default(),
  false,
);
const settings = new Gio.Settings({
  settings_schema: schemaSource.lookup('org.gnome.shell.extensions.clipboard-x', false),
});
assert(!settings.list_keys().includes('history-type-activation-shortcut'),
  'the redundant Ctrl+Enter typing shortcut must not remain in preferences');
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
