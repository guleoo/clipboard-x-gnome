import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
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
  'PHRASE-01': desktop => form(context(desktop)),
  'PHRASE-02': desktop => escape(context(desktop)),

  async 'PHRASE-04'(desktop) {
    const target = await Target.open(desktop);
    const phrase = 'Native phrase actions';
    await desktop.phrases.replace([phrase]);
    try {
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

  async 'PHRASE-05'(desktop) {
    const target = await Target.open(desktop);
    const phrase = 'Copy close policy';
    await desktop.phrases.replace([phrase]);
    try {
      for (const close of [false, true]) {
        desktop.settings.set_boolean('phrase-close-after-copy', close);
        await target.offer(`Different clipboard before close=${close}`);
        await focusPhrase(desktop, phrase);
        await desktop.key(Clutter.KEY_Return);
        await until(() => desktop.indicator.menu.isOpen === !close, 'configured close-after-copy');
        assert((await target.clipboard()).text === phrase, 'Both close policies must copy actual phrase bytes');
      }
    } finally { await target.close(); }
  },

  async 'PHRASE-06'(desktop) {
    const panel = desktop.phrases;
    const original = panel._store.add;
    let release;
    let pending;
    let completed = false;
    panel._store.add = async text => {
      await new Promise(resolve => { release = resolve; });
      pending = original.call(panel._store, text);
      try { return await pending; } finally { completed = true; }
    };
    try {
      await openPhrases(desktop);
      await desktop.click(panel.addButton);
      await desktop.type('Submitted native draft');
      await desktop.key(Clutter.KEY_Return);
      await until(() => Boolean(release), 'actual Enter reaches pending store write');
      await desktop.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
      await desktop.type('Newer native draft');
      release();
      await until(() => completed && panel.phrases.includes('Submitted native draft'), 'pending phrase persisted');
      await desktop.settle();
      assert(panel.formVisible && panel.entry.get_text() === 'Newer native draft'
        && desktop.focus === panel.entry.clutter_text,
      'Old write completion must preserve newer native input and focus');
    } finally {
      release?.();
      if (pending) await pending;
      panel._store.add = original;
    }
  },

  async 'PHRASE-07'(desktop) {
    const panel = desktop.phrases;
    const path = panel._store.path;
    const failurePath = GLib.dir_make_tmp('cbx-phrase-directory-XXXXXX');
    const reportError = panel._reportError;
    const errors = [];
    panel._reportError = error => { errors.push(error); reportError(error); };
    // A directory is a genuine replace_contents failure, also when tests run as root.
    panel._store.path = failurePath;
    try {
      await openPhrases(desktop);
      await desktop.click(panel.addButton);
      await desktop.type('Retry after actual IO failure');
      await desktop.key(Clutter.KEY_Return);
      await until(() => errors.length === 1, 'first native Enter must report the real directory replacement error');
      await panel._store._operation;
      assert(panel.formVisible && panel.entry.get_text() === 'Retry after actual IO failure'
        && !panel.phrases.includes('Retry after actual IO failure'),
      'Failed persistence must retain the draft without inventing success');
      panel._store.path = path;
      await desktop.key(Clutter.KEY_Return);
      await until(() => !panel.formVisible && panel.phrases.includes('Retry after actual IO failure'), 'native retry saved');
      const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
      assert(JSON.parse(new TextDecoder().decode(bytes)).phrases.includes('Retry after actual IO failure'),
        'Retry must reach actual durable phrase storage');
    } finally { panel._store.path = path; panel._reportError = reportError; }
  },
};
