import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {getInputSourceManager} from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';
import {typingSample} from './samples.js';
import {prepare} from './ready.js';

export async function trigger(desktop, target, text, key, {replaceClipboard = false, pointer = false, search = text} = {}) {
  const item = await capture(desktop, target, text);
  if (replaceClipboard) await target.offer('Independent clipboard sentinel before action');
  await desktop.open();
  if (replaceClipboard) await desktop.search(search);
  await desktop.key(Clutter.KEY_Down);
  assert(desktop.focus === desktop.history._itemRows.get(item.id).focusActors[0], 'Native action targets the copied row');
  if (pointer) {
    desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    try {
      await pause(25);
      await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
    } finally {
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
      await pause(25);
    }
  } else await desktop.key(key);
}

async function exactTyping(desktop, target, source, speed, {pointer = false} = {}) {
  desktop.settings.set_string('simulated-input-speed', speed);
  await target.focus();
  await target.call('clear');
  const previous = desktop.app._terminalInput._queue;
  await trigger(desktop, target, source, Clutter.KEY_apostrophe, {pointer});
  await until(() => !desktop.indicator.menu.isOpen && desktop.app._terminalInput._queue !== previous,
    'native typing action actually enqueued and closed the panel');
  await desktop.app._terminalInput._queue;
  // Periodic receiver snapshots must settle after the final queued key event.
  try {
    await until(() => target.state.text === source, speed + ': exact ' + source.length + '-character target content', 5000);
  } catch (error) {
    const actual = target.state.text ?? '';
    let difference = 0;
    while (difference < Math.min(actual.length, source.length) && actual[difference] === source[difference]) difference++;
    const hash = text => GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, new TextEncoder().encode(text));
    printerr(`[simulation] Typing mismatch: expectedLength=${source.length}; actualLength=${actual.length}; firstDifference=${difference}; expectedCodepoint=${source.codePointAt(difference)}; actualCodepoint=${actual.codePointAt(difference)}; expectedSha256=${hash(source)}; actualSha256=${hash(actual)}; modifiers=${global.get_pointer()[2]}; layout=${getInputSourceManager().currentSource?.id}`);
    throw error;
  }
  await pause(100);
  assert(target.state.text === source, speed + ': no delayed duplicated or reordered characters');
}

async function typing(desktop, speed) {
  const target = await Target.open(desktop);
  try {
    await prepare(target.window, () => target.state.text);
    await exactTyping(desktop, target, typingSample, speed);
  }
  finally { await target.close(); }
}

export const cases = {
  async 'TYPE-01'(desktop) {
    const target = await Target.open(desktop);
    try {
      await trigger(desktop, target, 'copy changes clipboard only', Clutter.KEY_Return, {replaceClipboard: true});
      assert((await target.clipboard()).text === 'copy changes clipboard only' && target.state.text === '',
        'Copy must not type into the external target');
      await trigger(desktop, target, 'paste into the original target', Clutter.KEY_v, {replaceClipboard: true});
      await until(() => target.state.text === 'paste into the original target', 'paste into real GTK target');
      await target.call('clear');
      await trigger(desktop, target, 'abc123', Clutter.KEY_apostrophe, {replaceClipboard: true});
      await until(() => target.state.text === 'abc123', 'simulated keystrokes reach the real GTK target', 15000);
      await pause(100);
      assert(target.state.text === 'abc123', 'Simulated keystrokes must not duplicate delayed text');
      assert((await target.clipboard()).text === 'Independent clipboard sentinel before action', 'Typing must not overwrite the clipboard');
    } finally { await target.close(); }
  },

  'TYPE-03': desktop => typing(desktop, 'standard'),
};
