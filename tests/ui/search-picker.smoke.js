import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

const UUID = 'clipboard-x-gnome@guleoo.github.io';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (predicate())
      return;
    await Scripting.sleep(50);
  }
  throw new Error('Timed out waiting for Shell state');
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.enabled, 'Clipboard X Gnome was not enabled');
  await waitUntil(() => Boolean(Main.panel.statusArea['clipboard-x-gnome']));
  const indicator = Main.panel.statusArea['clipboard-x-gnome'];
  const history = indicator._historyPanel;
  const entry = history.searchEntry;
  const text = entry.clutter_text;
  const keyboard = global.stage.context.get_backend().get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const press = async (key, modifier = null) => {
    if (modifier)
      keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
    if (modifier)
      keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.RELEASED);
    await Scripting.sleep(100);
  };
  const prepare = async (value, cursor, bound = cursor) => {
    entry.set_text(value);
    await Scripting.sleep(150);
    history.focusSearch({immediate: true});
    text.set_selection(cursor, bound);
  };
  const inSearch = () => global.stage.get_key_focus() === text;

  Main.overview.hide();
  indicator.menu.open();
  await Scripting.sleep(200);
  try {
    await prepare('', -1);
    await press(Clutter.KEY_Left);
    assert(inSearch(), 'Empty search Left must remain in the search field');
    await press(Clutter.KEY_Right);
    assert(global.stage.get_key_focus() === history.toolbar.get_children()[0],
      'Empty search Right must focus the first toolbar action');
    await press(Clutter.KEY_Left);
    assert(inSearch(), 'Toolbar Left must return to search');

    await prepare('ab中😀', 2);
    assert(!entry.atEnd, 'Middle of Unicode text must not be considered the end');
    await press(Clutter.KEY_Right);
    assert(inSearch() && text.get_cursor_position() === 3,
      'Right inside search text must move the caret without moving focus');
    await press(Clutter.KEY_Left);
    assert(inSearch() && text.get_cursor_position() === 2,
      'Left inside search must preserve normal text editing');
    await prepare('ab中😀', 4);
    assert(entry.atEnd, 'Character offsets must handle supplementary Unicode characters');
    await press(Clutter.KEY_Right);
    assert(global.stage.get_key_focus() === history.toolbar.get_children()[0],
      'Right at the text end must leave search');

    await prepare('ab中😀', -1);
    assert(entry.atEnd, 'Clutter -1 cursor position must mean the text end');
    await press(Clutter.KEY_Right, Clutter.KEY_Shift_L);
    assert(inSearch(), 'Shift+Right must not leave search');
    await press(Clutter.KEY_Right, Clutter.KEY_Control_L);
    assert(inSearch(), 'Ctrl+Right must not leave search');
    await prepare('ab中😀', -1, 0);
    assert(!entry.atEnd, 'A selection ending at the text end must retain editing behavior');
    await press(Clutter.KEY_Right);
    assert(inSearch(), 'Right with a selection must collapse it without moving focus');
    await prepare('ab中😀', -1);
    await press(Clutter.KEY_KP_Right);
    assert(global.stage.get_key_focus() === history.toolbar.get_children()[0],
      'Keypad Right at the text end must leave search');
  } finally {
    indicator.menu.close();
    entry.set_text('');
  }

  const extensionObject = indicator._actions.extensionObject;
  extensionObject._pickColor();
  await waitUntil(() => extensionObject._colorPicker?._rgb?.length === 3);
  const picker = extensionObject._colorPicker;
  const key = (symbol, state = 0) => picker.vfunc_key_press_event({
    get_key_symbol: () => symbol,
    get_state: () => state,
  });
  try {
    // Exercise the real capture pipeline at both integral and fractional scales.
    for (const scale of [1, 1.25, 1.5, 2]) {
      picker._scale = scale;
      await picker._sample(40, 40);
      await waitUntil(() => !picker._sampling);
      const pixelX = Math.round(picker._coords[0] * scale);
      for (let i = 0; i < 5; i++)
        key(Clutter.KEY_Right);
      await waitUntil(() => !picker._sampling);
      assert(Math.round(picker._coords[0] * scale) === pixelX + 5,
        `Five rapid arrows must advance five sampled cells at scale ${scale}`);
      key(Clutter.KEY_Left, Clutter.ModifierType.CONTROL_MASK);
      await waitUntil(() => !picker._sampling);
      assert(Math.round(picker._coords[0] * scale) === pixelX - 3,
        `Ctrl+Left must advance eight sampled cells at scale ${scale}`);
    }
  } finally {
    picker.close();
  }
}
