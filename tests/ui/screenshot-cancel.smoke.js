import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x@guleoo.github.io';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.enabled, 'Clipboard X was not enabled');
  const indicator = Main.panel.statusArea['clipboard-x'];
  assert(indicator, 'Clipboard X indicator was not added');
  const app = extension.stateObj;
  for (let attempt = 0; app._controller.loading && attempt < 60; attempt++)
    await Scripting.sleep(50);
  assert(!app._controller.loading, 'Clipboard history did not finish loading');
  const portal = app._portal;
  const reportError = app._reportError;
  const launchEditor = app._launchEditor;
  const controllerMethods = ['addFromUri', 'createFromUri', 'writeScreenshot'];
  const originalMethods = controllerMethods.map(name => app._controller[name]);
  const keys = ['screenshot-add-history', 'screenshot-write-clipboard', 'screenshot-open-editor'];
  const originalSettings = keys.map(key => app._settings.get_boolean(key));
  const notifications = [];
  let sideEffects = 0;
  try {
    app._portal = {capture: async () => null};
    app._reportError = error => notifications.push(error);
    for (const name of controllerMethods) {
      app._controller[name] = async () => {
        sideEffects++;
        throw new Error('Cancelled screenshot attempted to use an image');
      };
    }
    app._launchEditor = async () => sideEffects++;
    for (const key of keys)
      app._settings.set_boolean(key, true);
    // The toolbar action and global shortcut both use this same screenshot path.
    await indicator._actions.screenshot().catch(error => app._reportError(error));
    app._settings.set_boolean('screenshot-add-history', false);
    await app._takeScreenshot().catch(error => app._reportError(error));
    assert(notifications.length === 0, 'Cancelled screenshot displayed an error notification');
    assert(sideEffects === 0, 'Cancelled screenshot changed clipboard/history or launched an editor');

    const failure = new Error('Screenshot request timed out');
    app._portal = {capture: async () => { throw failure; }};
    await indicator._actions.screenshot().catch(error => app._reportError(error));
    assert(notifications.length === 1 && notifications[0] === failure,
      'Real screenshot failures must still be reported');
  } finally {
    app._portal = portal;
    app._reportError = reportError;
    app._launchEditor = launchEditor;
    controllerMethods.forEach((name, i) => { app._controller[name] = originalMethods[i]; });
    keys.forEach((key, i) => app._settings.set_boolean(key, originalSettings[i]));
  }
}
