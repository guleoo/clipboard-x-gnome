import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getIBusManager} from 'resource:///org/gnome/shell/misc/ibusManager.js';
import {assert, pause, until} from '../helpers/desktop.js';

// These cases measure typing in an initialized session, not first-use startup.
// Use independent, normally paced keys as a receiver control. Never warm up by
// retrying the plugin's typing operation or changing its configured intervals.
export async function prepare(window, readText) {
  const ibus = getIBusManager();
  await until(() => ibus.getEngineDesc('xkb:us::eng'), 'typing setup: IBus engines ready', 15000);
  await ibus.setEngine('xkb:us::eng');
  await until(() => global.display.focus_window === window && Main.inputMethod.currentFocus,
    'typing setup: target text-input connection ready', 15000);

  const seat = global.stage.context.get_backend().get_default_seat();
  const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const notify = (key, state) => keyboard.notify_keyval(GLib.get_monotonic_time(), key, state);
  const key = async (symbol, modifiers = []) => {
    for (const modifier of modifiers) notify(modifier, Clutter.KeyState.PRESSED);
    if (modifiers.length) await pause(25);
    notify(symbol, Clutter.KeyState.PRESSED);
    await pause(25);
    notify(symbol, Clutter.KeyState.RELEASED);
    if (modifiers.length) await pause(25);
    for (const modifier of [...modifiers].reverse()) notify(modifier, Clutter.KeyState.RELEASED);
    await pause(25);
  };
  const clear = async () => {
    await key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
    await key(Clutter.KEY_BackSpace);
    await until(() => readText() === '' && !Main.inputMethod.hasPreedit(), 'typing setup: receiver cleared');
  };
  try {
    await key(Clutter.KEY_Escape);
    await clear();
    await key(Clutter.KEY_u, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]);
    for (const digit of '670d') await key(Clutter.unicode_to_keysym(digit.codePointAt(0)));
    await key(Clutter.KEY_Return);
    await until(() => readText() === '服' && !Main.inputMethod.hasPreedit(),
      'typing setup: independent Unicode receiver control');
    await pause(100);
    assert(readText() === '服', 'Typing setup: receiver control must not append delayed text');
    await clear();
    print('[simulation] Typing setup ready: independent Unicode control passed; receiver cleared');
  } finally {
    keyboard.run_dispose();
  }
}
