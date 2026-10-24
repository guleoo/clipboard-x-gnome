import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

const UUID = 'clipboard-x-gnome@guleoo.github.io';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.enabled, 'Clipboard X Gnome was not enabled');
  const indicator = Main.panel.statusArea['clipboard-x-gnome'];
  assert(indicator, 'Clipboard X Gnome indicator was not added');
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
  const originalTarget = app._settings.get_string('screenshot-target');
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

    // Exercise the real GNOME portal: its backend maps closing ScreenshotUI
    // to response 2, unlike the specification's cancellation response 1.
    app._portal = portal;
    app._settings.set_string('screenshot-target', 'interactive');
    notifications.length = 0;
    const seat = global.stage.context.get_backend().get_default_seat();
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    Main.overview.hide();
    for (const method of ['escape', 'close-button']) {
      const capture = app._takeScreenshot().catch(error => notifications.push(error));
      for (let i = 0; !Main.screenshotUI.visible && i < 100; i++)
        await Scripting.sleep(50);
      assert(Main.screenshotUI.visible, 'The real screenshot UI did not open');
      await Scripting.sleep(200);
      if (method === 'escape') {
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
      } else {
        const button = Main.screenshotUI._closeButton;
        const [x, y] = button.get_transformed_position();
        const [width, height] = button.get_transformed_size();
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
        await Scripting.sleep(50);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
        await Scripting.sleep(50);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
      }
      await capture;
      assert(notifications.length === 0, `Real ${method} cancellation displayed an error`);
      assert(sideEffects === 0, `Real ${method} cancellation used an image`);
      assert(portal._request === null, 'Cancellation retained the Portal request');
      assert(!Main.screenshotUI.get_action('clipboard-x-gnome-screenshot-cancel'),
        'Cancellation retained its keyboard controller');
    }
    const saveScreenshot = Main.screenshotUI._saveScreenshot;
    try {
      // A capture that produces no file also closes the UI with response 2.
      // It must not be mistaken for dismissing the UI.
      Main.screenshotUI._saveScreenshot = async () => {};
      const capture = app._takeScreenshot().catch(error => notifications.push(error));
      for (let i = 0; !Main.screenshotUI.visible && i < 100; i++)
        await Scripting.sleep(50);
      assert(Main.screenshotUI.visible, 'The screenshot failure fixture did not open');
      await Scripting.sleep(200);
      keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Return, Clutter.KeyState.PRESSED);
      keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Return, Clutter.KeyState.RELEASED);
      await capture;
      assert(notifications.length === 1, 'A real Portal capture failure was swallowed as cancellation');
      assert(!Main.screenshotUI.get_action('clipboard-x-gnome-screenshot-cancel'),
        'Failure retained its keyboard controller');
    } finally {
      Main.screenshotUI._saveScreenshot = saveScreenshot;
    }
  } finally {
    app._portal = portal;
    app._reportError = reportError;
    app._launchEditor = launchEditor;
    controllerMethods.forEach((name, i) => { app._controller[name] = originalMethods[i]; });
    keys.forEach((key, i) => app._settings.set_boolean(key, originalSettings[i]));
    app._settings.set_string('screenshot-target', originalTarget);
  }
}
