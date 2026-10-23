import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

import {normalize as normalizeKey} from '../common/keysyms.js';

const MODIFIER_MASK = Clutter.ModifierType.SHIFT_MASK
  | Clutter.ModifierType.CONTROL_MASK
  | Clutter.ModifierType.MOD1_MASK
  | Clutter.ModifierType.MOD4_MASK
  | Clutter.ModifierType.SUPER_MASK
  | Clutter.ModifierType.HYPER_MASK
  | Clutter.ModifierType.META_MASK;

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
