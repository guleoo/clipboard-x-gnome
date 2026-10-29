import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SHOW_DELAY_MILLISECONDS = 350;
const SCREEN_MARGIN = 8;

export class Tooltip {
  constructor() {
    this.actor = new St.Label({
      style_class: 'cbx-tooltip',
      visible: false,
      reactive: false,
    });
    this._source = null;
    this._mode = null;
    this._timeoutId = 0;
    this._connections = new Map();
    Main.uiGroup.add_child(this.actor);
  }

  setMode(mode, position = null) {
    this.hide();
    this._mode = mode;
    if (mode === 'keyboard') {
      this._showFor(global.stage.get_key_focus(), {immediate: true});
    } else if (mode === 'pointer') {
      const [x, y] = position ?? global.get_pointer();
      this._showFor(global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y));
    }
  }

  attach(actor, text) {
    actor.accessible_name = text;
    const existing = this._connections.get(actor);
    if (existing) {
      existing.text = text;
      if (this._source === actor && this.actor.visible)
        this.actor.text = text;
      return;
    }

    const signals = [
      actor.connect('notify::hover', () => {
        if (this._mode !== 'pointer')
          return;
        if (actor.hover)
          this.show(actor);
        else
          this.hide(actor);
      }),
      actor.connect('key-focus-in', () => {
        if (this._mode === 'keyboard')
          this.show(actor, {immediate: true});
      }),
      actor.connect('key-focus-out', () => {
        if (this._mode === 'keyboard')
          this.hide(actor);
      }),
      actor.connect('destroy', () => {
        if (this._source === actor)
          this.hide();
        this._connections.delete(actor);
      }),
    ];
    this._connections.set(actor, {text, signals});
  }

  show(actor, {immediate = false} = {}) {
    const mode = immediate ? 'keyboard' : 'pointer';
    if (this._mode !== mode || !this._connections.has(actor))
      return;
    this._cancelTimeout();
    const reveal = () => {
      this._timeoutId = 0;
      if (this._mode !== mode || !this._connections.has(actor) || !actor.mapped
          || !(immediate ? actor.has_key_focus?.() : actor.hover))
        return GLib.SOURCE_REMOVE;
      this._source = actor;
      this.actor.text = this._connections.get(actor)?.text ?? '';
      this.actor.show();
      Main.uiGroup.set_child_above_sibling(this.actor, null);
      this._place(actor);
      return GLib.SOURCE_REMOVE;
    };
    if (immediate) {
      reveal();
      return;
    }
    this._timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      SHOW_DELAY_MILLISECONDS,
      reveal,
    );
  }

  hide(actor = null) {
    if (actor && this._source && actor !== this._source)
      return;
    this._cancelTimeout();
    this._source = null;
    this.actor.hide();
  }

  clear() {
    this.hide();
    for (const [actor, connection] of this._connections) {
      for (const signal of connection.signals) {
        try {
          actor.disconnect(signal);
        } catch (_error) {
          // A panel refresh may already have destroyed the target actor.
        }
      }
      this._connections.delete(actor);
    }
  }

  destroy() {
    this._mode = null;
    this.clear();
    this.actor.destroy();
  }

  _showFor(actor, options = {}) {
    for (let target = actor; target; target = target.get_parent()) {
      if (this._connections.has(target)) {
        this.show(target, options);
        return;
      }
    }
  }

  _place(source) {
    const [sourceX, sourceY] = source.get_transformed_position();
    const [sourceWidth, sourceHeight] = source.get_transformed_size();
    const [, width] = this.actor.get_preferred_width(-1);
    const [, height] = this.actor.get_preferred_height(width);
    const x = Math.max(SCREEN_MARGIN, Math.min(
      global.stage.width - width - SCREEN_MARGIN,
      sourceX + (sourceWidth - width) / 2,
    ));
    const below = sourceY + sourceHeight + SCREEN_MARGIN;
    const y = below + height <= global.stage.height - SCREEN_MARGIN
      ? below
      : Math.max(SCREEN_MARGIN, sourceY - height - SCREEN_MARGIN);
    this.actor.set_position(Math.round(x), Math.round(y));
  }

  _cancelTimeout() {
    if (!this._timeoutId)
      return;
    GLib.Source.remove(this._timeoutId);
    this._timeoutId = 0;
  }
}
