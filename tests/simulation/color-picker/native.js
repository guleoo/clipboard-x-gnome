import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';

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
};
