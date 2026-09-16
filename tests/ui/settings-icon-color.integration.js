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
const [, link, dark] = controls;
assert(link.active && !dark.sensitive, 'dark color must initially follow the light color');
assert(link.has_css_class('suggested-action') && !link.has_css_class('flat'),
  'linked colors must display an emphasized button background');
assert(link.get_child().gicon.get_file().get_basename() === 'link-2-symbolic.svg',
  'linked state must show a recognizable chain icon');
link.active = false;
assert(settings.get_string('device-icon-color-dark') === '#606060' && dark.sensitive,
  'unlocking must enable the editable dark color with its computed starting value');
assert(link.has_css_class('flat') && !link.has_css_class('suggested-action'),
  'unlinked colors must have no persistent button background');
assert(link.get_child().gicon.get_file().get_basename() === 'link-2-off-symbolic.svg',
  'unlinked state must show the broken chain');
link.active = true;
assert(settings.get_string('device-icon-color-dark') === '' && !dark.sensitive,
  'locking must restore automatic calculation and disable manual dark edits');
assert(link.has_css_class('suggested-action') && !link.has_css_class('flat'),
  'relinking must restore the emphasized background');
