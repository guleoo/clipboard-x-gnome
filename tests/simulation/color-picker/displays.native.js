import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {open} from './native.js';

async function display(method, parameters = null) {
  return new Promise((resolve, reject) => Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig',
    '/org/gnome/Mutter/DisplayConfig', 'org.gnome.Mutter.DisplayConfig', method, parameters, null,
    Gio.DBusCallFlags.NONE, 10000, null, (bus, result) => {
      try { resolve(bus.call_finish(result).deepUnpack()); } catch (error) { reject(error); }
    }));
}

export const cases = {
  async 'COLOR-05-displays'(desktop) {
    const profile = GLib.getenv('CBX_SIMULATION_DISPLAY');
    let state = await display('GetCurrentState');
    if (profile === 'fractional') {
      assert(state[2].length === 1, 'Fractional profile starts with one real monitor');
      const monitor = state[1][0];
      const mode = monitor[1].find(value => value[6]['is-current']?.deepUnpack());
      assert(mode[5].includes(1.25), 'The backend must actually advertise 125% display scaling');
      const logical = state[2][0];
      await display('ApplyMonitorsConfig', new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
        state[0], 1, [[logical[0], logical[1], 1.25, logical[3], logical[4], [[monitor[0][0], mode[0], {}]]]], {},
      ]));
      await until(() => Math.abs(Main.layoutManager.monitors[0].width - mode[1] / 1.25) <= 1,
        'actual fractional monitor geometry applied');
      state = await display('GetCurrentState');
      assert(state[2][0][2] === 1.25, 'DisplayConfig must confirm real scale, not font scaling');
    } else assert(profile === 'dual' && Main.layoutManager.monitors.length === 2, 'Dual profile needs two real virtual monitors');
    const target = await Target.open(desktop);
    const actors = [];
    const colors = ['#ff0000', '#0000ff'];
    try {
      for (const [index, monitor] of Main.layoutManager.monitors.entries()) {
        const actor = new St.Widget({x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
          reactive: false, style: `background-color: ${colors[index]};`});
        Main.layoutManager.addTopChrome(actor);
        actors.push(actor);
      }
      await desktop.settle();
      for (const [index, monitor] of Main.layoutManager.monitors.entries()) {
        const picker = await open(desktop, true);
        await desktop.move(monitor.x + monitor.width / 2, monitor.y + monitor.height / 2);
        const expected = index === 0 ? '255,0,0' : '0,0,255';
        await until(() => !picker._sampling && picker._rgb?.join() === expected, 'correct actual monitor screenshot pixels');
        const before = picker._coords[0];
        await desktop.key(Clutter.KEY_Right);
        await until(() => !picker._sampling && picker._coords[0] > before, 'native one-pixel movement delivered');
        assert(Math.abs((picker._coords[0] - before) * picker._scale - 1) < 0.01,
          'A native arrow must move exactly one physical screenshot pixel at the actual display scale');
        await desktop.key(Clutter.KEY_Return);
        await until(() => !desktop.app._colorPicker, 'display sample confirmed');
        assert((await target.clipboard()).text === colors[index].toUpperCase(), 'Each display sample must reach the actual clipboard');
      }
      print(`[simulation] Color display profile=${profile}; monitors=${state[2].length}; actualScales=${state[2].map(value => value[2]).join(',')}`);
    } finally {
      desktop.app._colorPicker?.close();
      for (const actor of actors) { Main.layoutManager.removeChrome(actor); actor.destroy(); }
      await target.close();
    }
  },
};
