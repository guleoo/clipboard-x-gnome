import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, until, rect, inside, pause} from './session.js';

export async function firstTarget(s) {
  await s.open();
  assert(s.focus === s.history.searchEntry.clutter_text, 'History must initially focus search');
  await s.openWords();
  assert(s.focus === s.words.focusAnchor, 'Word panel must start on its invisible anchor');
  await s.key(Clutter.KEY_Right);
  assert(s.focus === s.words.buttons[0], 'First direction must reach the first word, not Back');
  await s.click(s.words.backButton);
  await s.click(s.history.phrasesButton);
  await until(() => s.manager.is('phrases'), 'phrases opened');
  await s.settle();
  assert(s.focus === s.phrases.focusAnchor, 'Phrases must start on their invisible anchor');
  await s.key(Clutter.KEY_Right);
  assert(s.focus === s.phrases.buttons[0], 'First direction must reach the first phrase');
  await s.click(s.phrases.backButton);
  await s.phrases.replace([]);
  await s.click(s.history.phrasesButton);
  await until(() => s.manager.is('phrases'), 'empty phrases opened');
  await s.settle();
  await s.key(Clutter.KEY_Right);
  assert(s.focus === s.phrases.addButton, 'Empty phrases must initially navigate to Add');
}

export async function matrix(s) {
  s.settings.set_strv('panel-hidden-actions', ['color-picker']);
  await s.open();
  await s.key(Clutter.KEY_Right);
  assert(s.focus === s.history.screenshotButton, 'Empty search Right must leave search');
  await s.key(Clutter.KEY_Right);
  assert(s.focus === s.history.phrasesButton, 'Navigation must skip hidden tools');
  await s.key(Clutter.KEY_Left);
  await s.key(Clutter.KEY_Left);
  assert(s.focus === s.history.searchEntry.clutter_text, 'Left must return to search');
  for (let index = 0; index < 40; index++) await s.key(Clutter.KEY_Down);
  assert(s.history.footer.contentActors.includes(s.focus), 'Down must reach the history footer');
  for (let index = 0; index < 40; index++) await s.key(Clutter.KEY_Up);
  assert(s.history.focusGrid.location(s.focus)?.row === 0, 'Up must reach the top row');
  await s.key(Clutter.KEY_f, [Clutter.KEY_Control_L]);
  assert(s.focus === s.history.searchEntry.clutter_text, 'Ctrl+F must focus search');
  await s.type('abc');
  await s.key(Clutter.KEY_Left);
  await s.key(Clutter.KEY_Right);
  assert(s.focus === s.history.searchEntry.clutter_text, 'Right inside text must edit the caret');
  await s.key(Clutter.KEY_Right);
  assert(s.focus === s.history.screenshotButton, 'Right at text end must leave search');
  await s.key(Clutter.KEY_f, [Clutter.KEY_Control_L]);
  await s.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
  await s.key(Clutter.KEY_BackSpace);
  await until(() => s.history._itemRows.size === 35, 'search cleared');
  await s.openWords();
  await s.key(Clutter.KEY_Right);
  await s.key(Clutter.KEY_space);
  const rows = s.words.focusGrid._rows;
  assert(new Set(rows.slice(1, -1).map(row => row.length)).size > 1, 'Fixture must contain unequal word rows');
  for (let index = 0; index < rows.length + 2; index++) await s.key(Clutter.KEY_Down);
  assert(s.focus === s.words.copyButton, 'Down must reach enabled Copy');
  for (let index = 0; index < rows.length + 2; index++) await s.key(Clutter.KEY_Up);
  assert(s.focus === s.words.backButton, 'Up must reach Back');
}

