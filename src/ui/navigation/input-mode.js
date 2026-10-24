import Clutter from 'gi://Clutter';

const MODIFIERS = new Set([
  Clutter.KEY_Shift_L, Clutter.KEY_Shift_R,
  Clutter.KEY_Control_L, Clutter.KEY_Control_R,
  Clutter.KEY_Alt_L, Clutter.KEY_Alt_R,
  Clutter.KEY_Super_L, Clutter.KEY_Super_R,
  Clutter.KEY_Meta_L, Clutter.KEY_Meta_R,
  Clutter.KEY_ISO_Level3_Shift,
]);

// Presentation only: neither pointer motion nor mode changes move key focus.
export class InputMode {
  constructor(actor, onChanged) {
    this._actor = actor;
    this._onChanged = onChanged;
    this._filterId = 0;
    this._pointer = null;
    this._mode = null;
  }

  get mode() {
    return this._mode;
  }

  open(mode = 'pointer') {
    this.close();
    this._pointer = global.get_pointer().slice(0, 2);
    this._setMode(mode);
    // Stage captured-event does not observe every pointer motion in a popup.
    this._filterId = Clutter.Event.add_filter(null, event => {
      const type = event.type();
      if (type === Clutter.EventType.MOTION) {
        const point = event.get_coords();
        if (point[0] !== this._pointer[0] || point[1] !== this._pointer[1]) {
          this._pointer = point;
          this._setMode('pointer', point);
        }
      } else if (type === Clutter.EventType.BUTTON_PRESS
          || type === Clutter.EventType.SCROLL
          || type === Clutter.EventType.TOUCH_BEGIN) {
        this._pointer = event.get_coords();
        this._setMode('pointer', this._pointer);
      }
      return Clutter.EVENT_PROPAGATE;
    });
  }

  keyboard(symbol) {
    if (!this._filterId || MODIFIERS.has(symbol))
      return;
    this._pointer = global.get_pointer().slice(0, 2);
    this._setMode('keyboard');
  }

  close() {
    if (this._filterId)
      Clutter.Event.remove_filter(this._filterId);
    this._filterId = 0;
    if (this._mode !== null) {
      this._mode = null;
      this._onChanged(null);
    }
  }

  destroy() {
    this.close();
    this._onChanged = null;
    this._actor = null;
    this._pointer = null;
  }

  _setMode(mode, position = null) {
    if (this._mode === mode)
      return;
    this._mode = mode;
    this._actor.remove_style_class_name(mode === 'keyboard' ? 'cbx-pointer' : 'cbx-keyboard');
    this._actor.add_style_class_name(`cbx-${mode}`);
    this._onChanged(mode, position);
  }
}
