import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UUID = 'clipboard-x-gnome@guleoo.github.io';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

// GTK must stay in its own process, never be imported into GNOME Shell.
export async function verifyLifecycle() {
  const extension = Main.extensionManager.lookup(UUID).stateObj;
  const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
  launcher.setenv('GSETTINGS_BACKEND', 'memory', true);
  launcher.setenv('CBX_TEST_BUILD_DIR', extension.dir.get_child('schemas').get_path(), true);
  const libraries = ['/usr/lib/gnome-shell', '/usr/lib64/gnome-shell']
    .filter(path => GLib.file_test(path, GLib.FileTest.IS_DIR));
  launcher.setenv('GI_TYPELIB_PATH', [GLib.getenv('GI_TYPELIB_PATH'), ...libraries,
    ...libraries.map(path => `${path}/girepository-1.0`)].filter(Boolean).join(':'), true);
  launcher.setenv('LD_LIBRARY_PATH', [GLib.getenv('LD_LIBRARY_PATH'), ...libraries].filter(Boolean).join(':'), true);
  const test = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('settings-lifecycle.integration.js');
  const child = launcher.spawnv(['gjs', '-m', test.get_path()]);
  let completed = false;
  try {
    await new Promise((resolve, reject) => child.wait_check_async(null, (process, result) => {
      try {
        process.wait_check_finish(result);
        completed = true;
        resolve();
      } catch (error) {
        reject(error);
      }
    }));
  } finally {
    if (!completed)
      child.force_exit();
  }
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.stateObj, 'Clipboard X Gnome extension object is unavailable');
  extension.stateObj.openPreferences();
  await Scripting.sleep(1500);

  const windows = global.get_window_actors()
    .map(actor => actor.meta_window)
    .filter(window => window && !window.is_hidden());
  const preferences = windows.find(window => {
    const title = window.get_title() ?? '';
    const wmClass = window.get_wm_class() ?? '';
    return /Clipboard X Gnome|Extension Manager|Extensions/iu.test(`${title} ${wmClass}`);
  });
  assert(preferences, 'Clipboard X Gnome preferences window did not open');
  assert(preferences.get_title() === 'Clipboard X Gnome',
    `Clipboard X Gnome preferences opened an error page (${preferences.get_title()})`);
  const applications = await new Promise((resolve, reject) => {
    Gio.DBus.session.call(
      'org.gnome.Shell.Extensions.ClipboardXGnome', '/org/gnome/Shell/Extensions/ClipboardXGnome',
      'org.gnome.Shell.Extensions.ClipboardXGnome', 'ListRunningApplications', null,
      null, Gio.DBusCallFlags.NONE, 3000, null,
      (connection, result) => {
        try {
          resolve(connection.call_finish(result).deepUnpack()[0]);
        } catch (error) {
          reject(error);
        }
      },
    );
  });
  assert(Array.isArray(applications) && applications.every(entry =>
    Array.isArray(entry) && entry.length === 2 && entry[1]),
  'Running application bridge returned an invalid window-class list');
  assert(applications.some(([, wmClass]) => wmClass === preferences.get_wm_class()),
    'Running application bridge did not report the open preferences window');
  preferences.delete(global.get_current_time());
  await Scripting.sleep(300);
}
