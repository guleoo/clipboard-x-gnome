import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (predicate())
      return;
    await Scripting.sleep(50);
  }
  throw new Error(message);
}

export async function run() {
  await waitUntil(() => Boolean(Main.panel.statusArea['clipboard-x-gnome']),
    'Extension did not initialize');
  const indicator = Main.panel.statusArea['clipboard-x-gnome'];
  await indicator._actions.extensionObject._startup;
  const panel = indicator._tokenizer;
  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  let held = false;
  const move = async button => {
    const [x, y] = button.get_transformed_position();
    const [width, height] = button.get_transformed_size();
    assert(y >= 0 && x >= 0 && width > 0 && height > 0,
      `Invalid pointer target (${x},${y},${width},${height}; menu=${indicator.menu.isOpen})`);
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
    await Scripting.sleep(80);
    const [pointerX, pointerY] = global.get_pointer();
    assert(pointerX >= x && pointerX < x + width && pointerY >= y && pointerY < y + height,
      'Pointer did not reach the word before selection');
  };
  const press = async button => {
    await move(button);
    held = true;
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    try {
      await waitUntil(() => Boolean(panel._selectionDrag), 'Mouse press did not start selection');
    } catch (error) {
      throw new Error(`${error.message}; pointer=${global.get_pointer()}; pressed=${button.pressed}; hover=${button.hover}; menu=${indicator.menu.isOpen}`);
    }
  };
  const release = async () => {
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    held = false;
    await waitUntil(() => !panel._selectionDrag, 'Mouse release left selection active');
  };
  let state;
  let buttons;
  const prepare = async (selected = [], width = 420, source = 'A B C D') => {
    indicator._settings.set_int('panel-width', width);
    state = await panel.createState(null, source);
    for (const index of selected)
      state.selected.add(index);
    indicator._panelManager.show('tokenizer', state);
    indicator.menu.open();
    await Scripting.sleep(100);
    buttons = panel.buttons;
    assert(buttons.length === 4, 'Expected four selectable words');
    await waitUntil(() => buttons.every(button => button.mapped && button.width > 0),
      `Words are not laid out (menu=${indicator.menu.isOpen}, panel=${indicator._panelManager.currentName})`);
  };
  const expect = (indexes, message) => {
    assert([...state.selected].sort().join(',') === indexes.join(','), message);
    assert(buttons.every(button => button.checked === state.selected.has(button._clipboardXGnomeToken.index)),
      'Word visuals disagree with selection state');
  };
  const originalWidth = indicator._settings.get_int('panel-width');
  Main.overview.hide();
  await waitUntil(() => !Main.overview.visible && !Main.overview.animationInProgress,
    'Overview did not close');
  // The initial pointer is inside the hot-corner barrier on headless Shell.
  // Move away before opening the menu so the first target is not constrained.
  for (let attempt = 0; attempt < 2; attempt++) {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 640, 360);
    await Scripting.sleep(100);
  }
  indicator.menu.open();
  await Scripting.sleep(150);
  try {
    await prepare();
    await press(buttons[0]);
    await release();
    expect([0], 'A single click must select A once');
    await move(buttons[2]);
    expect([0], 'Moving without holding the mouse must not select more words');
    await press(buttons[0]);
    await release();
    expect([], 'A second click must deselect A once');

    await prepare();
    await press(buttons[0]);
    await move(buttons[2]);
    expect([0, 1, 2], 'A to C must select ABC, including skipped words');
    await release();
    await move(buttons[3]);
    expect([0, 1, 2], 'Hover after releasing must not select D');

    await prepare();
    await press(buttons[0]);
    await move(buttons[2]);
    await move(buttons[1]);
    expect([0, 1], 'Dragging back from C to B must shrink the selection to AB');
    await release();

    await prepare([0, 1, 2]);
    await press(buttons[0]);
    await move(buttons[2]);
    expect([], 'Dragging from selected A to C must deselect ABC');
    await move(buttons[1]);
    expect([2], 'Shrinking a deselection must restore C to its original state');
    await move(buttons[2]);
    await release();
    expect([], 'Re-extending a deselection must deselect ABC');

    await prepare([3]);
    await press(buttons[2]);
    await move(buttons[0]);
    expect([0, 1, 2, 3], 'Reverse dragging must select ABC and preserve D');
    await move(buttons[1]);
    await release();
    expect([1, 2, 3], 'Reverse backtracking must restore A and preserve D');

    await prepare([], 320, 'Aaaaaaaaaa Bbbbbbbbbb Cccccccccc Dddddddddd');
    assert(buttons[0].get_parent() !== buttons[2].get_parent(), 'Expected words on multiple rows');
    await press(buttons[0]);
    await move(buttons[2]);
    expect([0, 1, 2], 'Selection across rows must include every word in the range');
    await move(buttons[1]);
    await release();
    expect([0, 1], 'Backtracking across rows must shrink the range');

    await prepare();
    await press(buttons[0]);
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 1, 1);
    await Scripting.sleep(80);
    await release();
    expect([0], 'Releasing outside the panel must end selection without changing other words');

    await prepare();
    await press(buttons[0]);
    panel.leave();
    assert(!panel._selectionDrag && panel._dragSourceId === 0, 'Leaving must cancel selection and its timer');
    await release();

    await prepare();
    buttons[0].grab_key_focus();
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_space, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_space, Clutter.KeyState.RELEASED);
    await waitUntil(() => state.selected.has(0), 'Keyboard activation stopped selecting words');
    assert(!panel._selectionDrag, 'Keyboard activation must not start mouse selection');
  } finally {
    if (held)
      pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    panel.endSelectionDrag();
    indicator.menu.close();
    indicator._settings.set_int('panel-width', originalWidth);
  }
}
