import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';

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
  const extensionObject = extension.stateObj;
  extensionObject._pickColor();
  await waitUntil(() => extensionObject._colorPicker?._rgb?.length === 3);
  const picker = extensionObject._colorPicker;
  const key = (symbol, state = 0) => picker.vfunc_key_press_event({
    get_key_symbol: () => symbol,
    get_state: () => state,
  });
  try {
    // Real capture, but injected picker scales and direct handler calls, not a
    // physical or DisplayConfig scaling/keyboard integration test.
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
