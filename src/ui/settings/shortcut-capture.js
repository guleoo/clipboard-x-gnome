import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

const MODIFIER_KEYS = new Set([
  Gdk.KEY_Shift_L,
  Gdk.KEY_Shift_R,
  Gdk.KEY_Control_L,
  Gdk.KEY_Control_R,
  Gdk.KEY_Alt_L,
  Gdk.KEY_Alt_R,
  Gdk.KEY_Meta_L,
  Gdk.KEY_Meta_R,
  Gdk.KEY_Super_L,
  Gdk.KEY_Super_R,
  Gdk.KEY_Hyper_L,
  Gdk.KEY_Hyper_R,
  Gdk.KEY_ISO_Level3_Shift,
]);

export function capture(keyval, keycode, state, contextual = false) {
  if (MODIFIER_KEYS.has(keyval))
    return {action: 'wait'};

  const modifiers = state & Gtk.accelerator_get_default_mod_mask()
    & ~Gdk.ModifierType.LOCK_MASK;
  if (modifiers === 0 && keyval === Gdk.KEY_Escape)
    return {action: 'cancel'};
  if (modifiers === 0 && keyval === Gdk.KEY_BackSpace)
    return {action: 'clear'};

  const valid = Gtk.accelerator_valid(keyval, modifiers)
    || (contextual && modifiers === 0 && keyval !== 0)
    || (keyval === Gdk.KEY_Tab && modifiers !== 0);
  if (!valid)
    return {action: 'invalid'};

  return {
    action: 'save',
    accelerator: contextual
      ? Gtk.accelerator_name(keyval, modifiers)
      : Gtk.accelerator_name_with_keycode(null, keyval, keycode, modifiers),
  };
}
