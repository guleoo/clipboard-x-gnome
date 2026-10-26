import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, rect, until} from '../helpers/desktop.js';
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

export async function open(desktop, shortcut = false) {
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
  async 'COLOR-05-edges'(desktop) {
    const target = await Target.open(desktop);
    const backdrop = new St.Widget({width: global.stage.width, height: global.stage.height,
      style: 'background-color: #00ff00;', reactive: false});
    Main.layoutManager.addTopChrome(backdrop);
    try {
      await desktop.settle();
      const picker = await open(desktop, true);
      for (const end of [false, true]) {
        await desktop.move(end ? global.stage.width - 2 : 1, end ? global.stage.height - 2 : 1);
        await desktop.key(end ? Clutter.KEY_Right : Clutter.KEY_Left, [Clutter.KEY_Control_L]);
        await desktop.key(end ? Clutter.KEY_Down : Clutter.KEY_Up, [Clutter.KEY_Control_L]);
        const expected = end ? [(picker._texture.get_width() - 1) / picker._scale,
          (picker._texture.get_height() - 1) / picker._scale] : [0, 0];
        await until(() => !picker._sampling && picker._coords.every((value, index) => Math.abs(value - expected[index]) < 0.01),
          'native arrow sampling clamps at the actual screenshot edge');
        assert(picker._rgb?.join() === '0,255,0', 'Clipped lens must still sample the exact background pixel');
        const sample = picker._lens._sample;
        assert(sample && sample.centerX >= 0 && sample.centerX < sample.width
          && sample.centerY >= 0 && sample.centerY < sample.height,
        'Edge clipping must retain a valid center pixel within the smaller real sample');
        await desktop.settle();
        const box = rect(picker._preview);
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= global.stage.width + 1
          && box.y + box.height <= global.stage.height + 1, 'Lens preview must remain inside the actual stage at both corners');
      }
      await desktop.key(Clutter.KEY_Return);
      await until(() => !desktop.app._colorPicker, 'edge sample confirmed and released');
      assert((await target.clipboard()).text === '#00FF00', 'Real edge sampling must reach the clipboard');
    } finally {
      desktop.app._colorPicker?.close();
      Main.layoutManager.removeChrome(backdrop);
      backdrop.destroy();
      await target.close();
    }
  },

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
    // Default HEX is already exercised by COLOR-01. One non-default format
    // proves the live setting-to-clipboard path; format math belongs to logic.
    desktop.settings.set_string('color-format', 'oklch');
    const picker = await open(desktop);
    await desktop.move(240, 240);
    await until(() => !picker._sampling && picker._rgb?.join() === '255,0,0', 'format sample ready');
    await desktop.key(Clutter.KEY_Return);
    await until(() => !desktop.app._colorPicker, 'format confirmation closed');
    assert((await target.clipboard()).text === 'oklch(62.80% 0.2577 29.23)',
      'Configured non-default color format must reach clipboard through plugin entry');
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
