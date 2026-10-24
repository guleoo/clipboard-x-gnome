import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {restart} from '../helpers/restart.js';

async function fixture(desktop, run) {
  const target = await Target.open(desktop);
  const swatches = new St.BoxLayout({style: 'spacing: 0;'});
  for (const color of ['#ff0000', '#0000ff']) swatches.add_child(new St.Widget({
    width: 80, height: 80, style: `background-color: ${color};`,
  }));
  swatches.set_position(200, 200);
  Main.layoutManager.addTopChrome(swatches);
  try { await run(target); } finally {
    desktop.app._colorPicker?.close();
    Main.layoutManager.removeChrome(swatches);
    swatches.destroy();
    await target.close();
  }
}

async function open(desktop, shortcut = false) {
  if (shortcut) {
    desktop.settings.set_strv('color-picker-shortcut', ['<Control><Shift>F11']);
    await desktop.key(Clutter.KEY_F11, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]);
  } else {
    await desktop.open();
    await desktop.click(desktop.history.colorButton);
  }
  await until(() => desktop.app._colorPicker?._rgb && !desktop.app._colorPicker._sampling, 'actual plugin color overlay ready');
  return desktop.app._colorPicker;
}

export const cases = {
  'COLOR-01': desktop => fixture(desktop, async target => {
    for (const method of ['click', 'enter', 'space', 'escape', 'right-click']) {
      await target.offer(`color sentinel ${method}`);
      const picker = await open(desktop, method === 'space');
      await desktop.move(240, 240);
      await until(() => !picker._sampling && picker._rgb?.join() === '255,0,0', 'actual red stage pixels');
      if (method === 'click') await desktop.pointClick(240, 240);
      else if (method === 'right-click') {
        desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
        await pause(25);
        desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
      } else await desktop.key(method === 'enter' ? Clutter.KEY_Return : method === 'space' ? Clutter.KEY_space : Clutter.KEY_Escape);
      await until(() => !desktop.app._colorPicker, 'confirmation/cancellation releases plugin overlay');
      const text = (await target.clipboard()).text;
      assert(text === (['escape', 'right-click'].includes(method) ? `color sentinel ${method}` : '#FF0000'),
        'Confirmation must copy selected color; cancel must preserve actual clipboard');
      assert(!picker._grab && desktop.app._colorPickerDestroySignal === 0, 'Picker lifecycle must release grab and destroy signal');
    }
  }),

  'COLOR-03': desktop => fixture(desktop, async () => {
    const picker = await open(desktop);
    await desktop.move(279, 240);
    await until(() => !picker._sampling && picker._rgb?.join() === '255,0,0', 'last red pixel before edge');
    const start = [...picker._coords];
    await desktop.key(Clutter.KEY_Right);
    await until(() => !picker._sampling && picker._rgb?.join() === '0,0,255', 'one native pixel crosses to blue');
    assert(Math.abs((picker._coords[0] - start[0]) * picker._scale - 1) < 0.01,
      'Actual display sample must move by one screenshot pixel');
    const beforeControl = picker._coords[0];
    await desktop.key(Clutter.KEY_Left, [Clutter.KEY_Control_L]);
    await until(() => !picker._sampling && picker._coords[0] < beforeControl, 'native Control movement');
    assert(Math.abs((beforeControl - picker._coords[0]) * picker._scale - 8) < 0.01, 'Control moves eight actual pixel cells');
    for (let index = 0; index < 8; index++) await desktop.key(Clutter.KEY_Right);
    await until(() => !picker._sampling && picker._rgb?.join() === '0,0,255', 'rapid repeated native movement retains final pixel');
    await desktop.key(Clutter.KEY_Escape);
  }),

  'COLOR-04': desktop => fixture(desktop, async target => {
    for (const [format, expected] of [['hex', '#FF0000'], ['rgb', 'rgb(255, 0, 0)'],
      ['hsl', 'hsl(0 100% 50%)'], ['oklch', 'oklch(62.80% 0.2577 29.23)']]) {
      desktop.settings.set_string('color-format', format);
      const picker = await open(desktop);
      await desktop.move(240, 240);
      await until(() => !picker._sampling && picker._rgb?.join() === '255,0,0', 'format sample ready');
      await desktop.key(Clutter.KEY_Return);
      await until(() => !desktop.app._colorPicker, 'format confirmation closed');
      assert((await target.clipboard()).text === expected, 'Configured color format must reach clipboard through plugin entry');
    }
  }),

  'COLOR-07': desktop => fixture(desktop, async () => {
    const picker = await open(desktop);
    await restart(desktop);
    assert(picker._closed && !picker._grab && !desktop.app._colorPicker, 'Actual disable must release the old color modal');
    const reopened = await open(desktop, true);
    assert(reopened !== picker && reopened._grab, 'Fresh session must allow a new real picker');
    await desktop.key(Clutter.KEY_Escape);
    await until(() => !desktop.app._colorPicker, 'new picker closes normally');
  }),
};
