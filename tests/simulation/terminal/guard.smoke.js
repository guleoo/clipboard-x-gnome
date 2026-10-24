import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import {assert} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function typingGuard(_indicator, extensionObject) {
  const terminalInput = extensionObject._terminalInput;
  const cancelledCallback = terminalInput._onCancelled;
  try {
    let cancelledNotifications = 0;
    terminalInput._onCancelled = () => cancelledNotifications++;
    const activeTyping = {cancelled: false};
    terminalInput._typing = activeTyping;
    terminalInput._monitoring = true;
    const keyboardEvent = type => ({
      type: () => type,
      get_key_code: () => 30,
    });
    // Directly exercise filtering; this is not proof of hardware key delivery.
    terminalInput._emitting = true;
    terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS));
    assert(cancelledNotifications === 0 && !activeTyping.cancelled,
      'Synchronous virtual keyboard event was mistaken for manual input');
    terminalInput._emitting = false;
    terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS));
    terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS));
    await Scripting.sleep(10);
    assert(activeTyping.cancelled && cancelledNotifications === 1,
      'Manual keyboard input did not cancel typing with one notification');
  } finally {
    terminalInput._onCancelled = cancelledCallback;
    terminalInput._typing = null;
    terminalInput._monitoring = false;
    terminalInput._emitting = false;
  }
}

export function run() {
  return runChecks([['typingGuard', typingGuard]]);
}
