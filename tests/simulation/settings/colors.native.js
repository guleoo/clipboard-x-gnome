import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Preferences} from '../helpers/preferences.js';

const HEX = /^#[0-9a-f]{6}$/i;

async function choose(desktop, preferences, trigger, title, value, accept) {
  await preferences.click(trigger);
  const translated = (await preferences.translate({label: title})).label;
  await until(() => preferences.window(translated), 'native color chooser opens');
  let snapshot = await preferences.inspect();
  let dialog = snapshot.windows.find(window => window.title === translated);
  let entry = dialog?.widgets.find(widget => widget.mapped && widget.type === 'GtkText' && HEX.test(widget.text));
  if (!entry) {
    const add = dialog?.widgets.find(widget => widget.mapped && widget.type === 'GtkImage'
      && widget.icon === 'list-add-symbolic');
    const swatch = dialog?.widgets.find(widget => widget.id === add?.parent);
    assert(swatch?.type === 'GtkColorSwatch', 'The native palette must offer an editable custom swatch');
    await preferences.click({id: swatch.id}, {windowTitle: translated});
    for (let attempt = 0; attempt < 50 && !entry; attempt++) {
      snapshot = await preferences.inspect();
      dialog = snapshot.windows.find(window => window.title === translated);
      entry = dialog?.widgets.find(widget => widget.mapped && widget.type === 'GtkText' && HEX.test(widget.text));
      if (!entry) await pause(20);
    }
  }
  assert(entry, `Color chooser must expose its editable hex color: ${JSON.stringify(dialog?.widgets
    .filter(widget => widget.mapped).map(({type, label, tooltip, text, icon}) => ({type, label, tooltip, text, icon})))}`);
  await preferences.click({id: entry.id}, {windowTitle: translated});
  await desktop.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
  await desktop.type(value);
  if (accept) {
    snapshot = await preferences.inspect();
    dialog = snapshot.windows.find(window => window.title === translated);
    // Gtk.ResponseType.OK identifies the real response without hard-coding a
    // translated GTK label or racing an already-closing dialog after Enter.
    const save = dialog.widgets.find(widget => widget.response === -5
      && widget.type === 'GtkButton' && widget.mapped && widget.sensitive);
    assert(save, 'Native color chooser must offer its Select response');
    await preferences.click({id: save.id}, {windowTitle: translated});
  } else {
    await desktop.key(Clutter.KEY_Escape);
  }
  await until(() => !preferences.window(translated), 'native color chooser completes');
}

export const cases = {
  async 'SET-03-system'(desktop) {
    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const saved = new Map(['color-scheme', 'accent-color'].map(key => [key, settings.get_value(key)]));
    const probe = new St.Widget({width: 1, height: 1, opacity: 0,
      style: 'background-color: -st-accent-color;'});
    const rgb = (actor, background = false) => {
      const node = actor.get_theme_node();
      const value = background ? node.get_background_color() : node.get_foreground_color();
      return [value.red, value.green, value.blue].join(',');
    };
    Main.layoutManager.addTopChrome(probe);
    try {
      desktop.settings.set_string('foreground-color', '#654321');
      desktop.settings.set_string('theme-color', '#123456');
      await desktop.open();
      const state = await desktop.words.createState(null, 'alpha beta');
      desktop.manager.show('tokenizer', state);
      await desktop.settle();
      const word = desktop.words.buttons[0];
      await desktop.click(word);
      await until(() => word.checked, 'native selected word exposes the active accent');
      const accents = settings.get_string('accent-color') === 'red' ? ['blue', 'red'] : ['red', 'blue'];
      for (const [index, accent] of accents.entries()) {
        const previous = rgb(probe, true);
        settings.set_string('color-scheme', index === 0 ? 'prefer-light' : 'prefer-dark');
        settings.set_string('accent-color', accent);
        await until(() => rgb(probe, true) !== previous, 'actual system accent propagates through the Shell theme');
        await Scripting.waitLeisure();
        assert(rgb(desktop.words.titleLabel) === '101,67,33' && rgb(word, true) === '18,52,86',
          'Changing the system scheme/accent must preserve the configured custom foreground and selection accent');
        assert(desktop.settings.get_string('foreground-color') === '#654321'
          && desktop.settings.get_string('theme-color') === '#123456' && desktop.words.buttons[0] === word,
        'System theme updates must not overwrite custom preferences or rebuild the selected word');
      }
      desktop.settings.set_string('foreground-color', '');
      desktop.settings.set_string('theme-color', 'system');
      await Scripting.waitLeisure();
      const previous = rgb(probe, true);
      settings.set_string('accent-color', 'green');
      await until(() => rgb(probe, true) !== previous && rgb(word, true) === rgb(probe, true),
        'Restoring system mode must make the selected word follow a subsequent real system accent update');
      assert(rgb(desktop.words.titleLabel) === rgb(desktop.indicator.menu.box)
        && desktop.words.buttons[0] === word && word.checked,
      'System mode must restore ordinary foreground inheritance without losing the live word selection');
    } finally {
      for (const [key, value] of saved) settings.set_value(key, value);
      Main.layoutManager.removeChrome(probe);
      probe.destroy();
      await desktop.close();
    }
  },

  async 'SET-03'(desktop) {
    const preferences = await Preferences.open(desktop);
    const color = () => desktop.settings.get_string('foreground-color');
    const accent = () => desktop.settings.get_string('theme-color');
    try {
      await preferences.page('general');
      await preferences.click({type: 'GtkToggleButton', tooltip: 'Green'});
      await until(() => accent() === 'green', 'built-in accent selected through GTK');
      assert(color() === '', 'Selecting an accent must not set a custom foreground');

      await choose(desktop, preferences, {type: 'GtkButton', tooltip: 'Add custom color'},
        'Choose custom theme color', '#123456', false);
      assert(accent() === 'green' && desktop.settings.get_strv('custom-theme-colors').length === 0,
        'Cancelling a custom accent must preserve both selection and saved palette');
      await choose(desktop, preferences, {type: 'GtkButton', tooltip: 'Add custom color'},
        'Choose custom theme color', '#123456', true);
      await until(() => accent() === '#123456', 'native chooser commits custom accent');
      assert(desktop.settings.get_strv('custom-theme-colors').includes('#123456') && color() === '',
        'Accepted accent must enter the saved palette without changing foreground');

      await choose(desktop, preferences, {type: 'GtkButton', row: 'Text and icon color', tooltip: 'Text and icon color'},
        'Text and icon color', '#654321', true);
      await until(() => color() === '#654321', 'native chooser commits text/icon foreground');
      assert(accent() === '#123456', 'Selecting a foreground must preserve the chosen accent');
      await choose(desktop, preferences, {type: 'GtkButton', row: 'Text and icon color', tooltip: 'Text and icon color'},
        'Text and icon color', '#abcdef', false);
      assert(color() === '#654321' && accent() === '#123456', 'Foreground cancellation must not modify either color');

      Main.activateWindow(preferences.window('Clipboard X Gnome'));
      await preferences.click({type: 'GtkToggleButton', tooltip: 'Follow system'});
      await until(() => accent() === 'system', 'system accent restored through palette');
      assert(color() === '#654321', 'Restoring the system accent must preserve custom foreground');
      await preferences.click({type: 'GtkButton', row: 'Text and icon color', tooltip: 'Follow system'});
      await until(() => color() === '', 'system foreground restored through reset button');
      assert(accent() === 'system', 'Restoring foreground must not change the accent');
    } finally { await preferences.close(); }
  },
};
