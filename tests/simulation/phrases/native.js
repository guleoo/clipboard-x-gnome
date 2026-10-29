import Clutter from 'gi://Clutter';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {prepare} from '../terminal/ready.js';
import {verify as form} from './form.smoke.js';
import {verify as escape} from '../panels/escape.smoke.js';

export async function openPhrases(desktop) {
  await desktop.open();
  await desktop.click(desktop.history.phrasesButton);
  await until(() => desktop.manager.is('phrases'), 'native phrase entry');
  await desktop.settle();
}

function context(desktop) {
  return {
    indicator: desktop.indicator, settings: desktop.settings, phrases: desktop.phrases,
    key: desktop.key.bind(desktop), click: desktop.click.bind(desktop), type: desktop.type.bind(desktop),
    openPhrases: () => openPhrases(desktop), originalEscape: desktop.settings.get_string('panel-escape-action'),
  };
}

async function focusPhrase(desktop, phrase) {
  await openPhrases(desktop);
  await desktop.key(Clutter.KEY_Down);
  assert(desktop.phrases.buttons.includes(desktop.focus)
    && desktop.focus._clipboardXGnomePhraseRow._clipboardXGnomePhrase === phrase,
  'Native navigation must start at the phrase, not its Back button');
}

export const cases = {
  async 'PHRASE-01'(desktop) {
    await form(context(desktop));
    await escape(context(desktop));
  },
  async 'PHRASE-04'(desktop) {
    const target = await Target.open(desktop);
    const phrase = 'Native phrase actions';
    await desktop.phrases.replace([phrase]);
    try {
      await prepare(target.window, () => target.state.text);
      for (const action of ['click', 'enter', 'paste', 'type', 'configured-type']) {
        await target.focus();
        await target.call('clear');
        await target.offer(`Different clipboard before ${action}`);
        await focusPhrase(desktop, phrase);
        if (action === 'click') await desktop.click(desktop.phrases.buttons[0]);
        else if (action === 'enter') await desktop.key(Clutter.KEY_Return);
        else if (action === 'paste') await desktop.key(Clutter.KEY_v);
        else if (action === 'type') await desktop.key(Clutter.KEY_apostrophe);
        else {
          desktop.settings.set_strv('history-type-shortcut', ['<Control>t']);
          await desktop.key(Clutter.KEY_t, [Clutter.KEY_Control_L]);
        }
        if (['click', 'enter'].includes(action))
          assert((await target.clipboard()).text === phrase, `${action}: real clipboard must contain phrase`);
        else
          await until(() => target.state.text === phrase, `${action}: independent target must receive exact phrase`, 15000);
      }
      await focusPhrase(desktop, phrase);
      await desktop.key(Clutter.KEY_Delete);
      await until(() => !desktop.phrases.phrases.includes(phrase), 'native phrase Delete');
      await desktop.click(desktop.phrases.addButton);
      await desktop.type("v'p");
      await until(() => desktop.phrases.entry.get_text() === "v'p" && desktop.phrases.formVisible,
        `Typing in the form must not invoke row shortcuts (text=${JSON.stringify(desktop.phrases.entry.get_text())}, visible=${desktop.phrases.formVisible})`);
    } finally { await target.close(); }
  },
};
