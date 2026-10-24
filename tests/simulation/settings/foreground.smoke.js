import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {assert} from '../helpers/checks.js';
import {runNative} from '../helpers/native.js';

export function run() {
  return runNative(async ({indicator, settings, phrases, openPhrases, desktopSettings}) => {
    await phrases.replace(['Foreground identity fixture']);
    await openPhrases();
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
    assert(savedButton?.mapped, 'Foreground fixture must contain a visible content row');
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
  });
}
