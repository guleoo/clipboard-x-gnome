import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function find(widget, type) {
  if (widget instanceof type)
    return widget;
  for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
    const match = find(child, type);
    if (match)
      return match;
  }
  return null;
}

Gtk.init();
Adw.init();
if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
  throw new Error('The settings icon test requires GSETTINGS_BACKEND=memory');
const resource = Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource');
resource._register();
const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_path();
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
  GLib.build_filenamev([directory, 'build', 'clipboard-x@guleo.github.io', 'schemas']),
  Gio.SettingsSchemaSource.get_default(),
  false,
);
const settings = new Gio.Settings({
  settings_schema: schemaSource.lookup('org.gnome.shell.extensions.clipboard-x', false),
});
const {PreferenceRows} = await import('../../src/ui/settings/rows.js');
const {DEVICE_ICONS, deviceIcon} = await import('../../src/ui/icons/device.js');
const row = new PreferenceRows(settings).iconCombo('device-icon-kind', 'Device icon',
  DEVICE_ICONS.map(name => [name, name, deviceIcon(name)]));
const group = new Adw.PreferencesGroup();
group.add(row);
const page = new Adw.PreferencesPage();
page.add(group);
const window = new Adw.PreferencesWindow();
window.add(page);
window.present();
while (GLib.MainContext.default().iteration(false));

function selectedIcon() {
  const previewList = find(row, Gtk.ListView);
  return find(previewList, Gtk.Image);
}

assert(selectedIcon()?.gicon?.file?.equal(deviceIcon('computer').file),
  'the preview should initially show the selected custom device icon');

for (const enabled of [true, false]) {
  settings.set_boolean('sync-enabled', enabled);
  row.activate();
  while (GLib.MainContext.default().iteration(false));
  const popover = find(row, Gtk.Popover);
  const list = find(popover, Gtk.ListView);
  const selected = enabled ? 4 : 6;
  assert(list?.model?.get_n_items() === DEVICE_ICONS.length, 'the popup must contain every supplied icon');
  list.model.select_item(selected, true);
  list.emit('activate', selected);
  while (GLib.MainContext.default().iteration(false));
  assert(row.selected === selected && settings.get_string('device-icon-kind') === (enabled ? 'android' : 'windows'),
    'activating a popup choice must save the selected device icon regardless of synchronization state');
  assert(selectedIcon()?.gicon?.file?.equal(deviceIcon(enabled ? 'android' : 'windows').file),
    'the selected icon preview must display the actual selected item, not the first popup choice');
  assert(selectedIcon()?.pixel_size === 16, 'the selected icon should use the compact settings size');
}

settings.set_string('device-icon-kind', 'server');
while (GLib.MainContext.default().iteration(false));
assert(selectedIcon()?.gicon?.file?.equal(deviceIcon('server').file),
  'external settings changes must update the selected icon preview');

group.remove(row);
window.destroy();
while (GLib.MainContext.default().iteration(false));
