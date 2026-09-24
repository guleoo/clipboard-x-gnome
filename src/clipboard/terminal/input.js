import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {typingDelay, typingSequence, typingTiming} from './sequence.js';

const INPUT_POLL_MILLISECONDS = 20;
const INPUT_WAIT_TIMEOUT_MILLISECONDS = 10_000;
const COMMAND_MODIFIER_MASK = Clutter.ModifierType.SHIFT_MASK
  | Clutter.ModifierType.CONTROL_MASK
  | Clutter.ModifierType.MOD1_MASK
  | Clutter.ModifierType.MOD3_MASK
  | Clutter.ModifierType.MOD4_MASK
  | Clutter.ModifierType.MOD5_MASK
  | Clutter.ModifierType.SUPER_MASK
  | Clutter.ModifierType.HYPER_MASK
  | Clutter.ModifierType.META_MASK;

export class TerminalInput {
  constructor({onCancelled = null, speed = () => 'standard'} = {}) {
    const seat = Clutter.get_default_backend().get_default_seat();
    this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    this._targetPurpose = Clutter.InputContentPurpose.NORMAL;
    this._queue = Promise.resolve();
    this._destroyed = false;
    this._emitting = false;
    this._monitoring = false;
    this._typing = null;
    this._typingRevision = 0;
    this._onCancelled = onCancelled;
    this._speed = speed;
    this._eventFilterId = Clutter.Event.add_filter(
      null,
      event => this._filterEvent(event),
    );
  }

  rememberTarget() {
    this._targetPurpose = Main.inputMethod.content_purpose;
  }

  paste() {
    const terminal = this._targetPurpose === Clutter.InputContentPurpose.TERMINAL;
    const modifiers = terminal
      ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]
      : [Clutter.KEY_Shift_L];
    return this._enqueue(async () => {
      if (await this._prepare())
        this._chord(modifiers, Clutter.KEY_Insert);
    });
  }

  type(text) {
    const sequence = typingSequence(text);
    const revision = this._typingRevision;
    return this._enqueue(async () => {
      if (this._destroyed || revision !== this._typingRevision)
        return;
      const typing = {cancelled: false};
      const speed = this._speed();
      this._typing = typing;
      this._monitoring = true;
      try {
        if (!await this._prepare(typingTiming(speed).settle))
          return;
        for (const character of sequence) {
          if (this._destroyed || typing.cancelled)
            return;
          if (this._commandModifiersPressed()) {
            this._cancelTypingWithNotification();
            return;
          }
          this._typeCharacter(character);
          await this._waitForNextStep(character, speed);
        }
      } finally {
        if (this._typing === typing)
          this._typing = null;
        this._monitoring = false;
      }
    });
  }

  destroy() {
    this._destroyed = true;
    this._typingRevision++;
    if (this._typing)
      this._typing.cancelled = true;
    if (this._eventFilterId)
      Clutter.Event.remove_filter(this._eventFilterId);
    this._eventFilterId = 0;
    this._device?.run_dispose();
    this._device = null;
  }

  _enqueue(operation) {
    if (this._destroyed)
      return Promise.resolve();
    const next = this._queue.catch(() => {}).then(operation);
    this._queue = next;
    return next;
  }

  _chord(modifiers, key) {
    for (const modifier of modifiers)
      this._notify(modifier, Clutter.KeyState.PRESSED);
    this._tap(key);
    for (const modifier of [...modifiers].reverse())
      this._notify(modifier, Clutter.KeyState.RELEASED);
  }

  _tap(key) {
    this._notify(key, Clutter.KeyState.PRESSED);
    this._notify(key, Clutter.KeyState.RELEASED);
  }

  _notify(key, state) {
    this._emitting = true;
    try {
      this._device.notify_keyval(GLib.get_monotonic_time(), key, state);
    } finally {
      this._emitting = false;
    }
  }

  _typeCharacter(character) {
    if (character === '\n') {
      this._tap(Clutter.KEY_Return);
      return;
    }
    if (character === '\t') {
      this._tap(Clutter.KEY_Tab);
      return;
    }
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) {
      this._tap(Clutter.unicode_to_keysym(codePoint));
      return;
    }

    // Mutter can only resolve keyvals present in the active XKB map. Use the
    // standard Unicode composition path, then let the target input method
    // finish the commit before emitting the next character.
    this._chord([Clutter.KEY_Control_L, Clutter.KEY_Shift_L], Clutter.KEY_u);
    for (const digit of codePoint.toString(16))
      this._tap(Clutter.unicode_to_keysym(digit.codePointAt(0)));
    this._tap(Clutter.KEY_Return);
  }

  _filterEvent(event) {
    if (!this._monitoring || this._emitting)
      return Clutter.EVENT_PROPAGATE;
    const type = event.type();
    if (type !== Clutter.EventType.KEY_PRESS)
      return Clutter.EVENT_PROPAGATE;
    // VirtualInputDevice events bypass this filter, while physical events may
    // use a logical input device without a device node.
    this._cancelTypingWithNotification();
    return Clutter.EVENT_PROPAGATE;
  }

  _cancelTypingWithNotification() {
    if (!this._cancelTyping())
      return false;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      if (!this._destroyed)
        this._onCancelled?.();
      return GLib.SOURCE_REMOVE;
    });
    return true;
  }

  _cancelTyping() {
    if (!this._typing || this._typing.cancelled)
      return false;
    this._typing.cancelled = true;
    this._typingRevision++;
    return true;
  }

  async _prepare(settleDelay = typingTiming().settle) {
    if (!await this._waitForModifiersReleased())
      return false;
    await this._settle(settleDelay);
    return !this._destroyed;
  }

  _waitForModifiersReleased() {
    if (!(this._modifierState() & COMMAND_MODIFIER_MASK))
      return Promise.resolve(true);
    const deadline = GLib.get_monotonic_time() + INPUT_WAIT_TIMEOUT_MILLISECONDS * 1000;
    return new Promise(resolve => {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, INPUT_POLL_MILLISECONDS, () => {
        if (this._destroyed) {
          resolve(false);
          return GLib.SOURCE_REMOVE;
        }
        if (!(this._modifierState() & COMMAND_MODIFIER_MASK)) {
          resolve(true);
          return GLib.SOURCE_REMOVE;
        }
        if (GLib.get_monotonic_time() >= deadline) {
          resolve(false);
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    });
  }

  _modifierState() {
    return global.get_pointer()[2] ?? 0;
  }

  _commandModifiersPressed() {
    return Boolean(this._modifierState() & COMMAND_MODIFIER_MASK);
  }

  _settle(delay) {
    return new Promise(resolve => {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });
  }

  _waitForNextStep(character, speed) {
    return new Promise(resolve => {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, typingDelay(character, speed), () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });
  }
}
