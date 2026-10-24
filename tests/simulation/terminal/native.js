import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {restart} from '../helpers/restart.js';
import {capture} from '../clipboard/native.js';

async function trigger(desktop, target, text, key, {replaceClipboard = false} = {}) {
  const item = await capture(desktop, target, text);
  if (replaceClipboard) await target.offer('Independent clipboard sentinel before action');
  await desktop.open();
  if (replaceClipboard) await desktop.search(text);
  await desktop.key(Clutter.KEY_Down);
  assert(desktop.focus === desktop.history._itemRows.get(item.id).focusActors[0], 'Native action targets the copied row');
  await desktop.key(key);
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
      await trigger(desktop, target, 'simulated input target', Clutter.KEY_apostrophe, {replaceClipboard: true});
      await until(() => target.state.text === 'simulated input target', 'native simulated-input shortcut', 15000);
      assert((await target.clipboard()).text === 'Independent clipboard sentinel before action', 'Typing must not overwrite the clipboard');
    } finally { await target.close(); }
  },

  async 'TYPE-03'(desktop) {
    const target = await Target.open(desktop);
    const source = '[Unit]\n# 服务描述 日本語 한국어 🙂\nDescription=frp client\n\tline two\n';
    try {
      for (const speed of ['standard', 'slow']) {
        desktop.settings.set_string('simulated-input-speed', speed);
        await target.focus();
        await target.call('clear');
        await trigger(desktop, target, source, Clutter.KEY_apostrophe);
        await until(() => target.state.text === source, `${speed}: exact mixed-language target content`, 20000);
        await desktop.app._terminalInput._queue;
        await pause(60);
        assert(target.state.text === source, `${speed}: no late duplicated or reordered characters`);
      }
    } finally { await target.close(); }
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
    const target = await Target.open(desktop);
    const input = desktop.app._terminalInput;
    const notify = input._onCancelled;
    let notifications = 0;
    let held = false;
    input._onCancelled = () => { notifications++; notify?.(); };
    try {
      await trigger(desktop, target, 'a'.repeat(1000), Clutter.KEY_apostrophe);
      await until(() => target.state.text.length > 0 && target.state.text.length < 1000, 'typing observed in periodic external snapshot');
      const queued = input.type('QUEUED_OUTPUT_MUST_BE_CANCELLED');
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
      held = true;
      await until(() => notifications === 1, 'actual backend Control state trips the fuse');
      await queued;
      await input._queue;
      await pause(60);
      const stopped = target.state.text;
      assert(stopped.length < 1000 && !stopped.includes('QUEUED_OUTPUT_MUST_BE_CANCELLED'),
        'Fuse must cancel both active and queued output');
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
    const target = await Target.open(desktop);
    const input = desktop.app._terminalInput;
    try {
      await trigger(desktop, target, 'b'.repeat(1000), Clutter.KEY_apostrophe);
      await until(() => target.state.text.length > 0 && target.state.text.length < 1000, 'active output before disabling');
      const queued = input.type('OLD_SESSION_MUST_NOT_TYPE');
      await restart(desktop);
      await queued;
      await pause(60);
      const stopped = target.state.text;
      await pause(120);
      assert(stopped.length < 1000 && !stopped.includes('OLD_SESSION_MUST_NOT_TYPE') && target.state.text === stopped,
        'Disable/re-enable must not resume old active or queued output');
      assert(input._sources.size === 0 && input._eventFilterId === 0 && !input._device,
        'Old input resources must be released');
    } finally { await target.close(); }
  },
};
