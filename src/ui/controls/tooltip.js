import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SHOW_DELAY_MILLISECONDS = 350;
const SCREEN_MARGIN = 8;

export class Tooltip {
  constructor() {
    this.actor = new St.Label({
      style_class: 'clipboard-x-tooltip',
      visible: false,
      reactive: false,
    });
    this._source = null;
    this._fromKeyboard = false;
    this._timeoutId = 0;
    this._connections = new Map();
    this._stageSignal = global.stage.connect('captured-event', (_stage, event) =>
      this._handleCapturedEvent(event));
    Main.uiGroup.add_child(this.actor);
  }

  attach(actor, text, {scope = 'global'} = {}) {
    actor._hintText = text;
    actor.accessible_name = text;
    const existing = this._connections.get(actor);
    if (existing) {
      existing.scope = scope;
      if (this._source === actor && this.actor.visible)
        this.actor.text = text;
      return;
    }

    const signals = [
      actor.connect('notify::hover', () => {
        if (actor.hover)
          this.show(actor);
        else if (!actor.has_key_focus?.())
          this.hide(actor);
      }),
      actor.connect('key-focus-in', () => this.show(actor, {immediate: true})),
      actor.connect('key-focus-out', () => {
        if (!actor.hover)
          this.hide(actor);
      }),
      actor.connect('destroy', () => {
        if (this._source === actor)
          this.hide();
        this._connections.delete(actor);
      }),
    ];
    this._connections.set(actor, {scope, signals});
  }

  show(actor, {immediate = false} = {}) {
    this._cancelTimeout();
    const reveal = () => {
      this._timeoutId = 0;
      if (!actor.mapped || (!actor.hover && !actor.has_key_focus?.()))
        return GLib.SOURCE_REMOVE;
      this._source = actor;
      this._fromKeyboard = immediate;
      this.actor.text = actor._hintText;
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
    this._fromKeyboard = false;
    this.actor.hide();
  }

  clear(scope = null) {
    this.hide();
    for (const [actor, connection] of this._connections) {
      if (scope && connection.scope !== scope)
        continue;
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
    this.clear();
    if (this._stageSignal)
      global.stage.disconnect(this._stageSignal);
    this._stageSignal = 0;
    this.actor.destroy();
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

  _handleCapturedEvent(event) {
    if (event.type() === Clutter.EventType.MOTION && this._fromKeyboard)
      this.hide();
    return Clutter.EVENT_PROPAGATE;
  }

  _cancelTimeout() {
    if (!this._timeoutId)
      return;
    GLib.Source.remove(this._timeoutId);
    this._timeoutId = 0;
  }
}
