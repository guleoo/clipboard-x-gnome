import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Session, assert, until, rect} from './cases/session.js';
export {init} from './cases/session.js';

async function config(method, parameters = null) {
  return new Promise((resolve, reject) => Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig',
    '/org/gnome/Mutter/DisplayConfig', 'org.gnome.Mutter.DisplayConfig', method, parameters, null,
    Gio.DBusCallFlags.NONE, 10000, null, (bus, result) => {
      try { resolve(bus.call_finish(result).deepUnpack()); } catch (error) { reject(error); }
    }));
}

export async function run() {
  const profile = GLib.getenv('CBX_PANEL_TEST_DISPLAY');
  assert(['dual', 'fractional'].includes(profile), 'Select an explicit display profile');
  const session = await Session.create();
  try {
    await session.reset();
    session.settings.set_boolean('show-indicator', false);
    let state = await config('GetCurrentState');
    if (profile === 'dual') {
      assert(state[2].length === 2 && Main.layoutManager.monitors.length === 2,
        'Dual profile requires two real virtual monitors');
    } else {
      assert(state[2].length === 1, 'Fractional profile requires one monitor');
      const monitor = state[1][0];
      const current = monitor[1].find(mode => mode[6]['is-current']?.deepUnpack());
      assert(current?.[5].includes(1.25), 'Current monitor mode does not advertise 125% scaling; profile cannot pass');
      const logical = state[2][0];
      await config('ApplyMonitorsConfig', new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
        state[0], 1, [[logical[0], logical[1], 1.25, logical[3], logical[4], [[monitor[0][0], current[0], {}]]]], {},
      ]));
      await until(() => Main.layoutManager.monitors.length === 1
        && Math.abs(Main.layoutManager.monitors[0].width - current[1] / 1.25) <= 1, 'fractional monitor geometry applied');
      state = await config('GetCurrentState');
      assert(state[2][0][2] === 1.25, 'DisplayConfig must confirm actual 125% scaling');
    }
    for (const monitor of Main.layoutManager.monitors) {
      await session.move(monitor.x + monitor.width / 2, monitor.y + monitor.height / 2);
      for (const anchor of ['top-left', 'center', 'bottom-right']) {
        session.settings.set_string('panel-anchor', anchor);
        await session.open();
        assert(Main.layoutManager.currentMonitor.index === monitor.index, 'Pointer must select the actual target monitor');
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const box = rect(session.indicator.menu.actor);
        assert(box.x >= area.x - 2 && box.y >= area.y - 2
          && box.x + box.width <= area.x + area.width + 2 && box.y + box.height <= area.y + area.height + 2,
        `${profile}/${monitor.index}/${anchor}: popup outside target workarea`);
        await session.close();
      }
    }
    print(`[panels] PASS PANEL-02 ${profile}: monitors=${state[2].length}; scales=${state[2].map(logical => logical[2]).join(',')}`);
    print(`[panels] COMPLETE ${profile}: 1 case`);
  } finally {
    await session.destroy();
  }
}
