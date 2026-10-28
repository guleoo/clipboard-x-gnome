import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {assert, pause, rect, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';
import {run as drag} from './drag.smoke.js';
import {clippedWordSelection} from './viewport.smoke.js';
import {restart} from '../helpers/restart.js';

async function request(desktop, item) {
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors
    .find(actor => actor._clipboardXGnomeEntryAction === 'tokenize'));
}

async function openWords(desktop, target, text) {
  const item = await capture(desktop, target, text);
  await request(desktop, item);
  await until(() => desktop.manager.is('tokenizer') && desktop.words.state?.source === text
    && !desktop.words.state.loading, 'native word panel finishes loading');
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

async function lateWords(desktop, exit) {
  const target = await Target.open(desktop);
  const indicator = desktop.indicator;
  const openTokenizer = indicator._openTokenizer;
  const requests = new Map();
  const panel = desktop.words;
  const tokenize = panel._tokenize;
  const readItem = indicator._actions.readItem;
  const escapeAction = desktop.settings.get_string('panel-escape-action');
  const preserveState = desktop.settings.get_boolean('preserve-panel-state');
  let closeSignal = 0;
  let loadingState;
  let release;
  let pending;
  let calls = 0;
  let newerState;
  let newerButtons;
  indicator._openTokenizer = function (item) {
    const result = openTokenizer.call(this, item);
    requests.set(item.id, result);
    return result;
  };
  indicator._actions.readItem = async item => {
    assert(desktop.manager.is('tokenizer') && panel.state?.loading && panel.state.item === item
      && panel.actor.mapped && panel.buttons.length === 0 && !panel.copyButton.reactive && !panel._finishPaint,
    'The loading panel must be painted before reading content or creating word buttons');
    return readItem(item);
  };
  panel._tokenize = text => {
    if (calls++ > 0)
      return tokenize(text);
    // Run the real processor first and only delay delivery of its result.
    // Never replace the expected words or bypass the native request handler.
    pending = (async () => {
      const tokens = await tokenize(text);
      await new Promise(resolve => { release = resolve; });
      return tokens;
    })();
    return pending;
  };
  try {
    const item = await capture(desktop, target, 'late word request after ' + exit);
    const newer = exit === 'newer'
      ? await capture(desktop, target, 'newer result wins over the pending original')
      : null;
    await request(desktop, item);
    await until(() => Boolean(release), 'native row action reaches delayed real word result');
    loadingState = panel.state;
    assert(desktop.manager.is('tokenizer') && loadingState.loading && panel.buttons.length === 0,
      'A pending result must leave the visible panel in its loading state');
    if (exit === 'phrases') {
      await desktop.click(panel.backButton);
      await until(() => desktop.manager.is('history'), 'Back leaves the loading panel');
      await desktop.click(desktop.history.phrasesButton);
      await until(() => desktop.manager.is('phrases'), 'switch away while word result is pending');
    } else if (exit === 'close') {
      desktop.settings.set_string('panel-escape-action', 'close');
      desktop.settings.set_boolean('preserve-panel-state', false);
      // Change retention after the close handler, but before the hide animation
      // completes: an invalidated loading page must still be discarded.
      closeSignal = indicator.menu.connect('open-state-changed', (_menu, open) => {
        if (!open)
          desktop.settings.set_boolean('preserve-panel-state', true);
      });
      await desktop.key(Clutter.KEY_Escape);
      await until(() => !desktop.indicator.menu.isOpen, 'native Escape closes pending word request');
    } else if (exit === 'newer') {
      await desktop.click(panel.backButton);
      await until(() => desktop.manager.is('history'), 'return to choose another entry while the old result is pending');
      assert(desktop.manager.is('history') && desktop.indicator.menu.isOpen,
        'The popup must remain open when choosing another entry');
      await desktop.click(desktop.history._itemRows.get(newer.id).focusActors
        .find(actor => actor._clipboardXGnomeEntryAction === 'tokenize'));
      await until(() => requests.has(newer.id), 'second native row click reaches the real request handler');
      await requests.get(newer.id);
      await until(() => desktop.manager.is('tokenizer') && panel.state?.source === newer.text,
        'ungated real second result completes before the first is released');
      newerState = panel.state;
      newerButtons = [...panel.buttons];
      assert(newerButtons.length > 0 && release, 'First request remains gated while the second has real word actors');
    } else {
      await restart(desktop, async () => {
        release();
        await requests.get(item.id);
      });
    }
    release();
    // Await the native top-level handler, not just its inner processor Promise:
    // this includes createState, request guards and any attempted panel update.
    await requests.get(item.id);
    await desktop.settle();
    if (exit === 'phrases')
      assert(desktop.manager.is('phrases'), 'Late word result must not replace the newer panel');
    else if (exit === 'newer')
      assert(desktop.indicator.menu.isOpen && desktop.manager.is('tokenizer') && panel.state === newerState
        && panel.buttons.length === newerButtons.length
        && panel.buttons.every((button, index) => button === newerButtons[index]),
      'Completing the old request must preserve both the newer real state and its rendered word actors');
    else {
      assert(!desktop.indicator.menu.isOpen && desktop.manager.is('history'),
        'Late result must not reopen the popup or install an obsolete word panel');
      if (exit === 'disable')
        assert(panel.state === null && panel.buttons.length === 0,
          'Destroyed pending word request must not populate the old panel');
      else
        assert(panel.state === loadingState && panel.state.loading && panel.buttons.length === 0,
          'A closed pending request must not populate words or retain an active paint wait');
      assert(!panel._finishPaint, 'Leaving the loading panel must release its paint wait');
      await desktop.open();
      assert(desktop.manager.is('history'), 'Next native open must not resurrect the cancelled result');
    }
  } finally {
    release?.();
    try {
      if (pending) await pending;
      await Promise.all(requests.values());
    } finally {
      indicator._openTokenizer = openTokenizer;
      indicator._actions.readItem = readItem;
      if (closeSignal)
        indicator.menu.disconnect(closeSignal);
      desktop.settings.set_string('panel-escape-action', escapeAction);
      desktop.settings.set_boolean('preserve-panel-state', preserveState);
      panel._tokenize = tokenize;
      await target.close();
    }
  }
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
      desktop.settings.set_uint('tokenizer-word-limit', 4);
      for (const count of [4, 5]) {
        const source = Array.from({length: count}, (_, index) => `word${index}`).join(' ');
        const item = await capture(desktop, target, source);
        const previousErrors = errors.length;
        await request(desktop, item);
        if (count <= 4) {
          await until(() => desktop.manager.is('tokenizer') && desktop.words.buttons.length === count, `render ${count} words`, 15000);
        } else {
          await until(() => errors.length > previousErrors, 'over-limit notification');
          assert(desktop.manager.is('history'), 'Over-limit input must not show partial results');
        }
        await desktop.close();
        desktop.manager.reset();
      }
    } finally {
      desktop.indicator._actions.reportError = original;
      await target.close();
    }
  },

  async 'WORD-07'(desktop) {
    const target = await Target.open(desktop);
    const reportError = desktop.indicator._actions.reportError;
    const errors = [];
    desktop.indicator._actions.reportError = error => { errors.push(error); reportError(error); };
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
      // Logic owns character/word boundary matrices; this owns real actor layout.
      {
        const source = Array.from({length: 2000}, (_, index) => `word${index}`).join(' ');
        phaseGap = 0;
        await openWords(desktop, target, source);
        assert(desktop.words.buttons.length === 2000, 'The real panel must render all 2,000 allowed word buttons');
        await desktop.key(Clutter.KEY_Escape);
        await pause(30);
        print(`[simulation] Word sample: length=${source.length}; words=${desktop.words.buttons.length}; maxGapMs=${phaseGap.toFixed(1)}`);
        assert(desktop.manager.is('history'), 'Large result must still respond to native Escape');
      }
      {
        const source = 'x'.repeat(20001);
        phaseGap = 0;
        const item = await capture(desktop, target, source);
        const previous = desktop.words.state;
        const previousErrors = errors.length;
        await request(desktop, item);
        await until(() => errors.length > previousErrors, 'oversized text rejected with a notification');
        await pause(30);
        assert(errors.length === previousErrors + 1 && desktop.manager.is('history') && desktop.words.state === previous,
          'Oversized text must fail once without replacing the panel state or rendering partial words');
        print(`[simulation] Word rejection: length=${source.length}; maxGapMs=${phaseGap.toFixed(1)}`);
      }
      await openWords(desktop, target, 'normal words after rejection');
      await desktop.key(Clutter.KEY_Escape);
      await pause(30);
      print(`[simulation] Word heartbeat: samples=${samples}; maxGapMs=${largestGap.toFixed(1)}; budgetMs=1000`);
      assert(samples > 5 && largestGap < 1000, 'Interactive word processing must not stall main loop for one second');
    } finally {
      desktop.indicator._actions.reportError = reportError;
      GLib.Source.remove(timer);
      await target.close();
    }
  },

  'WORD-08': desktop => lateWords(desktop, 'phrases'),
  'WORD-08-close': desktop => lateWords(desktop, 'close'),
  'WORD-08-disable': desktop => lateWords(desktop, 'disable'),
  'WORD-08-newer': desktop => lateWords(desktop, 'newer'),

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

  async 'SELECT-05'(desktop) {
    const target = await Target.open(desktop);
    try {
      await openWords(desktop, target, 'A B C D');
      await firstWord(desktop);
      await desktop.key(Clutter.KEY_space);
      await until(() => selection(desktop.words) === '0', 'Space selects the focused word once');
      await desktop.key(Clutter.KEY_space);
      await until(() => selection(desktop.words) === '', 'Space deselects the focused word once');
      await desktop.key(Clutter.KEY_Return);
      await until(() => selection(desktop.words) === '0', 'Enter selects the focused word once');
      await desktop.key(Clutter.KEY_Return);
      await until(() => selection(desktop.words) === '', 'Enter deselects the focused word once');
      assert(desktop.indicator.menu.isOpen && desktop.manager.is('tokenizer'),
        'Word activation must not copy and close the panel');
      await desktop.key(Clutter.KEY_Right);
      assert(desktop.focus === desktop.words.buttons[1], 'Right navigates to B without selecting it');
      assert(selection(desktop.words) === '', 'Plain arrows must not change selection');
    } finally { await target.close(); }
  },

  async 'SELECT-04-cross-row'(desktop) {
    const target = await Target.open(desktop);
    let held = false;
    try {
      desktop.settings.set_int('panel-width', 320);
      await openWords(desktop, target, 'Aaaaaaaaaa Bbbbbbbbbb Cccccccccc Dddddddddd Eeeeeeeeee Ffffffffff');
      const panel = desktop.words;
      const first = panel.buttons[0];
      const nextRow = panel.tokenBox.get_children()[1];
      assert(nextRow?.get_children().length, 'Narrow geometry must produce a second word row');
      const center = rect(first).x + rect(first).width / 2;
      const targetButton = nextRow.get_children().reduce((closest, button) => {
        const box = rect(button);
        const distance = Math.abs(box.x + box.width / 2 - center);
        return distance < closest.distance ? {button, distance} : closest;
      }, {button: null, distance: Infinity}).button;
      const targetIndex = panel.buttons.indexOf(targetButton);
      await firstWord(desktop);
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
      held = true;
      await pause(25);
      await desktop.key(Clutter.KEY_Down);
      await until(() => desktop.focus === targetButton, 'Shift+Down reaches the nearest word on the next row');
      assert(selection(panel) === Array.from({length: targetIndex + 1}, (_, index) => index).join(','),
        'Cross-row Shift must select every source-order word between anchor and destination');
      await desktop.key(Clutter.KEY_Up);
      await until(() => desktop.focus === first && selection(panel) === '0',
        'Shift+Up backtracking restores the original selection outside the anchor');
    } finally {
      if (held) {
        desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
        await pause(25);
      }
      await target.close();
    }
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

  async 'SELECT-07-disable'(desktop) {
    const target = await Target.open(desktop);
    let held = false;
    try {
      await openWords(desktop, target, 'A B C D');
      const old = desktop.words;
      const box = rect(old.buttons[0]);
      await desktop.move(box.x + box.width / 2, box.y + box.height / 2);
      desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
      held = true;
      await until(() => Boolean(old._selectionDrag), 'held drag exists before actual disable');
      let released = false;
      await restart(desktop, async () => {
        released = !old._selectionDrag && old._dragSourceId === 0 && old.buttons.length === 0;
        desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        held = false;
        await pause(25);
      });
      assert(released, 'Disable must release the active drag, polling source and old button references');
      await openWords(desktop, target, 'fresh selection after disable');
      await desktop.click(desktop.words.buttons[0]);
      await until(() => !desktop.words._selectionDrag && selection(desktop.words) === '0',
        'New panel must accept a normal click without inheriting the held session');
    } finally {
      if (held) desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
      await target.close();
    }
  },
};
