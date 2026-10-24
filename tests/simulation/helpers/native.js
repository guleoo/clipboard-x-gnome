import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function until(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate())
      return;
    await Scripting.sleep(30);
  }
  throw new Error(message);
}

export async function runNative(check) {
  await until(() => Main.panel.statusArea['clipboard-x-gnome'], 'Extension did not start');
  await Main.extensionManager.lookup('clipboard-x-gnome@guleoo.github.io').stateObj._startup;
  const indicator = Main.panel.statusArea['clipboard-x-gnome'];
  const settings = indicator._settings;
  const phrases = indicator._quickPhrases;
  await phrases.ready;
  const originalPhrases = [...phrases.phrases];
  const originalEscape = settings.get_string('panel-escape-action');
  const originalColor = settings.get_string('foreground-color');
  const desktopSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
  const originalScheme = desktopSettings.get_string('color-scheme');
  const seat = global.stage.context.get_backend().get_default_seat();
  const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const key = async symbol => {
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
    await Scripting.sleep(80);
  };
  const click = async actor => {
    await until(() => actor.mapped && actor.width > 0, 'Button was not laid out');
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
    await Scripting.sleep(80);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(80);
  };
  const openPhrases = async () => {
    indicator.menu.open();
    indicator._openPhrases();
    await Scripting.sleep(100);
  };
  // Prime the device before hiding Overview, outside the hot-corner barrier.
  for (let attempt = 0; attempt < 2; attempt++) {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 640, 360);
    await Scripting.sleep(100);
  }
  Main.overview.hide();
  await until(() => !Main.overview.visible && !Main.overview.animationInProgress, 'Overview did not close');
  try {
    await check({indicator, settings, phrases, key, click, openPhrases, desktopSettings, originalEscape});
  } finally {
    await phrases.replace(originalPhrases);
    settings.set_string('panel-escape-action', originalEscape);
    settings.set_string('foreground-color', originalColor);
    desktopSettings.set_string('color-scheme', originalScheme);
    indicator.menu.close();
  }
}
