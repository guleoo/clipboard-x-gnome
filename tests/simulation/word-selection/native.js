import Clutter from 'gi://Clutter';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {prepare} from '../terminal/ready.js';
import {capture} from '../clipboard/native.js';
import {run as drag} from './drag.smoke.js';

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

export const cases = {
  'SELECT-01': () => drag(), // Owns single-click and held/backtracking ranges; no copied scenarios.
  async 'WORD-05'(desktop) {
    const target = await Target.open(desktop);
    try {
      await prepare(target.window, () => target.state.text);
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
};
