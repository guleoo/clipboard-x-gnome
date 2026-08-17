import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {typingSequence} from './sequence.js';

const SETTLE_DELAY_MILLISECONDS = 75;
const SYMBOLS_PER_BATCH = 32;

export class TerminalInput {
  constructor() {
    const seat = Clutter.get_default_backend().get_default_seat();
    this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    this._targetPurpose = Clutter.InputContentPurpose.NORMAL;
    this._queue = Promise.resolve();
    this._destroyed = false;
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
      await this._settle();
      if (!this._destroyed)
        this._chord(modifiers, Clutter.KEY_Insert);
    });
  }

  type(text) {
    const sequence = typingSequence(text);
    return this._enqueue(async () => {
      await this._settle();
      for (let index = 0; index < sequence.length && !this._destroyed; index++) {
        this._typeCharacter(sequence[index]);
        if ((index + 1) % SYMBOLS_PER_BATCH === 0)
          await this._yield();
      }
    });
  }

  destroy() {
    this._destroyed = true;
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
