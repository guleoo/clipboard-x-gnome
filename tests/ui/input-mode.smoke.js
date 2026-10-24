import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x-gnome@guleoo.github.io';
function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}
async function until(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate())
      return;
    await Scripting.sleep(20);
  }
  throw new Error(message);
}

export async function verify(indicator) {
  const settings = indicator._settings;
  const keys = ['panel-shortcut', 'panel-toolbar-actions', 'panel-hidden-actions', 'preserve-panel-state', 'private-mode'];
  const saved = new Map(keys.map(key => [key, settings.get_value(key)]));
  const history = indicator._historyPanel;
  const tooltip = indicator._tooltip;
  const seat = global.stage.context.get_backend().get_default_seat();
  const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const focus = () => global.stage.get_key_focus();
  const key = async (symbol, modifiers = []) => {
    for (const modifier of modifiers)
      keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
    for (const modifier of [...modifiers].reverse())
      keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.RELEASED);
    await Scripting.sleep(35);
  };
  const move = async (x, y) => {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    await Scripting.sleep(50);
  };
  const center = actor => {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return [x + width / 2, y + height / 2];
  };
  const click = async () => {
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(50);
  };
  const toggle = () => key(Clutter.KEY_F8, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]);
  let wordItem = null;
  try {
    indicator.menu.close();
    settings.set_strv('panel-shortcut', ['<Control><Shift>F8']);
    settings.reset('panel-toolbar-actions');
    settings.set_strv('panel-hidden-actions', []);
    settings.set_boolean('preserve-panel-state', false);
    await until(() => !Main.layoutManager._startingUp, 'Shell startup did not finish');
    // A newly created virtual pointer starts on the hot corner; move it away
    // before hiding the Overview its pressure barrier can open asynchronously.
    await move(global.stage.width / 2, global.stage.height / 2);
    Main.overview.hide();
    await until(() => !Main.overview.visible && !Main.overview.animationInProgress, 'Overview did not close');
    await move(global.stage.width / 2, global.stage.height - 120);
    await toggle();
    await until(() => indicator.menu.isOpen && focus() === history.searchEntry.clutter_text, 'Keyboard open did not focus search');
    await until(() => indicator.menu.actor.opacity === 255
      && !indicator.menu.actor.get_transition('opacity')
      && !indicator.menu.actor.get_transition('scale-x')
      && !indicator.menu.actor.get_transition('scale-y')
      && !history._focusIdleId, 'Opening animation did not settle');
    await key(Clutter.KEY_Right);
    await until(() => focus() === history.screenshotButton && tooltip.actor.visible, 'Keyboard navigation did not show icon help');
    await move(60, global.stage.height - 70);
    await until(() => !tooltip.actor.visible, 'Actual mouse movement left the keyboard tooltip visible');
    assert(focus() === history.screenshotButton, 'Pointer movement must not change keyboard focus');

    await move(...center(history.screenshotButton));
    await until(() => tooltip.actor.visible && tooltip._source === history.screenshotButton, 'Pointer hover did not show help');
    const pointerPosition = global.get_pointer().slice(0, 2);
    await key(Clutter.KEY_Right);
    assert(focus() === history.colorButton, 'Keyboard must resume from its existing focus');
    await Scripting.sleep(400);
    assert(tooltip._source === history.colorButton && indicator._inputMode.mode === 'keyboard',
      'Stationary pointer must not compete with the keyboard tooltip');
    assert(global.get_pointer().slice(0, 2).every((value, index) => value === pointerPosition[index]),
      'Keyboard navigation must not warp the pointer');
    const hoverAlpha = history.screenshotButton.get_theme_node().get_background_color().alpha;
    const focusAlpha = history.colorButton.get_theme_node().get_background_color().alpha;
    assert(hoverAlpha < focusAlpha, 'Stationary hover must not remain highlighted in keyboard mode');

    await move(...center(history.phrasesButton));
    assert(focus() === history.phrasesButton, 'Actual pointer movement must hand keyboard focus to its target');
    await move(...center(history.colorButton));
    assert(focus() === history.colorButton, 'Further pointer movement must update focus even in pointer mode');
    await key(Clutter.KEY_Right);
    assert(focus() === history.phrasesButton, 'The first keyboard arrow must navigate from the last pointer target');

    // A pending pointer timer must not later replace help for the new keyboard target.
    await move(80, global.stage.height - 80);
    await move(...center(history.screenshotButton));
    await key(Clutter.KEY_Right);
    await Scripting.sleep(400);
    assert(focus() === history.colorButton && tooltip._source === history.colorButton,
      'A stale pointer timer replaced the keyboard tooltip');
    settings.set_strv('panel-toolbar-actions', ['quick-phrases', 'color-picker', 'screenshot']);
    await Scripting.sleep(400);
    assert(indicator._inputMode.mode === 'keyboard', 'Layout-generated hover must not change input mode');
    assert(!tooltip.actor.visible || tooltip._source === focus(), 'Layout-generated hover showed help for the wrong target');

    await key(Clutter.KEY_f, [Clutter.KEY_Control_L]);
    for (const character of 'abc')
      await key(Clutter.unicode_to_keysym(character.codePointAt(0)));
    await key(Clutter.KEY_Left);
    await key(Clutter.KEY_Left);
    const cursor = history.searchEntry.clutter_text.get_cursor_position();
    await move(...center(history.colorButton));
    assert(focus() === history.searchEntry.clutter_text
        && history.searchEntry.clutter_text.get_cursor_position() === cursor,
      'Pointer hover must preserve the entry focus and caret');
    await key(Clutter.KEY_x);
    assert(history.searchEntry.get_text() === 'axbc', 'Typing after pointer movement must use the preserved caret');
    assert(indicator._inputMode.mode === 'keyboard' && !tooltip.actor.visible,
      'Typing must cancel pointer help without removing the caret');

    // Programmatic focus is setup only; actual keys choose the interaction mode.
    await move(...center(history.privateButton));
    history.privateButton.grab_key_focus();
    await key(Clutter.KEY_Right);
    await key(Clutter.KEY_Left);
    assert(focus() === history.privateButton && indicator._inputMode.mode === 'keyboard', 'Private icon fixture lost focus');
    const privateBefore = settings.get_boolean('private-mode');
    await click();
    assert(indicator._inputMode.mode === 'pointer' && settings.get_boolean('private-mode') !== privateBefore,
      'Clicking an already-focused icon must switch to pointer mode and activate it once');
    await until(() => tooltip.actor.visible && tooltip._source === history.privateButton, 'Same-focus click did not restore pointer help');

    await move(...center(history.phrasesButton));
    await click();
    await until(() => indicator._panelManager.is('phrases'), 'Pointer did not open quick phrases');
    assert(!tooltip.actor.visible && tooltip._timeoutId === 0, 'Panel switching must cancel old tooltip work');
    await key(Clutter.KEY_Right);
    assert(indicator._inputMode.mode === 'keyboard', 'Secondary panels must share the input mode');
    await move(...center(indicator._quickPhrases.backButton));
    await key(Clutter.KEY_Right);
    assert(focus() === indicator._quickPhrases.addButton, 'Quick phrases must navigate from the pointer target');
    await move(...center(indicator._quickPhrases.backButton));
    await click();
    const app = Main.extensionManager.lookup(UUID).stateObj;
    const {ClipboardItem} = await import(`${app.dir.get_uri()}/clipboard/item.js`);
    wordItem = ClipboardItem.fromText('Input mode alpha beta gamma delta');
    indicator._controller.add(wordItem);
    await key(Clutter.KEY_f, [Clutter.KEY_Control_L]);
    await key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
    for (const character of 'Input mode alpha')
      await key(Clutter.unicode_to_keysym(character.codePointAt(0)));
    await until(() => history._itemRows.has(wordItem.id) && !history._focusIdleId, 'Word fixture did not appear in search');
    await key(Clutter.KEY_Down);
    const row = history._itemRows.get(wordItem.id);
    const pin = row.focusActors.find(actor => actor._clipboardXGnomeEntryAction === 'pin');
    const tokenize = row.focusActors.find(actor => actor._clipboardXGnomeEntryAction === 'tokenize');
    await move(...center(pin));
    assert(focus() === pin, 'History action hover must become the keyboard target');
    await key(Clutter.KEY_Left);
    assert(focus() === tokenize, 'History navigation must continue from its hovered action');
    await key(Clutter.KEY_Return);
    await until(() => indicator._panelManager.is('tokenizer'), 'Native word action did not open word selection');
    const words = indicator._tokenizer;
    await key(Clutter.KEY_Right);
    await key(Clutter.KEY_space);
    const selected = words.buttons[0];
    const color = actor => {
      const value = actor.get_theme_node().get_background_color();
      return [value.red, value.green, value.blue, value.alpha].join(',');
    };
    const selectedColor = color(selected);
    await move(...center(words.buttons[2]));
    assert(focus() === words.buttons[2], 'Word hover must hand off keyboard focus');
    await key(Clutter.KEY_space);
    assert(words.buttons[2].checked, 'Activation without an intervening arrow must use the pointer target');
    await key(Clutter.KEY_Right);
    assert(focus() === words.buttons[3] && indicator._inputMode.mode === 'keyboard',
      `Word buttons must share keyboard mode (mode=${indicator._inputMode.mode}, focus=${focus()}, source=${words.state.source}, tokens=${words.buttons.length})`);
    await key(Clutter.KEY_space);
    assert(words.buttons[3].checked, 'The first activation must use the pointer-derived keyboard target');
    assert(selected.checked && color(selected) === selectedColor, 'Input mode must not change a selected word or its accent');
    const [x, y] = global.get_pointer();
    await move(x, y);
    assert(indicator._inputMode.mode === 'keyboard', 'Same-position motion must not revive stationary hover');
    await toggle();
    assert(!indicator.menu.isOpen && !tooltip.actor.visible && tooltip._timeoutId === 0
        && indicator._inputMode._filterId === 0,
      'Closing must remove input monitoring and tooltip work');
    await toggle();
    assert(indicator._inputMode.mode === 'keyboard', 'The opening shortcut must seed keyboard mode');
    await toggle();
    await until(() => !indicator.menu.actor.visible, 'Popup did not finish closing');
    await move(...center(indicator));
    await click();
    assert(indicator.menu.isOpen && indicator._inputMode.mode === 'pointer', 'Topbar click must seed pointer mode');
    indicator.menu.close();
    await until(() => !indicator.menu.actor.visible, 'Topbar popup did not finish closing');
    indicator.grab_key_focus();
    await key(Clutter.KEY_Return);
    assert(indicator.menu.isOpen && indicator._inputMode.mode === 'keyboard', 'Topbar keyboard activation must seed keyboard mode');
    indicator.menu.close();
    print('PASS shared input mode: real keys, pointer, stale hover/timers, caret, click and lifecycle');
  } finally {
    indicator.menu.close();
    if (wordItem)
      indicator._controller.remove(wordItem.id);
    for (const [name, value] of saved)
      settings.set_value(name, value);
  }
}

export async function run() {
  await until(() => Main.panel.statusArea['clipboard-x-gnome'], 'Extension did not enable');
  const app = Main.extensionManager.lookup(UUID).stateObj;
  await app._startup;
  try {
    await verify(app._indicator);
  } finally {
    Main.extensionManager.disableExtension(UUID);
    await app._shutdown;
  }
}
