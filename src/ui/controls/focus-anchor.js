import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const NAVIGATION_KEYS = new Set([
  Clutter.KEY_Left,
  Clutter.KEY_Right,
  Clutter.KEY_Up,
  Clutter.KEY_Down,
  Clutter.KEY_KP_Left,
  Clutter.KEY_KP_Right,
  Clutter.KEY_KP_Up,
  Clutter.KEY_KP_Down,
]);
const NAVIGATION_MODIFIER_MASK = Clutter.ModifierType.SHIFT_MASK
  | Clutter.ModifierType.CONTROL_MASK
  | Clutter.ModifierType.MOD1_MASK
  | Clutter.ModifierType.MOD4_MASK
  | Clutter.ModifierType.SUPER_MASK
  | Clutter.ModifierType.HYPER_MASK
  | Clutter.ModifierType.META_MASK;

export const FocusAnchor = GObject.registerClass(
class FocusAnchor extends St.Widget {
  _init({onNavigate = () => null, onKeyPress = () => Clutter.EVENT_PROPAGATE} = {}) {
    super._init({
      can_focus: true,
      reactive: true,
      opacity: 0,
      width: 0,
      height: 0,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.START,
    });
    this._clipboardXControlType = 'focus-anchor';
    this._onNavigate = onNavigate;
    this._onKeyPress = onKeyPress;
    this._focusIdleId = 0;
    this.connect('key-press-event', (_actor, event) => this.handle(event));
  }

  focus() {
    this.cancel();
    this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._focusIdleId = 0;
      if (this.mapped)
        this.grab_key_focus();
      return GLib.SOURCE_REMOVE;
    });
  }

  handle(event) {
    const navigation = NAVIGATION_KEYS.has(event.get_key_symbol())
      && (event.get_state() & NAVIGATION_MODIFIER_MASK) === 0;
    if (!navigation)
      return this._onKeyPress(event);
    this._onNavigate(event);
    return Clutter.EVENT_STOP;
  }

  cancel() {
    if (this._focusIdleId)
      GLib.Source.remove(this._focusIdleId);
    this._focusIdleId = 0;
  }

  destroy() {
    this.cancel();
    super.destroy();
  }
});
