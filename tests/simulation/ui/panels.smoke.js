import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate())
      return;
    await Scripting.sleep(30);
  }
  throw new Error(message);
}

export async function run() {
  await waitUntil(() => Main.panel.statusArea['clipboard-x-gnome'], 'Extension did not start');
  await Main.extensionManager.lookup('clipboard-x-gnome@guleoo.github.io').stateObj._startup;
  const indicator = Main.panel.statusArea['clipboard-x-gnome'];
  const settings = indicator._settings;
  const phrases = indicator._quickPhrases;
  await phrases.ready;
  const originalPhrases = [...phrases.phrases];
  const originalEscape = settings.get_string('panel-escape-action');
  const originalColor = settings.get_string('foreground-color');
  const desktopSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
  const originalScheme = desktopSettings.get_string('color-scheme');
  const seat = global.stage.context.get_backend().get_default_seat();
  const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const key = async symbol => {
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
    await Scripting.sleep(80);
  };
  const click = async actor => {
    await waitUntil(() => actor.mapped && actor.width > 0, 'Button was not laid out');
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
    await Scripting.sleep(80);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(80);
  };
  const openPhrases = async () => {
    indicator.menu.open();
    indicator._openPhrases();
    await Scripting.sleep(100);
  };
  Main.overview.hide();
  await waitUntil(() => !Main.overview.visible && !Main.overview.animationInProgress, 'Overview did not close');
  pointer.notify_absolute_motion(GLib.get_monotonic_time(), 640, 360);
  await Scripting.sleep(100);
  try {
    assert(originalEscape === 'back', 'Secondary panels must return to history by default');
    for (const action of ['back', 'close']) {
      settings.set_string('panel-escape-action', action);
      await openPhrases();
      await click(phrases.addButton);
      phrases.entry.set_text('Discard this draft');
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

    await openPhrases();
    for (const mode of ['enter', 'button']) {
      await click(phrases.addButton);
      const phrase = `Saved with ${mode}`;
      phrases.entry.set_text(phrase);
      phrases.entry.clutter_text.set_selection(1, 1);
      await key(Clutter.KEY_Right);
      assert(global.stage.get_key_focus() === phrases.entry.clutter_text
        && phrases.entry.clutter_text.get_cursor_position() === 2,
      'The new save button must not steal arrows inside the draft');
      phrases.entry.clutter_text.set_selection(-1, -1);
      await key(Clutter.KEY_Right);
      assert(global.stage.get_key_focus() === phrases.saveButton,
        'Right at the draft end must reach its save button');
      phrases.entry.clutter_text.grab_key_focus();
      if (mode === 'enter')
        await key(Clutter.KEY_Return);
      else
        await click(phrases.saveButton);
      await waitUntil(() => phrases.phrases.includes(phrase) && !phrases.formVisible,
        `${mode}: phrase was not saved and form was not closed`);
      assert(phrases.entry.get_text() === '', `${mode}: draft was not cleared`);
    }
    print('Quick phrase native Enter and save button passed');

    settings.set_string('foreground-color', '#123456');
    await Scripting.sleep(100);
    const color = actor => {
      const value = actor.get_theme_node().get_foreground_color();
      return [value.red, value.green, value.blue].join(',');
    };
    assert(color(phrases.header.titleLabel) === '18,52,86'
      && color(phrases.addButton.get_child()) === '18,52,86',
    `Custom foreground must reach text and icons (title=${color(phrases.header.titleLabel)}, icon=${color(phrases.addButton.get_child())})`);
    const savedButton = phrases.buttons[0];
    settings.set_string('foreground-color', '#654321');
    await Scripting.sleep(100);
    assert(phrases.buttons[0] === savedButton, 'Color changes must not rebuild the content');
    assert(color(phrases.header.titleLabel) === '101,67,33', 'Foreground must update live');
    indicator._panelManager.reset();
    await Scripting.sleep(100);
    assert(color(indicator._historyPanel.searchEntry) === '101,67,33', 'Search must inherit custom foreground');
    const state = await indicator._tokenizer.createState(null, 'A B C');
    indicator._panelManager.show('tokenizer', state);
    await Scripting.sleep(100);
    assert(color(indicator._tokenizer.buttons[0]) === '101,67,33', 'Unselected words must inherit custom foreground');
    settings.set_string('foreground-color', 'not a CSS color; width: 9000px');
    await Scripting.sleep(100);
    assert(!indicator.menu.box.get_style().includes('9000'), 'Invalid foreground must not inject arbitrary CSS');
    settings.reset('foreground-color');
    await Scripting.sleep(100);
    assert(!indicator.menu.box.get_style().includes('color:'), 'System mode must remove the foreground override');
    for (const scheme of ['prefer-light', 'prefer-dark']) {
      desktopSettings.set_string('color-scheme', scheme);
      await Scripting.sleep(200);
      const foreground = color(indicator.menu.box);
      assert(color(indicator._tokenizer.buttons[0]) === foreground,
        `${scheme}: words must follow the actual Shell foreground`);
      indicator._panelManager.reset();
      await Scripting.sleep(100);
      assert(color(indicator._historyPanel.searchEntry) === foreground,
        `${scheme}: search must follow the actual Shell foreground`);
      await openPhrases();
      assert(color(phrases.header.titleLabel) === foreground
        && color(phrases.addButton.get_child()) === foreground,
      `${scheme}: secondary text and icons must follow the actual Shell foreground`);
      indicator._panelManager.show('tokenizer', state);
      await Scripting.sleep(100);
    }
    print('Shared panel foreground: live update, text/icons, no content rebuild, and system reset passed');
  } finally {
    await phrases.replace(originalPhrases);
    settings.set_string('panel-escape-action', originalEscape);
    settings.set_string('foreground-color', originalColor);
    desktopSettings.set_string('color-scheme', originalScheme);
    indicator.menu.close();
  }
}
