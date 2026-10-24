import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {assert, pause, rect, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';
import {run as drag} from './drag.smoke.js';
import {clippedWordSelection} from './viewport.smoke.js';

async function request(desktop, item) {
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors
    .find(actor => actor._clipboardXGnomeEntryAction === 'tokenize'));
}

async function openWords(desktop, target, text) {
  const item = await capture(desktop, target, text);
  await request(desktop, item);
  await until(() => desktop.manager.is('tokenizer') && desktop.words.state?.source === text, 'native word panel opens');
  await desktop.settle();
  return desktop.words.state;
}

function selection(panel) {
  return [...panel.state.selected].sort((left, right) => left - right).join(',');
}

async function firstWord(desktop) {
  await desktop.key(Clutter.KEY_Right);
  assert(desktop.focus === desktop.words.buttons[0], 'First arrow must focus the first word');
}

export const cases = {
  'SELECT-01': () => drag(), // Owns single-click and held/backtracking ranges; no copied scenarios.
  'SELECT-03': desktop => clippedWordSelection(desktop.indicator),

  async 'WORD-05'(desktop) {
    const target = await Target.open(desktop);
    try {
      for (const key of [Clutter.KEY_c, Clutter.KEY_v, Clutter.KEY_apostrophe]) {
        await target.focus();
        await target.call('clear');
        await openWords(desktop, target, 'alpha beta gamma delta');
        assert(!desktop.words.copyButton.reactive, 'Empty selection must disable footer Copy');
        await desktop.click(desktop.words.buttons[0]);
        await until(() => !desktop.words._selectionDrag && selection(desktop.words) === '0', 'first native word click completed');
        await desktop.click(desktop.words.buttons[2]);
        await until(() => !desktop.words._selectionDrag && selection(desktop.words) === '0,2',
          `second nonadjacent word click completed (selected=${selection(desktop.words)})`);
        assert(desktop.words.resultLabel.text === 'alpha gamma', 'Nonadjacent words must retain source order');
        await desktop.key(key);
        if (key === Clutter.KEY_c)
          assert((await target.clipboard()).text === 'alpha gamma', 'Word Copy must reach actual clipboard');
        else
          await until(() => target.state.text === 'alpha gamma', 'Word paste/type must reach original target exactly', 15000);
      }
      // Word shortcuts intentionally fall back to the focused word when none is selected.
      await openWords(desktop, target, 'fallback alone');
      await firstWord(desktop);
      await desktop.key(Clutter.KEY_c);
      assert((await target.clipboard()).text === 'fallback', 'Empty selection shortcut uses focused word');
    } finally { await target.close(); }
  },

  async 'WORD-06'(desktop) {
    const target = await Target.open(desktop);
    const original = desktop.indicator._actions.reportError;
    const errors = [];
    desktop.indicator._actions.reportError = error => { errors.push(error); original(error); };
    try {
      assert(desktop.settings.get_uint('tokenizer-word-limit') === 2000, 'Default interactive limit must be 2000');
      for (const count of [1999, 2000, 2001]) {
        const source = Array.from({length: count}, (_, index) => `word${index}`).join(' ');
        const item = await capture(desktop, target, source);
        const previousErrors = errors.length;
        await request(desktop, item);
        if (count <= 2000) {
          await until(() => desktop.manager.is('tokenizer') && desktop.words.buttons.length === count, `render ${count} words`, 15000);
        } else {
          await until(() => errors.length > previousErrors, 'over-limit notification');
          assert(desktop.manager.is('history'), 'Over-limit input must not show partial results');
        }
        await desktop.close();
        desktop.manager.reset();
      }
      desktop.settings.set_uint('tokenizer-word-limit', 4);
      await openWords(desktop, target, 'one two three four');
      assert(desktop.words.buttons.length === 4, 'Configured limit must apply to actual panel');
    } finally {
      desktop.indicator._actions.reportError = original;
      await target.close();
    }
  },

  async 'WORD-07'(desktop) {
    const target = await Target.open(desktop);
    let last = GLib.get_monotonic_time();
    let largestGap = 0;
    let phaseGap = 0;
    let samples = 0;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
      const now = GLib.get_monotonic_time();
      largestGap = Math.max(largestGap, (now - last) / 1000);
      phaseGap = Math.max(phaseGap, (now - last) / 1000);
      last = now;
      samples++;
      return GLib.SOURCE_CONTINUE;
    });
    try {
      for (const source of [Array.from({length: 2000}, (_, index) => `word${index}`).join(' '),
        `https://example.test/${'a'.repeat(100000)}`, 'x'.repeat(200000)]) {
        phaseGap = 0;
        await openWords(desktop, target, source);
        await desktop.key(Clutter.KEY_Escape);
        await pause(30);
        print(`[simulation] Word sample: length=${source.length}; words=${desktop.words.buttons.length}; maxGapMs=${phaseGap.toFixed(1)}`);
        assert(desktop.manager.is('history'), 'Large result must still respond to native Escape');
      }
      await pause(30);
      print(`[simulation] Word heartbeat: samples=${samples}; maxGapMs=${largestGap.toFixed(1)}; budgetMs=1000`);
      assert(samples > 5 && largestGap < 1000, 'Interactive word processing must not stall main loop for one second');
    } finally { GLib.Source.remove(timer); await target.close(); }
  },

  async 'WORD-08'(desktop) {
    const target = await Target.open(desktop);
    const panel = desktop.words;
    const tokenize = panel._tokenize;
    let release;
    let pending;
    panel._tokenize = text => {
      pending = new Promise(resolve => { release = resolve; }).then(() => tokenize(text));
      return pending;
    };
    try {
      const item = await capture(desktop, target, 'late word request must not replace phrases');
      await request(desktop, item);
      await until(() => Boolean(release), 'native row action reaches delayed word processing');
      await desktop.click(desktop.history.phrasesButton);
      await until(() => desktop.manager.is('phrases'), 'switch away while tokenization pending');
      release();
      await pending;
      await desktop.settle();
      assert(desktop.manager.is('phrases'), 'Late word result must not replace the newer panel');
    } finally { release?.(); if (pending) await pending; panel._tokenize = tokenize; await target.close(); }
  },

  async 'SELECT-04'(desktop) {
    const target = await Target.open(desktop);
    try {
      for (const initiallySelected of [false, true]) {
        await openWords(desktop, target, 'A B C D');
        if (initiallySelected) {
          for (const [index, button] of desktop.words.buttons.slice(0, 3).entries()) {
            await desktop.click(button);
            await until(() => !desktop.words._selectionDrag && desktop.words.state.selected.has(index), 'initial native selection committed');
          }
          // A native non-shift arrow resets the keyboard range without changing selection.
          await desktop.key(Clutter.KEY_Left);
          await desktop.key(Clutter.KEY_Left);
        } else await firstWord(desktop);
        assert(desktop.focus === desktop.words.buttons[0], 'Range starts at A');
        // A range is one held Shift gesture. Re-pressing Shift between arrows
        // legitimately begins a new range using the then-current selection.
        desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        await pause(25);
        try {
          for (let index = 0; index < 2; index++) {
            await desktop.key(Clutter.KEY_Right);
            await until(() => desktop.focus === desktop.words.buttons[index + 1], 'Shift movement delivered');
          }
          await until(() => selection(desktop.words) === (initiallySelected ? '' : '0,1,2'),
            `Shift range applied (initial=${initiallySelected}; selected=${selection(desktop.words)})`);
          await desktop.key(Clutter.KEY_Left);
          await until(() => selection(desktop.words) === (initiallySelected ? '2' : '0,1'),
            'Shift backtracking restores the original C state');
        } finally {
          desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
          await pause(25);
        }
      }
    } finally { await target.close(); }
  },

  async 'SELECT-06'(desktop) {
    const target = await Target.open(desktop);
    try {
      desktop.settings.set_int('panel-height', 240);
      await openWords(desktop, target, Array.from({length: 100}, (_, index) => `word${index}`).join(' '));
      for (const preview of [true, false]) {
        desktop.settings.set_boolean('tokenizer-show-source-preview', preview);
        await desktop.settle();
        assert(desktop.words.sourceLabel.visible === preview && !desktop.history.item.visible,
          'Preview configuration must apply without showing the history footer');
        await desktop.click(desktop.words.buttons[0]);
        const before = rect(desktop.words.resultLabel);
        const header = rect(desktop.words.header);
        const viewport = rect(desktop.words.scroll);
        await desktop.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
        desktop.pointer.notify_discrete_scroll(GLib.get_monotonic_time(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
        await until(() => desktop.words.scroll.get_vadjustment().value > 0, 'native word scroll');
        await desktop.settle();
        assert(Math.abs(rect(desktop.words.resultLabel).y - before.y) < 1
          && Math.abs(rect(desktop.words.header).y - header.y) < 1,
        'Word scrolling must leave result footer and header fixed');
        await desktop.close();
        desktop.manager.reset();
        await openWords(desktop, target, Array.from({length: 100}, (_, index) => `word${index}`).join(' '));
      }
    } finally { await target.close(); }
  },

  async 'SELECT-07'(desktop) {
    const target = await Target.open(desktop);
    let held = false;
    try {
      for (const close of [false, true]) {
        await openWords(desktop, target, 'A B C D');
        const box = rect(desktop.words.buttons[0]);
        await desktop.move(box.x + box.width / 2, box.y + box.height / 2);
        desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        held = true;
        await until(() => Boolean(desktop.words._selectionDrag), 'held native drag starts');
        desktop.settings.set_string('panel-escape-action', close ? 'close' : 'back');
        await desktop.key(Clutter.KEY_Escape);
        assert(!desktop.words._selectionDrag && desktop.words._dragSourceId === 0,
          'Actual panel exit must cancel selection and timer while mouse remains held');
        desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        held = false;
        await desktop.close();
        desktop.manager.reset();
      }
    } finally {
      if (held) desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
      await target.close();
    }
  },
};
