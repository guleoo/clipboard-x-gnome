import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {getInputSourceManager} from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {restart} from '../helpers/restart.js';
import {capture} from '../clipboard/native.js';
import {typingSample} from './samples.js';

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
  desktop.settings.set_string('simulated-input-mode', 'keys');
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
  try { await exactTyping(desktop, target, typingSample, speed); }
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
      assert(desktop.settings.get_string('simulated-input-mode') === 'commit', 'Text submission must be the default input mode');
      await trigger(desktop, target, typingSample, Clutter.KEY_apostrophe, {replaceClipboard: true, search: '[Unit]'});
      await until(() => target.state.text === typingSample, 'default text submission preserves the exact multilingual sample', 15000);
      await pause(100);
      assert(target.state.text === typingSample, 'Default text submission must not duplicate or reorder delayed text');
      await target.call('clear');
      const chunked = typingSample.repeat(8);
      await trigger(desktop, target, chunked, Clutter.KEY_apostrophe, {replaceClipboard: true, search: '[Unit]'});
      await until(() => target.state.text === chunked, 'multiple text submissions reach GTK in exact order', 15000);
      assert((await target.clipboard()).text === 'Independent clipboard sentinel before action', 'Typing must not overwrite the clipboard');
    } finally { await target.close(); }
  },

  'TYPE-03': desktop => typing(desktop, 'standard'),
  'TYPE-04': desktop => typing(desktop, 'slow'),

  async 'TYPE-08-layout'(desktop) {
    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
    const sources = settings.get_value('sources');
    const manager = getInputSourceManager();
    const originalId = manager.currentSource?.id;
    const target = await Target.open(desktop);
    try {
      settings.set_value('sources', new GLib.Variant('a(ss)', [['xkb', 'us'], ['xkb', 'de']]));
      for (const id of ['us', 'de']) {
        await until(() => Object.values(manager.inputSources).some(source => source.type === 'xkb' && source.id === id),
          'actual private input source available: ' + id);
        Object.values(manager.inputSources).find(source => source.type === 'xkb' && source.id === id).activate(true);
        await until(() => manager.currentSource?.type === 'xkb' && manager.currentSource.id === id,
          'actual active XKB source: ' + id);
        await pause(100);
        await exactTyping(desktop, target, 'AzYz []{} @! 123 中文\n', 'standard', {pointer: true});
      }
      print('[simulation] Actual US/German XKB sources tested; this is not physical scancode or IME coverage');
    } finally {
      settings.set_value('sources', sources);
      await pause(100);
      Object.values(manager.inputSources).find(source => source.id === originalId)?.activate(true);
      await target.close();
    }
  },

  async 'TYPE-05'(desktop) {
    const target = await Target.open(desktop);
    let held = false;
    try {
      const item = await capture(desktop, target, 'wait for actual Control release');
      await desktop.open();
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
      held = true;
      await pause(25);
      await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
      await pause(200);
      assert(target.state.text === '', 'No output may escape while physical modifier state remains held');
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
      held = false;
      await until(() => target.state.text === item.text, 'typing after modifier released', 15000);
    } finally {
      if (held) desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
      await target.close();
    }
  },

  async 'TYPE-06'(desktop) {
    desktop.settings.set_string('simulated-input-mode', 'keys');
    const target = await Target.open(desktop);
    const input = desktop.app._terminalInput;
    const notify = input._onCancelled;
    let notifications = 0;
    let held = false;
    input._onCancelled = () => { notifications++; notify?.(); };
    try {
      await trigger(desktop, target, 'a'.repeat(1000), Clutter.KEY_apostrophe);
      await until(() => target.state.text.length > 0 && target.state.text.length < 1000, 'typing observed in periodic external snapshot');
      const rejected = input.type('BUSY_OUTPUT_MUST_NOT_APPEAR').then(() => null, error => error);
      assert((await rejected)?.code === 'busy', 'A second input must be rejected without entering a pending queue');
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
      held = true;
      await until(() => notifications === 1, 'actual backend Control state trips the fuse');
      await input._queue;
      await pause(60);
      const stopped = target.state.text;
      assert(stopped.length < 1000 && !stopped.includes('BUSY_OUTPUT_MUST_NOT_APPEAR'),
        'Fuse must cancel active output and rejected busy input must never appear');
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
      held = false;
      await pause(120);
      assert(target.state.text === stopped && notifications === 1, 'Cancelled output must not resume or notify twice');
      print('[simulation] Backend virtual modifier fuse passed; physical hardware remains a manual boundary');
    } finally {
      if (held) desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
      input._onCancelled = notify;
      await target.close();
    }
  },

  async 'TYPE-07'(desktop) {
    desktop.settings.set_string('simulated-input-mode', 'keys');
    const target = await Target.open(desktop);
    const input = desktop.app._terminalInput;
    try {
      await trigger(desktop, target, 'b'.repeat(1000), Clutter.KEY_apostrophe);
      await until(() => target.state.text.length > 0 && target.state.text.length < 1000, 'active output before disabling');
      const rejected = input.type('OLD_SESSION_MUST_NOT_TYPE').then(() => null, error => error);
      assert((await rejected)?.code === 'busy', 'Repeated input before disable must be rejected rather than queued');
      await restart(desktop);
      await input._queue;
      await pause(60);
      const stopped = target.state.text;
      await pause(120);
      assert(stopped.length < 1000 && !stopped.includes('OLD_SESSION_MUST_NOT_TYPE') && target.state.text === stopped,
        'Disable/re-enable must not resume old active or rejected output');
      assert(input._sources.size === 0 && input._eventFilterId === 0 && !input._device,
        'Old input resources must be released');
    } finally { await target.close(); }
  },
};
