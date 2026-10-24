import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import {assert, capturedKeyEvent} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function wordSelection(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const capturedText = indicator._controller.add(ClipboardItem.fromText('Word selection smoke test 你好'));
  indicator.menu.open();
  await Scripting.sleep(100);
  try {
    indicator._settings.set_boolean('tokenizer-show-source-preview', false);
    indicator.menu.open();
    await Scripting.sleep(100);
    await indicator._openTokenizer(capturedText);
    await Scripting.sleep(100);
    const tokenState = indicator._panelManager.state;
    assert(indicator._panelManager.is('tokenizer') && tokenState?.tokens.length > 1
        && !history.item.visible
        && indicator._tokenizer.item.visible,
      'Word selection did not replace the history panel');
    await Scripting.sleep(100);
    const tokenButtons = indicator._tokenizer.tokenBox.get_children()
      .flatMap(row => row.get_children());
    const unrelated = ClipboardItem.fromText('Background history update during word selection');
    indicator._controller.add(unrelated);
    assert(indicator._tokenizer.tokenBox.get_children().flatMap(row => row.get_children())[0] === tokenButtons[0],
      'An unrelated history change rebuilt the active word-selection controls');
    indicator._controller.remove(unrelated.id);
    assert(tokenButtons.length === tokenState.tokens.length,
      'Text segmentation did not render one visible button for each token');
    assert(tokenButtons.every(button => button.mapped && button.width > 0 && button.height > 0),
      'Text segmentation rendered word selection buttons outside the visible layout');
    assert(!indicator._tokenizer.sourceLabel.visible,
      'Disabled source preview remained visible in the tokenizer');
    indicator._settings.set_boolean('tokenizer-show-source-preview', true);
    assert(indicator._tokenizer.sourceLabel.visible,
      'Enabled source preview was not shown immediately');
    tokenButtons[0].grab_key_focus();
    indicator._tokenizer.handleKey(
      tokenButtons[0], capturedKeyEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
    );
    assert(tokenState.selected.has(tokenState.tokens[0].index)
        && tokenState.selected.has(tokenState.tokens[1].index)
        && global.stage.get_key_focus() === tokenButtons[1],
      'Shift+Arrow did not extend word selection and keyboard focus');
    tokenState.keyboardSelection = null;
    tokenButtons[0].grab_key_focus();
    indicator._tokenizer.handleKey(
      tokenButtons[0], capturedKeyEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
    );
    assert(!tokenState.selected.has(tokenState.tokens[0].index)
        && !tokenState.selected.has(tokenState.tokens[1].index),
    'Shift+Arrow did not deselect a range anchored on a selected token');
    for (const button of tokenButtons)
      indicator._tokenizer.setSelected(button, false, false);
    tokenState.keyboardSelection = null;
    indicator._tokenizer.updateResult();
    indicator._tokenizer.setSelected(tokenButtons[0], true);
    indicator._tokenizer.setSelected(tokenButtons[1], false);
    assert(indicator._tokenizer.resultLabel.text === tokenState.tokens[0].text,
      'Selected token did not update the copy result preview');
    indicator._closeTokenizer();
    assert(indicator._panelManager.is('history')
        && history.item.visible
        && !indicator._tokenizer.item.visible,
      'Returning from text segmentation did not restore clipboard history');
    indicator.menu.close();
  } finally {
    indicator._closeTokenizer();
    indicator.menu.close();
    indicator._controller.remove(capturedText.id);
  }
}

export function run() {
  return runChecks([['wordSelection', wordSelection]]);
}