export async function boundaries(s) {
  for (const name of ['history', 'tokenizer', 'phrases']) {
    await s.close();
    s.manager.reset();
    s.settings.set_boolean('panel-confine-focus', true);
    await s.open();
    if (name === 'tokenizer') { await s.openWords(); await s.key(Clutter.KEY_Right); }
    if (name === 'phrases') {
      await s.click(s.history.phrasesButton);
      await until(() => s.manager.is('phrases'), 'phrases opened');
      await s.settle();
      await s.key(Clutter.KEY_Right);
    }
    const grid = s.manager.focusGrid;
    const rows = grid._rows;
    for (const [symbol, count] of [[Clutter.KEY_Down, rows.length + 2],
      [Clutter.KEY_Right, Math.max(...rows.map(row => row.length)) + 2],
      [Clutter.KEY_Up, rows.length + 2]]) {
      for (let index = 0; index < count; index++) await s.key(symbol);
      assert(grid.contains(s.focus), `${name}: confined navigation escaped the panel`);
    }
    for (let index = 0; index < 10; index++) await s.key(Clutter.KEY_Right);
    const observed = [];
    const original = s.indicator._handleMenuKey;
    // Observe the return value of real dispatched keys, never call the handler directly.
    s.indicator._handleMenuKey = function (event) {
      const result = original.call(this, event);
      if (event.get_key_symbol() === Clutter.KEY_Right) observed.push(result);
      return result;
    };
    try {
      await s.key(Clutter.KEY_Right);
      assert(observed.includes(Clutter.EVENT_STOP), `${name}: confined edge must consume the key`);
      observed.length = 0;
      s.settings.set_boolean('panel-confine-focus', false);
      await s.key(Clutter.KEY_Right);
      assert(observed.includes(Clutter.EVENT_PROPAGATE), `${name}: unconfined edge must delegate to GNOME`);
    } finally { s.indicator._handleMenuKey = original; }
  }
  await s.close();
  const date = Main.panel.statusArea.dateMenu;
  const box = rect(date);
  await s.move(box.x + box.width / 2, box.y + box.height / 2);
  if (!date.menu.isOpen) await s.click(date);
  await until(() => date.menu.isOpen, 'native date menu opened');
  try {
    await s.key(Clutter.KEY_f, [Clutter.KEY_Control_L]);
    assert(!s.indicator.menu.isOpen && !inside(s.focus, s.indicator.menu.actor), 'Local shortcut stole another menu input');
  } finally { date.menu.close(); }
}

export async function scrolling(s) {
  s.settings.set_int('panel-height', 220);
  await s.open();
  for (let index = 0; index < 22; index++) await s.key(Clutter.KEY_Down);
  await s.settle();
  const adjustment = s.history.scroll.get_vadjustment();
  const target = rect(s.focus);
  const viewport = rect(s.history.scroll);
  assert(adjustment.value > 0 && target.y >= viewport.y - 2
    && target.y + target.height <= viewport.y + viewport.height + 2, 'Keyboard target must scroll into view');
  await s.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await s.settle();
  const before = adjustment.value;
  let injected = false;
  let pending = false;
  let cancelledPending = false;
  let wheelSeen = false;
  const original = s.history._cancelFocus;
  s.history._cancelFocus = function (...args) {
    cancelledPending ||= Boolean(this._focusIdleId);
    return original.apply(this, args);
  };
  const wheelSignal = s.history.scroll.connect('scroll-event', () => {
    wheelSeen = true;
    return Clutter.EVENT_PROPAGATE;
  });
  const filter = Clutter.Event.add_filter(null, event => {
    if (event.type() === Clutter.EventType.SCROLL && !injected) {
      injected = true;
      s.app._controller.update(s.app._controller.items[0]);
      pending = Boolean(s.history._focusIdleId);
    }
    return Clutter.EVENT_PROPAGATE;
  });
  try {
    s.pointer.notify_discrete_scroll(GLib.get_monotonic_time(), Clutter.ScrollDirection.UP, Clutter.ScrollSource.WHEEL);
    await until(() => wheelSeen && !s.history._focusIdleId && adjustment.value < before, 'real wheel wins pending restore');
    await s.settle();
    const after = adjustment.value;
    await pause(250); // Observation window: catch a late restore after scrolling completed.
    assert(injected && pending && cancelledPending, 'Pending restoration/real wheel overlap was not exercised');
    assert(Math.abs(after - adjustment.value) < 1, 'Late restoration undid wheel scrolling');
  } finally {
    Clutter.Event.remove_filter(filter);
    s.history.scroll.disconnect(wheelSignal);
    s.history._cancelFocus = original;
  }
}
