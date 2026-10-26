import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import {assert, capturedKeyEvent, waitUntil} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function phrases(indicator) {
  const history = indicator._historyPanel;
  await indicator._quickPhrases.ready;
  const originalPhrases = indicator._quickPhrases.phrases;
  try {
    indicator.menu.open();
    await Scripting.sleep(200);
    await indicator._quickPhrases.replace(['Local smoke-test phrase']);
    indicator._openPhrases();
    await Scripting.sleep(100);
    const quickPhrases = indicator._quickPhrases;
    quickPhrases.addButton.grab_key_focus();
    indicator._inputMode.keyboard(Clutter.KEY_Right);
    indicator._tooltip.show(quickPhrases.addButton, {immediate: true});
    assert(indicator._tooltip.actor.visible, 'The persistent add action lost its tooltip after panel switching');
    indicator._panelManager.refresh('phrases');
    indicator._tooltip.show(quickPhrases.addButton, {immediate: true});
    assert(indicator._tooltip.actor.visible, 'Refreshing a panel detached its persistent action tooltip');
    quickPhrases.buttons[0].grab_key_focus();
    const phraseCommands = [];
    const originalTypeText = indicator._actions.typeText;
    const originalPasteText = indicator._actions.pasteText;
    const phraseShortcutKeys = ['history-type-shortcut', 'history-paste-shortcut', 'history-delete-shortcut'];
    const originalPhraseShortcuts = phraseShortcutKeys.map(key => indicator._settings.get_strv(key));
    const focusPhrase = (actionIndex = 0) => {
      indicator.menu.open();
      indicator._openPhrases();
      quickPhrases.focusAnchor.cancel();
      quickPhrases.rows[0].focusActors[actionIndex].grab_key_focus();
    };
    indicator._actions.typeText = async text => phraseCommands.push(`type:${text}`);
    indicator._actions.pasteText = async text => phraseCommands.push(`paste:${text}`);
    try {
      indicator._settings.set_strv('history-type-shortcut', ['apostrophe']);
      indicator._settings.set_strv('history-paste-shortcut', ['v']);
      indicator._settings.set_strv('history-delete-shortcut', ['Delete']);
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_STOP
          && !indicator.menu.isOpen,
      'Quick-phrase typing shortcut must be consumed and close the menu');
      focusPhrase(1);
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_v)) === Clutter.EVENT_STOP
          && !indicator.menu.isOpen,
      'Quick-phrase paste shortcut must also work while its action icon is focused');
      assert(phraseCommands.join(',') === 'type:Local smoke-test phrase,paste:Local smoke-test phrase',
        'Quick-phrase shortcuts did not send the focused text to the correct actions');
      indicator._settings.set_strv('history-type-shortcut', ['<Control>t']);
      focusPhrase();
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_PROPAGATE,
        'Quick phrases kept the old simulated-input shortcut after reconfiguration');
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_t, Clutter.ModifierType.CONTROL_MASK))
          === Clutter.EVENT_STOP,
      'Quick phrases did not honor a configured shortcut with modifiers');
      indicator._settings.set_strv('history-type-shortcut', []);
      focusPhrase();
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_PROPAGATE,
        'A disabled quick-phrase typing shortcut must not run');
      indicator._settings.set_strv('history-type-shortcut', ['apostrophe']);
      quickPhrases.showForm();
      const beforeInput = phraseCommands.length;
      for (const key of [Clutter.KEY_v, Clutter.KEY_apostrophe, Clutter.KEY_Delete]) {
        assert(indicator._handleMenuKey(capturedKeyEvent(key)) === Clutter.EVENT_PROPAGATE,
          'Entry shortcuts must not intercept text editing in the quick-phrase form');
      }
      assert(phraseCommands.length === beforeInput && quickPhrases.phrases.length === 1,
        'Editing a quick phrase triggered a clipboard action or deletion');
      quickPhrases.hideForm();
      focusPhrase();
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Delete)) === Clutter.EVENT_STOP,
        'Quick-phrase deletion shortcut was not consumed');
      assert(await waitUntil(() => !quickPhrases.phrases.includes('Local smoke-test phrase')),
        'Quick-phrase deletion shortcut did not delete the focused phrase');
      await quickPhrases.replace(['Local smoke-test phrase']);
    } finally {
      indicator._actions.typeText = originalTypeText;
      indicator._actions.pasteText = originalPasteText;
      phraseShortcutKeys.forEach((key, index) => indicator._settings.set_strv(key, originalPhraseShortcuts[index]));
    }
    const addPhrase = quickPhrases._store.add;
    let releaseSave;
    const delayed = new Promise(resolve => { releaseSave = resolve; });
    quickPhrases._store.add = async text => {
      await delayed;
      return addPhrase.call(quickPhrases._store, text);
    };
    quickPhrases.showForm();
    quickPhrases.entry.set_text('Delayed smoke-test phrase');
    const saving = quickPhrases.save();
    try {
      indicator._closePhrases();
      history.searchEntry.clutter_text.grab_key_focus();
      const focus = global.stage.get_key_focus();
      releaseSave();
      await saving;
      assert(indicator._panelManager.is('history') && global.stage.get_key_focus() === focus,
        'Completing a saved-phrase write stole focus from another panel');
    } finally {
      releaseSave();
      await saving;
      quickPhrases._store.add = addPhrase;
    }
    indicator._openPhrases();
    await indicator._quickPhrases.replace(originalPhrases);
    indicator._closePhrases();
    assert(indicator._panelManager.is('history'),
      'Saved-phrase panel did not return to clipboard history');
    history.privateButton.grab_key_focus();
    indicator._inputMode.keyboard(Clutter.KEY_Right);
    indicator._tooltip.show(history.privateButton, {immediate: true});
    assert(indicator._tooltip.actor.visible && indicator._tooltip.actor.get_parent() === Main.uiGroup,
      'Icon help must use a floating Shell tooltip');
    indicator._tooltip.hide();
    indicator.menu.close();
    await Scripting.sleep(100);
    assert(!indicator.menu.isOpen, 'Clipboard X Gnome menu did not close');
  } finally {
    await indicator._quickPhrases.replace(originalPhrases);
    indicator._quickPhrases.hideForm();
    indicator._closePhrases();
    indicator.menu.close();
  }
}

export function run() {
  return runChecks([['phrases', phrases]]);
}
