import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {capture} from '../../src/ui/settings/shortcut-capture.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const control = Gdk.ModifierType.CONTROL_MASK;
const shift = Gdk.ModifierType.SHIFT_MASK;
const alt = Gdk.ModifierType.ALT_MASK;

assert(capture(Gdk.KEY_Control_L, 37, 0).action === 'wait',
  'pressing a modifier alone must not finish shortcut capture');
assert(capture(Gdk.KEY_Shift_L, 50, shift).action === 'wait',
  'a held modifier must not be saved as a single-key shortcut');
assert(capture(Gdk.KEY_f, 41, control).accelerator === '<Control>f',
  'Ctrl+F must be captured as a combination');
assert(capture(Gdk.KEY_F, 41, control | shift).accelerator === '<Shift><Control>f',
  'Ctrl+Shift+F must retain both modifiers');
assert(capture(Gdk.KEY_Return, 36, control, true).accelerator === '<Control>Return',
  'contextual Ctrl+Enter must use the format expected by the panel matcher');
assert(capture(Gdk.KEY_a, 38, 0, true).accelerator === 'a',
  'contextual single-key shortcuts must keep working');
assert(capture(Gdk.KEY_F1, 67, alt).action === 'save',
  'Alt+function-key combinations must be accepted');
assert(capture(0, 0, 0).action === 'invalid',
  'an invalid global shortcut must leave the recorder open for another attempt');
assert(capture(Gdk.KEY_Escape, 9, 0).action === 'cancel',
  'Escape must cancel recording');
assert(capture(Gdk.KEY_BackSpace, 22, 0).action === 'clear',
  'Backspace must disable the shortcut');
assert(capture(Gdk.KEY_BackSpace, 22, control).action === 'save',
  'Ctrl+Backspace must be recorded instead of disabling the shortcut');
assert(Gtk.accelerator_parse(capture(Gdk.KEY_F, 41, control | shift).accelerator)[0],
  'recorded global shortcut must be parseable by GTK');
