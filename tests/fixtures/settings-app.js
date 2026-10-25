// Full preferences UI in an independent GTK process. IPC observes, never clicks widgets.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

const [extensionUri, directory] = ARGV;
Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const {ExtensionPreferences} = await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
const extensionDir = Gio.File.new_for_uri(extensionUri);
const [, metadataBytes] = extensionDir.get_child('metadata.json').load_contents(null);
const metadata = {...JSON.parse(new TextDecoder().decode(metadataBytes)), dir: extensionDir, path: extensionDir.get_path()};
let preferences;
// Supply the registry normally owned by the real GNOME preferences host; keep real gettext/settings.
ExtensionPreferences.lookupByUUID = uuid => uuid === metadata.uuid ? preferences ?? null : null;
const {default: Preferences} = await import(`${extensionUri}/prefs.js`);
preferences = new Preferences(metadata);
const settings = preferences.getSettings();
const application = new Gtk.Application({application_id: 'io.github.guleoo.CbxSettingsAcceptance',
  flags: Gio.ApplicationFlags.NON_UNIQUE});
const stateFile = Gio.File.new_for_path(`${directory}/state.json`);
const commandFile = Gio.File.new_for_path(`${directory}/command.json`);
let state = {ready: false, command: 0};
const ids = new WeakMap();
let nextId = 0;
function id(widget) {
  if (!ids.has(widget)) ids.set(widget, ++nextId);
  return ids.get(widget);
}
function walk(widget, root, row = '') {
  const type = GObject.type_name(widget.constructor.$gtype);
  if (widget instanceof Adw.PreferencesRow) row = widget.get_title();
  else if (widget instanceof Gtk.ListBoxRow) {
    // Layout rows are plain ListBoxRows, not Adw.PreferencesRows. Expose the
    // same visible label a user uses to distinguish their native controls.
    const firstLabel = child => {
      if (child instanceof Gtk.Label) return child.label;
      for (let current = child.get_first_child(); current; current = current.get_next_sibling()) {
        const label = firstLabel(current);
        if (label) return label;
      }
      return '';
    };
    row = firstLabel(widget) || row;
  }
  const record = {id: id(widget), type, row, page: widget._clipboardXGnomePageName ?? null,
    mapped: widget.get_mapped(), sensitive: widget.is_sensitive()};
  record.tooltip = widget.get_tooltip_text();
  if (widget instanceof Gtk.Button || widget instanceof Gtk.Image) record.icon = widget.icon_name;
  if (widget instanceof Adw.ActionRow) record.subtitle = widget.subtitle;
  if (widget instanceof Gtk.Button || widget instanceof Gtk.Label) record.label = widget.label;
  if (widget instanceof Gtk.Entry || widget instanceof Gtk.Text || widget instanceof Adw.EntryRow) record.text = widget.get_text();
  if (widget instanceof Adw.SwitchRow || widget instanceof Gtk.Switch) record.active = widget.active;
  if (widget instanceof Adw.SpinRow) record.value = widget.value;
  if (widget instanceof Adw.ComboRow) {
    record.selected = widget.selected;
    record.choices = Array.from({length: widget.model?.get_n_items() ?? 0}, (_, index) =>
      widget.model.get_item(index)?.get_string?.() ?? '');
  }
  if (widget instanceof Gtk.Stack) record.visibleChild = widget.visible_child_name;
  if (widget instanceof Adw.ShortcutLabel) record.accelerator = widget.accelerator;
  const [valid, bounds] = widget.compute_bounds(root);
  if (valid) {
    record.bounds = {x: bounds.get_x(), y: bounds.get_y(), width: bounds.get_width(), height: bounds.get_height()};
    const hit = root.pick(bounds.get_x() + bounds.get_width() / 2, bounds.get_y() + bounds.get_height() / 2, Gtk.PickFlags.DEFAULT);
    record.hit = false;
    for (let current = hit; current; current = current.get_parent())
      if (current === widget) { record.hit = true; break; }
  }
  const records = [record];
  for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) records.push(...walk(child, root, row));
  return records;
}
function inspect() {
  const windows = Gtk.Window.list_toplevels().filter(window => window.visible);
  return {
    windows: windows.map(window => ({title: window.title, width: window.get_width(), height: window.get_height(),
      surfaceWidth: window.get_surface()?.get_width(), surfaceHeight: window.get_surface()?.get_height(),
      widgets: walk(window, window)})),
    settings: Object.fromEntries(settings.list_keys().map(key => [key, settings.get_value(key).deepUnpack()])),
  };
}
function save() {
  stateFile.replace_contents(new TextEncoder().encode(JSON.stringify(state)), null, false,
    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
application.connect('activate', app => {
  const window = new Adw.PreferencesWindow({application: app});
  try {
    preferences.fillPreferencesWindow(window);
    window.present();
    state.ready = true;
  } catch (error) { state.error = error.message; save(); throw error; }
  const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
    if (!commandFile.query_exists(null)) return GLib.SOURCE_CONTINUE;
    const [, bytes] = commandFile.load_contents(null);
    const command = JSON.parse(new TextDecoder().decode(bytes));
    if (command.id === state.command) return GLib.SOURCE_CONTINUE;
    try {
      state.error = null;
      if (command.action === 'inspect') state.result = inspect();
      else if (command.action === 'translate') state.result = command.strings.map(text => preferences.gettext(text));
      else if (command.action === 'quit') application.quit();
      else throw new Error(`Unsupported observer command: ${command.action}`);
    } catch (error) { state.error = error.message; }
    state.command = command.id;
    save();
    return GLib.SOURCE_CONTINUE;
  });
  window.connect('close-request', () => { GLib.Source.remove(source); return false; });
  save();
});
// Dynamic imports above make this module asynchronous. Do not nest a blocking
// application.run() while its evaluation job is pending: async preference I/O
// would then never drain its Promise continuations.
await application.runAsync([]);
