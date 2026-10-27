import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {restart} from '../helpers/restart.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';

function actorCounts() {
  const counts = {indicator: 0, menu: 0, tooltip: 0};
  const classes = {indicator: 'cbx-panel-button', menu: 'cbx-menu', tooltip: 'cbx-tooltip'};
  const visit = actor => {
    for (const [name, style] of Object.entries(classes))
      if (actor.has_style_class_name?.(style)) counts[name]++;
    for (const child of actor.get_children()) visit(child);
  };
  visit(Main.uiGroup);
  return counts;
}

function nameHasOwner(name) {
  return new Promise((resolve, reject) => {
    Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
      'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', [name]),
      new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, 1000, null, (connection, result) => {
        try { resolve(connection.call_finish(result).deepUnpack()[0]); }
        catch (error) { reject(error); }
      });
  });
}

async function waitOwner(name, expected) {
  const deadline = GLib.get_monotonic_time() + 5_000_000;
  do {
    if (await nameHasOwner(name) === expected) return;
    await pause(20);
  } while (GLib.get_monotonic_time() < deadline);
  assert(false, `Running-applications D-Bus ownership must become ${expected}`);
}

function sample(cycle, phase) {
  const [, bytes] = Gio.File.new_for_path('/proc/self/status').load_contents(null);
  const rssKB = Number(new TextDecoder().decode(bytes).match(/^VmRSS:\s+(\d+)\s+kB$/mu)?.[1]);
  const descriptors = Gio.File.new_for_path('/proc/self/fd').enumerate_children(
    'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  let openFDs = 0;
  try { while (descriptors.next_file(null)) openFDs++; }
  finally { descriptors.close(null); }
  assert(Number.isFinite(rssKB) && rssKB > 0 && openFDs > 0,
    'Resource observations must come from the actual Shell process');
  print(`[simulation] Bounded resources: cycle=${cycle}; phase=${phase}; rssKB=${rssKB}; openFDs=${openFDs}`);
  return {cycle, phase, rssKB, openFDs};
}

async function shortcutOnce(desktop) {
  await desktop.close();
  const events = [];
  const menu = desktop.indicator.menu;
  const signal = menu.connect('open-state-changed', (_menu, open) => events.push(open));
  try {
    await desktop.shortcut();
    await until(() => menu.isOpen && menu.actor.mapped, 'one native shortcut opens the current popup');
    await desktop.settle();
    await desktop.shortcut();
    await until(() => !menu.isOpen && !menu.actor.visible, 'one native shortcut closes the current popup');
    assert(events.length === 2 && events[0] && !events[1],
      'Each native shortcut must produce one transition, without accumulated handlers');
  } finally { menu.disconnect(signal); }
}

export const cases = {
  async 'OPS-03-bounded'(desktop) {
    const {BUS_NAME} = await import(`${desktop.app.dir.get_uri()}/common/running-apps.js`);
    // One target and one pair of virtual input devices are reused throughout;
    // the fixture itself must not create a new process/device on every cycle.
    const target = await Target.open(desktop);
    const samples = [];
    desktop.settings.set_boolean('sync-enabled', false);
    desktop.settings.set_boolean('preserve-panel-state', false);
    desktop.settings.set_string('panel-escape-action', 'back');
    try {
      for (let cycle = -2; cycle < 10; cycle++) {
        await waitOwner(BUS_NAME, true);
        assert(Object.values(actorCounts()).every(count => count === 1),
          'An active generation must own exactly one indicator, popup and tooltip');
        await shortcutOnce(desktop);
        const item = await capture(desktop, target, 'Bounded lifecycle resource sample');
        await desktop.open();
        const action = desktop.history._itemRows.get(item.id).focusActors
          .find(actor => actor._clipboardXGnomeEntryAction === 'tokenize');
        assert(action, 'The normal captured row must expose its word-selection action');
        await desktop.click(action);
        await until(() => desktop.manager.is('tokenizer') && desktop.words.state?.source === item.text
          && !desktop.words.state.loading && desktop.words.buttons.length > 0,
        'real word selection completes and activates its dictionary monitor');
        await desktop.settle();
        await desktop.key(Clutter.KEY_Escape);
        await until(() => desktop.manager.is('history'), 'native Escape returns to history');
        await desktop.close();
        await desktop.app._controller.persist();
        if (cycle >= 0) samples.push(sample(cycle, 'active'));

        const actors = [desktop.indicator, desktop.indicator.menu.actor, desktop.indicator._tooltip.actor];
        const destroyed = actors.map(() => 0);
        const signals = actors.map((actor, index) => actor.connect('destroy', () => destroyed[index]++));
        try {
          await restart(desktop, async () => {
            assert(destroyed.every(count => count === 1),
              'Disable must destroy each previous indicator, popup and tooltip exactly once');
            assert(Object.values(actorCounts()).every(count => count === 0),
              'No plugin indicator, popup or tooltip may remain in Shell after shutdown completes');
            await waitOwner(BUS_NAME, false);
            if (cycle >= 0) samples.push(sample(cycle, 'disabled'));
          });
        } finally {
          for (let index = 0; index < actors.length; index++)
            if (destroyed[index] === 0) actors[index].disconnect(signals[index]);
        }
      }
      await waitOwner(BUS_NAME, true);
      assert(Object.values(actorCounts()).every(count => count === 1),
        'The final generation must still have one complete set of plugin UI actors');
      await shortcutOnce(desktop);
      assert(samples.length === 20, 'Ten measured cycles must include both active and disabled samples');
      // RSS includes GC/allocator caches; FDs include unrelated Shell services.
      // Preserve their trend rather than inventing a flaky absolute leak budget.
      for (const phase of ['active', 'disabled']) {
        const values = samples.filter(value => value.phase === phase);
        print(`[simulation] Bounded resource trend: phase=${phase}; cycles=${values.length}; rssDeltaKB=${values.at(-1).rssKB - values[0].rssKB}; fdDelta=${values.at(-1).openFDs - values[0].openFDs}; scope=local-lifecycle-not-long-soak-or-network-polling`);
      }
    } finally { await target.close(); }
  },
};
