import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {assert, capturedKeyEvent} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function focusRestoration(indicator, extensionObject) {
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const history = indicator._historyPanel;
  const tokenizer = indicator._tokenizer;
  const phrases = indicator._quickPhrases;
  await phrases.ready;
  const originalPhrases = phrases.phrases;
  const now = Date.now();
  const items = ['A', 'B', 'NEW'].map((text, index) => ClipboardItem.fromText(`Focus identity ${text}`, {
    createdAt: now + (index === 2 ? 3000 : 2000 - index * 1000),
  }));
  const focusedItem = () => global.stage.get_key_focus()?._clipboardXGnomeHistoryRow?._clipboardXGnomeHistoryItem;
  const focusItem = (item, action) => {
    const row = history._itemRows.get(item.id);
    const actor = row?.focusActors.find(value => (value._clipboardXGnomeEntryAction ?? null) === action);
    assert(actor, `Missing focus target ${item.id}/${action}`);
    actor.grab_key_focus();
  };
  const scrollValue = panel => panel.scroll.get_vadjustment().value;
  const setScroll = panel => {
    const adjustment = panel.scroll.get_vadjustment();
    adjustment.value = Math.min(50, adjustment.upper - adjustment.page_size);
    assert(adjustment.value > 0, 'Focus fixture must have scrollable content');
    return adjustment.value;
  };
  // Input sources run before the low-priority view-restoration idle.
  const beforeRestore = action => new Promise((resolve, reject) => {
    GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => {
      try {
        action();
        resolve();
      } catch (error) {
        reject(error);
      }
      return GLib.SOURCE_REMOVE;
    });
  });
  try {
    indicator._panelManager.show('history');
    indicator.menu.open();
    await Scripting.sleep(100);
    history.searchEntry.set_text('Focus identity');
    indicator._controller.add(items[0]);
    indicator._controller.add(items[1]);
    await Scripting.sleep(100);
    focusItem(items[1], 'pin');
    indicator._controller.add(items[2]);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[1].id
        && global.stage.get_key_focus()._clipboardXGnomeEntryAction === 'pin',
      'An incoming item changed the focused history item or action');
    indicator._controller.update(items[2]);
    await beforeRestore(() => {
      history.searchEntry.clutter_text.grab_key_focus();
      history.searchEntry.set_text('Focus identity B');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === history.searchEntry.clutter_text,
      'A queued history restoration must not override subsequent search input');
    history.searchEntry.set_text('Focus identity');
    await Scripting.sleep(100);
    focusItem(items[1], 'pin');
    indicator._controller.update(items[2]);
    await beforeRestore(() => history.privateButton.grab_key_focus());
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === history.privateButton,
      'A queued history restoration must not override a newly focused persistent action');
    focusItem(items[1], 'pin');
    indicator._controller.update(items[2]);
    indicator.menu.actor.grab_key_focus();
    indicator._controller.update(items[2]);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[1].id,
      'Consecutive history refreshes must preserve item focus despite non-control menu focus');
    indicator._controller.toggleFavorite(items[1].id);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[1].id
        && global.stage.get_key_focus()._clipboardXGnomeEntryAction === 'pin',
      'Pin reordering changed the focused history item or action');
    const pinned = global.stage.get_key_focus();
    indicator._settings.set_string('theme-color', '#123456');
    assert(global.stage.get_key_focus() === pinned && pinned.get_style().includes('#123456'),
      'Theme changes must update an existing pinned action without rebuilding it');
    indicator._controller.remove(items[1].id);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[2].id
        && global.stage.get_key_focus()._clipboardXGnomeEntryAction === 'pin',
      'Removing the focused item must fall back to its nearest remaining item and action');
    focusItem(items[0], null);
    indicator._controller.remove(items[0].id);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[2].id,
      'Removing the last row must fall back to the previous item, not the footer');
    history.privateButton.grab_key_focus();
    indicator._controller.update(items[2]);
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === history.privateButton,
      'A history refresh must preserve a persistent toolbar or footer control');

    indicator._settings.set_int('panel-height', 200);
    const source = Array.from({length: 150}, (_, index) => `word${index}`).join(' ');
    const state = await tokenizer.createState(null, source);
    indicator._panelManager.show('tokenizer', state);
    tokenizer.focusStart();
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === tokenizer.focusAnchor,
      'Entering word selection must still start on its focus anchor');
    const token = tokenizer.buttons[15];
    token.grab_key_focus();
    tokenizer.setSelected(token, true);
    const tokenIndex = token._clipboardXGnomeToken.index;
    await Scripting.sleep(100);
    const tokenScroll = setScroll(tokenizer);
    indicator._settings.set_string('theme-color', '#654321');
    assert(global.stage.get_key_focus() === token && token.get_style().includes('#654321'),
      'Word-selection theme changes must update styles without rebuilding focused controls');
    const width = indicator._settings.get_int('panel-width');
    indicator._settings.set_int('panel-width', width === 420 ? 430 : 420);
    indicator._settings.set_int('panel-height', 210);
    await Scripting.sleep(150);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === tokenIndex
        && tokenizer.focusGrid.contains(global.stage.get_key_focus())
        && Math.abs(scrollValue(tokenizer) - tokenScroll) < 1,
      'Word-selection resize must preserve token identity and scroll, including consecutive refreshes');
    indicator._panelManager.refresh('tokenizer');
    tokenizer.focusAnchor.grab_key_focus();
    indicator._panelManager.refresh('tokenizer');
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === tokenIndex,
      'Consecutive token refreshes must not mistake default anchor focus for new business input');
    indicator._panelManager.refresh('tokenizer');
    let navigatedIndex;
    await beforeRestore(() => {
      tokenizer.buttons[1].grab_key_focus();
      indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Right));
      navigatedIndex = global.stage.get_key_focus()?._clipboardXGnomeToken?.index;
      assert(navigatedIndex === state.tokens[2].index, 'The queued keyboard input must navigate to a new token');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === navigatedIndex,
      'A queued token restoration must not undo subsequent keyboard navigation');
    indicator._panelManager.refresh('tokenizer');
    await beforeRestore(() => {
      tokenizer.buttons[3].grab_key_focus();
      indicator._panelManager.refresh('tokenizer');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === state.tokens[3].index,
      'A second token refresh must capture the new focus instead of reusing an older pending snapshot');

    indicator._settings.set_int('saved-phrase-limit', 100);
    await phrases.replace(Array.from({length: 40}, (_, index) => `Focus phrase ${index}`));
    indicator._openPhrases();
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === phrases.focusAnchor,
      'Entering quick phrases must still start on its focus anchor');
    phrases.rows[5].focusActors[1].grab_key_focus();
    const phrase = phrases.rows[5]._clipboardXGnomePhrase;
    await Scripting.sleep(100);
    const phraseScroll = setScroll(phrases);
    const phraseActor = global.stage.get_key_focus();
    indicator._settings.set_string('theme-color', 'green');
    assert(global.stage.get_key_focus() === phraseActor,
      'Quick-phrase theme changes must not rebuild focused controls');
    indicator._settings.set_int('panel-width', 440);
    indicator._settings.set_int('panel-height', 220);
    await Scripting.sleep(150);
    const row = global.stage.get_key_focus()?._clipboardXGnomePhraseRow;
    assert(row?._clipboardXGnomePhrase === phrase
        && row.focusActors[1] === global.stage.get_key_focus()
        && Math.abs(scrollValue(phrases) - phraseScroll) < 1,
      `Quick-phrase resize must preserve phrase identity, action, and scroll (phrase=${row?._clipboardXGnomePhrase}/${phrase}, action=${row?.focusActors.indexOf(global.stage.get_key_focus())}, scroll=${scrollValue(phrases)}/${phraseScroll})`);
    await phrases.replace(['Inserted focus phrase', ...phrases.phrases]);
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomePhraseRow?._clipboardXGnomePhrase === phrase,
      'Updating phrases must retain focus by phrase rather than row position');
    indicator._panelManager.refresh('phrases');
    await beforeRestore(() => phrases.rows[1].focusActors[1].grab_key_focus());
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === phrases.rows[1].focusActors[1],
      'A queued phrase restoration must not override a newly focused phrase action');
    indicator._panelManager.refresh('phrases');
    await beforeRestore(() => {
      phrases.rows[2].focusActors[1].grab_key_focus();
      indicator._panelManager.refresh('phrases');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === phrases.rows[2].focusActors[1],
      'A second phrase refresh must retain the new phrase and action instead of the older snapshot');
  } finally {
    indicator._panelManager.show('history');
    indicator.menu.close();
    history.resetSearch();
    for (const item of items)
      indicator._controller.remove(item.id);
    await phrases.replace(originalPhrases);
  }
}

export function run() {
  return runChecks([['focusRestoration', focusRestoration]]);
}
