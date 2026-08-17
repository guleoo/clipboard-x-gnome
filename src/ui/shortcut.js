import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

const MODIFIER_MASK = Clutter.ModifierType.SHIFT_MASK
  | Clutter.ModifierType.CONTROL_MASK
  | Clutter.ModifierType.MOD1_MASK
  | Clutter.ModifierType.MOD4_MASK
  | Clutter.ModifierType.SUPER_MASK
  | Clutter.ModifierType.HYPER_MASK
  | Clutter.ModifierType.META_MASK;
const KEYPAD_KEYS = new Map([
  [Clutter.KEY_KP_Enter, Clutter.KEY_Return],
  [Clutter.KEY_KP_Delete, Clutter.KEY_Delete],
  [Clutter.KEY_KP_Left, Clutter.KEY_Left],
  [Clutter.KEY_KP_Right, Clutter.KEY_Right],
  [Clutter.KEY_KP_Up, Clutter.KEY_Up],
  [Clutter.KEY_KP_Down, Clutter.KEY_Down],
]);

export function matches(settings, key, event) {
  const configured = settings.get_strv(key);
  if (configured.length === 0)
    return false;
  const accelerator = Meta.accelerator_name(
    event.get_state() & MODIFIER_MASK,
    normalizeKey(event.get_key_symbol()),
  );
  return configured.includes(accelerator);
}

function normalizeKey(key) {
  return KEYPAD_KEYS.get(key) ?? key;
}
