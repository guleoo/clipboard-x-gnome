import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Gio from 'gi://Gio';

const UUID = 'clipboard-x@guleoo.github.io';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
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
      'org.gnome.Shell.Extensions.ClipboardX', '/org/gnome/Shell/Extensions/ClipboardX',
      'org.gnome.Shell.Extensions.ClipboardX', 'ListRunningApplications', null,
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
