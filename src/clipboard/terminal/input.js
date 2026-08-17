import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Activity} from './activity.js';
import {typingSequence} from './sequence.js';

const SETTLE_DELAY_MILLISECONDS = 75;
const INPUT_POLL_MILLISECONDS = 20;
const INPUT_WAIT_TIMEOUT_MILLISECONDS = 10_000;
const MANUAL_INPUT_QUIET_MILLISECONDS = 250;
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
  constructor() {
    const seat = Clutter.get_default_backend().get_default_seat();
    this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    this._targetPurpose = Clutter.InputContentPurpose.NORMAL;
    this._queue = Promise.resolve();
    this._destroyed = false;
    this._monitoring = false;
    this._activity = new Activity(MANUAL_INPUT_QUIET_MILLISECONDS * 1000);
    this._eventFilterId = Clutter.Event.add_filter(
      null,
      event => this._filterEvent(event),
      null,
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
    return this._enqueue(async () => {
      this._monitoring = true;
      try {
        if (!await this._prepare())
          return;
        for (const character of sequence) {
          if (this._destroyed || !await this._waitForManualInputIdle())
            return;
          this._typeCharacter(character);
          await this._yield();
        }
      } finally {
        this._monitoring = false;
        this._activity.reset();
      }
    });
  }

  destroy() {
    this._destroyed = true;
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
    this._device.notify_keyval(GLib.get_monotonic_time(), key, state);
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

    // Mutter can only resolve keyvals present in the active XKB map. GNOME
    // applications accept the standard Ctrl+Shift+U hexadecimal input path,
    // which also lets a Latin keyboard type CJK and other Unicode characters.
    this._chord([Clutter.KEY_Control_L, Clutter.KEY_Shift_L], Clutter.KEY_u);
    for (const digit of codePoint.toString(16))
      this._tap(Clutter.unicode_to_keysym(digit.codePointAt(0)));
    this._tap(Clutter.KEY_Return);
  }

  _filterEvent(event) {
    if (!this._monitoring)
      return Clutter.EVENT_PROPAGATE;
    const type = event.type();
    if (type !== Clutter.EventType.KEY_PRESS && type !== Clutter.EventType.KEY_RELEASE)
      return Clutter.EVENT_PROPAGATE;
    const device = event.get_source_device();
    if (!device?.get_device_node())
      return Clutter.EVENT_PROPAGATE;
    this._activity.update(
      device,
      event.get_key_code(),
      type === Clutter.EventType.KEY_PRESS,
      GLib.get_monotonic_time(),
    );
    return Clutter.EVENT_PROPAGATE;
  }

  async _prepare() {
    if (!await this._waitForModifiersReleased())
      return false;
    await this._settle();
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

  _waitForManualInputIdle() {
    const now = GLib.get_monotonic_time();
    if (this._activity.ready(now))
      return Promise.resolve(true);
    const deadline = now + INPUT_WAIT_TIMEOUT_MILLISECONDS * 1000;
    return new Promise(resolve => {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, INPUT_POLL_MILLISECONDS, () => {
        if (this._destroyed) {
          resolve(false);
          return GLib.SOURCE_REMOVE;
        }
        const currentTime = GLib.get_monotonic_time();
        if (this._activity.ready(currentTime)) {
          resolve(true);
          return GLib.SOURCE_REMOVE;
        }
        if (currentTime >= deadline) {
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

  _settle() {
    return new Promise(resolve => {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_DELAY_MILLISECONDS, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });
  }

  _yield() {
    return new Promise(resolve => {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });
  }
}
