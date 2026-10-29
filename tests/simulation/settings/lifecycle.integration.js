// Run in an isolated GTK4 session with GSETTINGS_BACKEND=memory.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

Gtk.init();
Adw.init();
Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const {ExtensionPreferences} = await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
// This standalone GTK process has no extensionManager; translation is not under test.
const lookup = ExtensionPreferences.lookupByURL;
ExtensionPreferences.lookupByURL = () => ({gettext: value => value});
const {onClosed} = await import('../../../src/ui/settings/lifecycle.js');
const theme = await import('../../../src/ui/settings/theme-color.js');
const foreground = await import('../../../src/ui/settings/foreground-color.js');
const about = await import('../../../src/ui/settings/about.js');
const runningApps = await import('../../../src/ui/settings/running-apps.js');
const dictionaries = await import('../../../src/ui/settings/dictionaries.js');
const {bind} = await import('../../../src/ui/settings/file-verification.js');
const {PreferenceRows} = await import('../../../src/ui/settings/rows.js');
const directory = GLib.getenv('CBX_TEST_BUILD_DIR');
if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory' || !directory)
  throw new Error('Settings lifecycle tests require the memory backend and CBX_TEST_BUILD_DIR');
const schema = Gio.SettingsSchemaSource.new_from_directory(directory, Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: schema.lookup('org.gnome.shell.extensions.clipboard-x-gnome', false)});
function assert(condition, message) { if (!condition) throw new Error(message); }
const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
  resolve(); return GLib.SOURCE_REMOVE;
}));
async function until(predicate, message) {
  for (let i = 0; i < 250; i++) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(message);
}
function children(widget) {
  const result = [widget];
  for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
    result.push(...children(child));
  return result;
}
function mount(content) {
  const window = new Adw.PreferencesWindow({title: 'Settings lifecycle fixture'});
  if (content instanceof Adw.PreferencesPage) {
    window.add(content);
  } else {
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup();
    group.add(content);
    page.add(group);
    window.add(page);
  }
  window.present();
  return window;
}
const visibleWindows = () => Gtk.Window.list_toplevels().filter(window => window.visible);

