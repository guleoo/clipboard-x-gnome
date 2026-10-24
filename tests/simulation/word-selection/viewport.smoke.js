import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {assert, waitUntil} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function clippedWordSelection(indicator) {
  const panel = indicator._tokenizer;
  const pointer = global.stage.context.get_backend().get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  let held = false;
  const center = actor => {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return [x + width / 2, y + height / 2];
  };
  const move = async point => {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), ...point);
    await Scripting.sleep(80);
  };
  const press = async button => {
    await move(center(button));
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    held = true;
    assert(await waitUntil(() => Boolean(panel._selectionDrag)), 'A native word press did not start selection');
  };
  const release = async () => {
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    held = false;
    assert(await waitUntil(() => !panel._selectionDrag) && panel._dragSourceId === 0,
      'Releasing a word drag must clear its selection timer');
  };
  try {
    indicator.menu.close();
    indicator._panelManager.show('history');
    assert(await waitUntil(() => !indicator.menu.actor.visible),
      'The previous menu must finish closing before the native drag scenario');
    Main.overview.hide();
    assert(await waitUntil(() => !Main.overview.visible && !Main.overview.animationInProgress),
      'Overview must close before native word dragging');
    for (let attempt = 0; attempt < 2; attempt++)
      await move([640, 360]);
    indicator._settings.set_int('panel-width', 360);
    indicator._settings.set_int('panel-height', 240);
    indicator._settings.set_boolean('tokenizer-show-source-preview', false);
    const state = await panel.createState(null,
      Array.from({length: 100}, (_, index) => `Word${index}`).join(' '));
    indicator.menu.open();
    indicator._panelManager.show('tokenizer', state);
    panel.focusStart();
    const geometry = () => `open=${indicator.menu.isOpen}, itemVisible=${panel.item.visible}, mapped=${panel.actor.mapped}, panelH=${panel.actor.height}, scrollH=${panel.scroll.height}`;
    assert(await waitUntil(() => indicator.menu.isOpen && panel.item.visible && panel.actor.mapped
        && Math.abs(panel.actor.height - 240) < 1 && panel.scroll.mapped
        && panel.scroll.height > 0 && panel.scroll.height < panel.actor.height),
      `The native drag menu must be open and have an allocated viewport (${geometry()})`);
    for (const edge of ['below', 'above']) {
      panel.scroll.get_vadjustment().remove_transition('value');
      panel.scroll.get_vadjustment().value = edge === 'below' ? 0 : 200;
      for (const button of panel.buttons)
        panel.setSelected(button, false, false);
      panel.updateResult();
      await Scripting.sleep(100);
      const [, top] = panel.scroll.get_transformed_position();
      const [, height] = panel.scroll.get_transformed_size();
      const visible = panel.buttons.filter(button => {
        const [, y] = center(button);
        return y > top + 5 && y < top + height - 5;
      }).sort((left, right) => Math.abs(center(left)[1] - top - height / 2)
        - Math.abs(center(right)[1] - top - height / 2));
      const clipped = panel.buttons.find(button => {
        const [, y] = center(button);
        return button.mapped && (edge === 'below'
          ? y > top + height + 20 && y < global.stage.height - 20
          : y < top - 5 && y > 5);
      });
      assert(visible.length > 1 && clipped,
        `The drag fixture needs visible words and mapped clipped words (edge=${edge}, top=${top}, height=${height}, visible=${visible.length}, clipped=${Boolean(clipped)}, tokens=${panel.buttons.length}, ${geometry()})`);
      await press(visible[0]);
      const selected = [...state.selected].sort().join();
      await move(center(clipped));
      assert([...state.selected].sort().join() === selected,
        `Dragging ${edge} the viewport must not select clipped words`);
      await move(center(visible[1]));
      assert(state.selected.has(visible[1]._clipboardXGnomeToken.index),
        'Returning inside the viewport must continue the original held selection');
      const returned = [...state.selected].sort().join();
      await move(center(clipped));
      await release();
      assert([...state.selected].sort().join() === returned,
        'Releasing outside the viewport must retain the last visible selection');
    }
    await press(panel.buttons.find(button => {
      const [, y] = center(button);
      const [, top] = panel.scroll.get_transformed_position();
      return y > top + 5 && y < top + panel.scroll.height - 5;
    }));
    indicator._panelManager.show('history');
    assert(!panel._selectionDrag && panel._dragSourceId === 0,
      'Leaving word selection during a native drag must stop its timer');
    await release();
  } finally {
    if (held)
      pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    panel.endSelectionDrag();
    indicator.menu.close();
    indicator._panelManager.reset();
  }
}

export function run() {
  return runChecks([['clippedWordSelection', clippedWordSelection]]);
}
