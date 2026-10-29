import Clutter from 'gi://Clutter';
import {assert} from '../helpers/desktop.js';
import {runNative, until} from '../helpers/native.js';

export function run() {
  return runNative(verify);
}

export async function verify({phrases, key, click, type, openPhrases}) {
    await openPhrases();
    await click(phrases.addButton);
    await until(() => global.stage.get_key_focus() === phrases.entry.clutter_text,
      'Opening the phrase form must focus its input');
    await click(phrases.addButton);
    assert(!phrases.formVisible && global.stage.get_key_focus() === phrases.addButton,
      'Clicking Add again must dismiss the form and return focus to Add');
    for (const mode of ['enter', 'keypad-enter', 'button']) {
      await click(phrases.addButton);
      await until(() => global.stage.get_key_focus() === phrases.entry.clutter_text,
        'Opening the phrase form must focus its input');
      const phrase = `Saved with ${mode}`;
      await type(phrase);
      await until(() => phrases.entry.get_text() === phrase,
        `Native input did not complete: ${JSON.stringify(phrases.entry.get_text())}`);
      await key(Clutter.KEY_Home);
      await until(() => phrases.entry.clutter_text.get_cursor_position() === 0,
        `Home must move to the draft start (cursor=${phrases.entry.clutter_text.get_cursor_position()})`);
      await key(Clutter.KEY_Right);
      await until(() => phrases.entry.clutter_text.get_cursor_position() === 1, 'First Right moves inside draft');
      await key(Clutter.KEY_Right);
      await until(() => phrases.entry.clutter_text.get_cursor_position() === 2,
        'Second Right must move inside the draft without leaving the entry');
      assert(global.stage.get_key_focus() === phrases.entry.clutter_text
        && phrases.entry.clutter_text.get_cursor_position() === 2,
      `The new save button must not steal arrows inside the draft (cursor=${phrases.entry.clutter_text.get_cursor_position()})`);
      await key(Clutter.KEY_End);
      await key(Clutter.KEY_Right);
      assert(global.stage.get_key_focus() === phrases.saveButton,
        'Right at the draft end must reach its save button');
      await click(phrases.entry);
      if (mode === 'button')
        await click(phrases.saveButton);
      else
        await key(mode === 'enter' ? Clutter.KEY_Return : Clutter.KEY_KP_Enter);
      await until(() => phrases.phrases.includes(phrase) && !phrases.formVisible,
        `${mode}: phrase was not saved and form was not closed`);
      assert(phrases.entry.get_text() === '', `${mode}: draft was not cleared`);
    }
    print('Quick phrase native Enter, keypad Enter and save button passed');
}