try {
  const row = new Adw.ActionRow({title: 'Close lifetime'});
  let cleanups = 0;
  const finish = onClosed(row, () => cleanups++);
  const window = mount(row);
  await until(() => window.get_mapped(), 'Preferences fixture did not map');
  window.close();
  assert(cleanups === 1, 'normal window close must release a still-rooted settings row immediately');
  finish();
  assert(cleanups === 1, 'cleanup must run only once');

  for (const [control, tooltip] of [
    [foreground, 'Text and icon color'], [theme, 'Add custom color'],
  ]) {
    const colorRow = control.create(settings);
    const parent = mount(colorRow);
    await until(() => parent.get_mapped(), 'Color preferences fixture did not map');
    const before = [settings.get_string('foreground-color'), settings.get_string('theme-color')];
    children(colorRow).find(child => child instanceof Gtk.Button && child.tooltip_text === tooltip).emit('clicked');
    await until(() => visibleWindows().some(dialog => dialog !== parent && dialog.get_mapped()),
      'Native color chooser did not open');
    parent.close();
    await until(() => visibleWindows().length === 0, 'Closing preferences must cancel the native color chooser');
    assert(JSON.stringify(before) === JSON.stringify([settings.get_string('foreground-color'), settings.get_string('theme-color')]),
      'Closing a native chooser must not change the configured colors');
  }

  const shortcut = new PreferenceRows(settings).shortcut('panel-shortcut', 'Shortcut lifetime');
  const shortcutParent = mount(shortcut);
  await until(() => shortcutParent.get_mapped(), 'Shortcut preferences fixture did not map');
  children(shortcut).find(child => child instanceof Gtk.Button).emit('clicked');
  await until(() => visibleWindows().some(dialog => dialog !== shortcutParent && dialog.get_mapped()),
    'Native shortcut recorder did not open');
  shortcutParent.close();
  await until(() => visibleWindows().length === 0, 'Closing preferences must close its shortcut recorder');

  let completeCheck, checkCancellable;
  let errors = 0;
  settings.set_boolean('sync-use-sha256sum', false);
  const checkRow = new Adw.SwitchRow();
  onClosed(checkRow, bind(settings, checkRow, {
    checkDependency: cancellable => {
      checkCancellable = cancellable;
      return new Promise(resolve => { completeCheck = resolve; });
    },
    onError: () => errors++,
  }));
  const checkParent = mount(checkRow);
  checkRow.active = true;
  checkParent.close();
  assert(checkCancellable.is_cancelled(), 'Closing preferences must cancel an outstanding dependency check');
  completeCheck();
  await sleep(30);
  assert(!settings.get_boolean('sync-use-sha256sum') && errors === 0,
    'A late dependency result must not enable a setting or report an error after close');

  // Delay external operations at the callback boundary; never open a host browser.
  const originalLaunch = Gtk.UriLauncher.prototype.launch;
  const originalFinish = Gtk.UriLauncher.prototype.launch_finish;
  const originalPresent = Adw.AlertDialog.prototype.present;
  let pendingLaunch;
  try {
    Gtk.UriLauncher.prototype.launch = function (_parent, cancellable, callback) {
      pendingLaunch = {source: this, cancellable, callback};
    };
    Gtk.UriLauncher.prototype.launch_finish = () => { throw new Error('Late launcher failure'); };
    Adw.AlertDialog.prototype.present = () => errors++;
    const page = about.create({url: 'https://example.invalid', 'version-name': 'test'});
    const parent = mount(page);
    children(page).find(child => child instanceof Adw.ActionRow && child.title === 'Project website').emit('activated');
    parent.close();
    assert(pendingLaunch.cancellable.is_cancelled(), 'Closing preferences must cancel its external launcher');
    pendingLaunch.callback(pendingLaunch.source, {});
    assert(errors === 0, 'A late launcher error must not open a dialog after close');
  } finally {
    Gtk.UriLauncher.prototype.launch = originalLaunch;
    Gtk.UriLauncher.prototype.launch_finish = originalFinish;
    Adw.AlertDialog.prototype.present = originalPresent;
  }

  const bus = Gio.DBus.session;
  const originalCall = bus.call;
  const originalCallFinish = bus.call_finish;
  let pendingCall;
  try {
    bus.call = function (...args) { pendingCall = {cancellable: args.at(-2), callback: args.at(-1)}; };
    bus.call_finish = () => new GLib.Variant('(a(ss))', [[['Late app', 'late.app']]]);
    const appsRow = runningApps.create(settings);
    const appsParent = mount(appsRow);
    const originalModel = appsRow.model;
    appsParent.close();
    assert(pendingCall.cancellable.is_cancelled(), 'Closing preferences must cancel the running-applications request');
    pendingCall.callback(bus, {});
    assert(appsRow.model === originalModel, 'Late applications must not update a closed preferences row');
  } finally {
    bus.call = originalCall;
    bus.call_finish = originalCallFinish;
  }

  const languageNames = GLib.get_language_names;
  const originalOpen = Gtk.FileDialog.prototype.open;
  const originalOpenFinish = Gtk.FileDialog.prototype.open_finish;
  let pendingFile, finishList, dictionaryCancellable;
  let imports = 0;
  try {
    GLib.get_language_names = () => ['zh_CN'];
    Gtk.FileDialog.prototype.open = function (_parent, cancellable, callback) {
      pendingFile = {source: this, cancellable, callback};
    };
    Gtk.FileDialog.prototype.open_finish = () => Gio.File.new_for_path('/tmp/not-imported-after-close.dict');
    const parent = new Adw.PreferencesWindow();
    const group = dictionaries.create({settings, window: parent, store: {
      list: cancellable => {
        dictionaryCancellable = cancellable;
        return new Promise(resolve => { finishList = resolve; });
      },
      importFile: async () => { imports++; },
    }});
    const page = new Adw.PreferencesPage();
    page.add(group);
    parent.add(page);
    parent.present();
    children(group).find(child => child instanceof Gtk.Button && child.label === 'Import…').emit('clicked');
    parent.close();
    assert(dictionaryCancellable.is_cancelled() && pendingFile.cancellable.is_cancelled(),
      'Closing dictionary preferences must cancel both the list request and file chooser');
    pendingFile.callback(pendingFile.source, {});
    finishList([]);
    await sleep(30);
    assert(imports === 0, 'A late file chooser response must not start a new import after close');
  } finally {
    GLib.get_language_names = languageNames;
    Gtk.FileDialog.prototype.open = originalOpen;
    Gtk.FileDialog.prototype.open_finish = originalOpenFinish;
  }
} finally {
  ExtensionPreferences.lookupByURL = lookup;
  for (const window of visibleWindows())
    window.close();
}
