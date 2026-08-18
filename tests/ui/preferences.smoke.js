import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x@guleo.github.io';

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
  assert(extension?.stateObj, 'Clipboard X extension object is unavailable');
  extension.stateObj.openPreferences();
  await Scripting.sleep(1500);

  const windows = global.get_window_actors()
    .map(actor => actor.meta_window)
    .filter(window => window && !window.is_hidden());
  const preferences = windows.find(window => {
    const title = window.get_title() ?? '';
    const wmClass = window.get_wm_class() ?? '';
    return /Clipboard X|Extension Manager|Extensions/iu.test(`${title} ${wmClass}`);
  });
  assert(preferences, 'Clipboard X preferences window did not open');
  assert(preferences.get_title() === 'Clipboard X',
    `Clipboard X preferences opened an error page (${preferences.get_title()})`);
  preferences.delete(global.get_current_time());
  await Scripting.sleep(300);
}
