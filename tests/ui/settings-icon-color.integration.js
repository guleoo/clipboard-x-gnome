import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function findControls(widget) {
  if (widget instanceof Gtk.Box) {
    const children = [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
      children.push(child);
    if (children.length === 3 && children[0] instanceof Gtk.Button
        && children[1] instanceof Gtk.ToggleButton && children[2] instanceof Gtk.Button)
      return children;
  }
  for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
    const found = findControls(child);
    if (found)
      return found;
  }
  return null;
}

Gtk.init();
Adw.init();
if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
  throw new Error('Device icon color test requires GSETTINGS_BACKEND=memory');
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
const {create} = await import('../../src/ui/settings/device-icon-color.js');
const row = create(settings, label => label);
const controls = findControls(row);
assert(row.subtitle.length > 0, 'the color preference must explain its light and dark behavior');
assert(controls !== null, 'the row must contain exactly two swatches separated by a link button');
const [light, link, dark] = controls;
assert(light.sensitive && dark.sensitive && link.active,
  'both colors must be editable while linked');
assert(link.has_css_class('suggested-action') && !link.has_css_class('flat'),
  'linked colors must display an emphasized button background');
assert(link.get_child().gicon.get_file().get_basename() === 'link-2-symbolic.svg',
  'linked state must show a recognizable chain icon');
const {setIconColor} = await import('../../src/sync/icon-color.js');
setIconColor(settings, 'dark', '#204050');
assert(link.active && settings.get_string('device-icon-color-light') === '#66ccff'
    && settings.get_string('device-icon-color-dark') === '#204050',
  'editing the dark swatch while linked must derive light without changing button state');
link.active = false;
assert(!settings.get_boolean('device-icon-color-linked') && dark.sensitive,
  'unlocking must retain separate editable colors');
assert(link.has_css_class('flat') && !link.has_css_class('suggested-action'),
  'unlinked colors must have no persistent button background');
assert(link.get_child().gicon.get_file().get_basename() === 'link-2-symbolic.svg',
  'the chain icon must remain unchanged when unlinked');
link.active = true;
assert(settings.get_boolean('device-icon-color-linked') && dark.sensitive,
  'locking must retain both editable swatches');
assert(settings.get_string('device-icon-color-dark') === '',
  'relinking must derive dark from the current light color');
assert(link.has_css_class('suggested-action') && !link.has_css_class('flat'),
  'relinking must restore the emphasized background');
