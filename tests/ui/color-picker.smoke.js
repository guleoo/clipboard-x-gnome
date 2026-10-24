import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x-gnome@guleoo.github.io';
export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function waitUntil(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate())
      return;
    await Scripting.sleep(30);
  }
  throw new Error(`Timed out: ${description}`);
}

export async function run() {
  await waitUntil(() => Main.panel.statusArea['clipboard-x-gnome'], 'extension startup');
  const extension = Main.extensionManager.lookup(UUID).stateObj;
  await extension._startup;
  const {ColorPicker} = await import(`${extension.dir.get_uri()}/color-picker/picker.js`);
  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const move = async (x, y) => {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    await Scripting.sleep(60);
  };
  const key = async symbol => {
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
    await Scripting.sleep(60);
  };
  const click = async () => {
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(60);
  };
  const swatches = new St.BoxLayout({style: 'spacing: 0;'});
  let underlyingClicks = 0;
  for (const color of ['#ff0000', '#0000ff']) {
    const swatch = new St.Widget({
      width: 80, height: 80, reactive: true, style: `background-color: ${color};`,
    });
    swatch.connect('button-press-event', () => {
      underlyingClicks++;
      return Clutter.EVENT_STOP;
    });
    swatches.add_child(swatch);
  }
  swatches.set_position(200, 200);
  Main.layoutManager.addTopChrome(swatches);
  Main.overview.hide();
  Main.panel.statusArea['clipboard-x-gnome'].menu.close();
  await Scripting.sleep(150);
  let picker = null;
  const screenshot = Shell.Screenshot.prototype.screenshot_stage_to_content;
  try {
    for (const mode of ['enter', 'space', 'click']) {
      await move(279, 240);
      const selected = [];
      picker = new ColorPicker(rgb => selected.push([...rgb]));
      await waitUntil(() => picker._rgb && !picker._sampling, `${mode}: first sample`);
      await picker._sample(280 - 1 / picker._scale, 240);
      assert(JSON.stringify(picker._rgb) === '[255,0,0]',
        `${mode}: picker captured its own overlay or preview: ${picker._rgb}`);
      if (mode === 'click') {
        await move(320, 240);
        await click();
      } else {
        await key(Clutter.KEY_Right);
        await waitUntil(() => !picker._sampling, `${mode}: blue sample`);
        assert(JSON.stringify(picker._rgb) === '[0,0,255]', `${mode}: one-pixel movement must be blue`);
        await key(mode === 'enter' ? Clutter.KEY_Return : Clutter.KEY_space);
      }
      await waitUntil(() => picker._closed, `${mode}: confirmation`);
      assert(selected.length === 1 && JSON.stringify(selected[0]) === '[0,0,255]',
        `${mode}: must submit exact blue once, got ${JSON.stringify(selected)}`);
      assert(!picker._grab, `${mode}: modal grab was not released`);
      print(`Color picker ${mode}: exact red and blue passed`);
      picker = null;
    }

    // Delay completion of a real screenshot, then deliver real input while
    // initialization is pending. Cancellation must not resurrect the actor.
    for (const mode of ['escape', 'destroy']) {
      let release;
      let captureFinished = false;
      let initializationFinished = false;
      const gate = new Promise(resolve => { release = resolve; });
      Shell.Screenshot.prototype.screenshot_stage_to_content = async function (...args) {
        const result = await screenshot.apply(this, args);
        captureFinished = true;
        await gate;
        initializationFinished = true;
        return result;
      };
      const selected = [];
      let destroyed = 0;
      await move(240, 240);
      picker = new ColorPicker(rgb => selected.push([...rgb]));
      picker.connect('destroy', () => { destroyed++; });
      try {
        await waitUntil(() => captureFinished, `${mode}: real screenshot capture`);
        assert(picker._grab && global.stage.get_key_focus() === picker,
          `${mode}: initialization must retain modal keyboard focus`);
        await click();
        assert(!picker._closed && underlyingClicks === 0,
          `${mode}: clicks during initialization must not reach the desktop`);
        if (mode === 'escape')
          await key(Clutter.KEY_Escape);
        else
          picker.destroy();
        assert(picker._closed && !picker._grab, `${mode}: initialization cancellation did not release grab`);
      } finally {
        release();
        await waitUntil(() => initializationFinished, `${mode}: screenshot completion`);
        await Scripting.sleep(60);
        picker.close();
      }
      assert(selected.length === 0 && destroyed === 1 && !picker._texture,
        `${mode}: late screenshot completion revived or submitted the picker`);
      print(`Color picker ${mode}: pending initialization cancellation passed`);
      picker = null;
      Shell.Screenshot.prototype.screenshot_stage_to_content = screenshot;
    }
  } finally {
    Shell.Screenshot.prototype.screenshot_stage_to_content = screenshot;
    picker?.close();
    Main.layoutManager.removeChrome(swatches);
    swatches.destroy();
  }
}
