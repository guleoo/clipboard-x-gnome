// Run with Mutter's typelib and library directories in GI_TYPELIB_PATH and
// LD_LIBRARY_PATH. Unlike the GTK-only capture unit test, this checks Shell's
// actual accelerator matcher without opening a display or reading GSettings.
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

import {capture} from '../../src/ui/settings/shortcut-capture.js';
import {matches} from '../../src/ui/shortcut.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const control = Gdk.ModifierType.CONTROL_MASK;
const shift = Gdk.ModifierType.SHIFT_MASK;
const alt = Gdk.ModifierType.ALT_MASK;
let checked = 0;
for (const [keypad, regular] of [
  [Gdk.KEY_KP_Enter, Gdk.KEY_Return],
  [Gdk.KEY_KP_Delete, Gdk.KEY_Delete],
  [Gdk.KEY_KP_Left, Gdk.KEY_Left],
  [Gdk.KEY_KP_Right, Gdk.KEY_Right],
  [Gdk.KEY_KP_Up, Gdk.KEY_Up],
  [Gdk.KEY_KP_Down, Gdk.KEY_Down],
]) {
  for (const modifiers of [0, control, shift, control | shift, alt]) {
    const recorded = capture(keypad, 0, modifiers, true);
    assert(recorded.action === 'save', `${Gdk.keyval_name(keypad)} must be recordable`);
    const settings = {get_strv: () => [recorded.accelerator]};
    for (const symbol of [keypad, regular]) {
      assert(matches(settings, 'test-shortcut', {
        get_key_symbol: () => symbol,
        get_state: () => modifiers,
      }), `${recorded.accelerator} must match ${Gdk.keyval_name(symbol)}`);
    }
    assert(!matches(settings, 'test-shortcut', {
      get_key_symbol: () => keypad,
      get_state: () => modifiers ^ control,
    }), `${recorded.accelerator} must not match different modifiers`);

    // Existing ordinary-key defaults must still accept the equivalent keypad key.
    assert(matches({get_strv: () => [Gtk.accelerator_name(regular, modifiers)]}, 'test-shortcut', {
      get_key_symbol: () => keypad,
      get_state: () => modifiers,
    }), `Ordinary ${Gdk.keyval_name(regular)} must still match its keypad equivalent`);
    checked++;
  }
}
print(`PASS ${checked} contextual capture-to-Shell-match cases`);
