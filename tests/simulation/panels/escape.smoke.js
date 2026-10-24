import Clutter from 'gi://Clutter';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {assert} from '../helpers/checks.js';
import {runNative} from '../helpers/native.js';

export function run() {
  return runNative(verify);
}

export async function verify({indicator, settings, phrases, key, click, type, openPhrases, originalEscape}) {
    assert(originalEscape === 'back', 'Secondary panels must return to history by default');
    for (const action of ['back', 'close']) {
      settings.set_string('panel-escape-action', action);
      await openPhrases();
      await click(phrases.addButton);
      await type('Discard this draft');
      await key(Clutter.KEY_Escape);
      assert(indicator.menu.isOpen && indicator._panelManager.is('phrases') && !phrases.formVisible,
        `${action}: first Escape must only dismiss the form`);
      assert(phrases.entry.get_text() === '' && !phrases.phrases.includes('Discard this draft'),
        'Escape must discard the draft without saving it');
      await key(Clutter.KEY_Escape);
      assert(action === 'back'
        ? indicator.menu.isOpen && indicator._panelManager.is('history')
        : !indicator.menu.isOpen,
      `${action}: second Escape did not follow the configured panel action`);
      if (action === 'back') {
        await key(Clutter.KEY_Escape);
        assert(!indicator.menu.isOpen, 'Escape from history must close the popup');
      }

      indicator.menu.open();
      const state = await indicator._tokenizer.createState(null, 'A B C');
      indicator._panelManager.show('tokenizer', state);
      indicator._tokenizer.focusStart();
      await Scripting.sleep(100);
      await key(Clutter.KEY_Escape);
      assert(action === 'back'
        ? indicator.menu.isOpen && indicator._panelManager.is('history')
        : !indicator.menu.isOpen,
      `${action}: word selection Escape did not follow the configured action`);
      indicator.menu.close();
    }
    print('Native Escape: form, secondary panels, and history passed');

}
