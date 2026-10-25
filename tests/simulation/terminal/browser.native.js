import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {Application} from '../clipboard/applications.native.js';
import {capture} from '../clipboard/native.js';
import {withCleanup} from '../helpers/resources.js';

async function browserTyping(desktop, kind) {
  let target;
  let browser;
  let server;
  const directory = GLib.dir_make_tmp('cbx-browser-input-XXXXXX');
  const read = () => {
    try { return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${directory}/state.json`)[1])); }
    catch { return {}; }
  };
  await withCleanup(async () => {
    target = await Target.open(desktop);
    browser = await Application.open(desktop, kind, {allowLoopback: true});
    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('browser-input.py').get_path();
    server = Gio.Subprocess.new(['python3', script, directory, browser.title], Gio.SubprocessFlags.NONE);
    await until(() => read().port, 'owned browser receiver HTTP endpoint');
    Main.activateWindow(browser.window);
    await until(() => global.display.focus_window === browser.window, 'private browser navigation focus');
    await desktop.key(Clutter.KEY_l, [Clutter.KEY_Control_L]);
    await desktop.type(`http://127.0.0.1:${read().port}/`);
    await desktop.key(Clutter.KEY_Return);
    try { await until(() => read().ready, 'actual private browser loaded the local receiver page', 15000); }
    catch (error) {
      printerr(`[simulation] Browser receiver failed before typing: app=${kind}; gets=${read().gets}; title=${browser.window?.get_title()}; diagnostics=${browser.log}`);
      throw error;
    }
    for (const text of ['Browser typing: AaZz 123 !?\n', '中文 日本語 한국어 🙂\n']) {
      const item = await capture(desktop, target, text);
      Main.activateWindow(browser.window);
      await until(() => global.display.focus_window === browser.window, 'actual browser target focus');
      const box = browser.window.get_frame_rect();
      await desktop.pointClick(box.x + box.width / 2, box.y + box.height / 2);
      await desktop.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
      await desktop.key(Clutter.KEY_BackSpace);
      await desktop.open();
      const previous = desktop.app._terminalInput._queue;
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
      try {
        await pause(25);
        await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
      } finally {
        desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        await pause(25);
      }
      await until(() => desktop.app._terminalInput._queue !== previous, 'browser typing was actually enqueued');
      await desktop.app._terminalInput._queue;
      try { await until(() => read().text === text, `actual ${kind} receives exact typing`, 5000); }
      catch (error) {
        const actual = read().text ?? '';
        printerr(`[simulation] Browser typing mismatch: app=${kind}; expectedLength=${text.length}; actualLength=${actual.length}; actualSha256=${GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, new TextEncoder().encode(actual))}`);
        throw error;
      }
      await pause(50);
      assert(read().text === text, 'Browser input must have no late duplicate characters');
    }
  }, () => [browser, target, {close: async () => {
    if (!server) return;
    server.force_exit();
    await new Promise(resolve => server.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
  }}]);
}

export const cases = {
  'TYPE-09-firefox': desktop => browserTyping(desktop, 'firefox'),
  'TYPE-09-chromium': desktop => browserTyping(desktop, 'chromium'),
};
