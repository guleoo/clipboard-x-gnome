import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, block, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';

export const cases = {
  async 'TYPE-02-vte'(desktop) {
    const probe = Gio.Subprocess.new(['python3', '-c',
      "import gi;gi.require_version('Gtk','3.0');gi.require_version('Vte','2.91');from gi.repository import Gtk,Vte"],
    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const compatible = await new Promise(resolve => probe.wait_async(null, (process, result) => {
      process.wait_finish(result);
      resolve(process.get_successful());
    }));
    if (!compatible) block('GTK3/VTE 2.91 Python GI bindings are unavailable');
    const target = await Target.open(desktop);
    const directory = GLib.dir_make_tmp('cbx-vte-XXXXXX');
    const title = 'CBX VTE ' + GLib.uuid_string_random();
    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('vte-target.py').get_path();
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    let process;
    let processId;
    let finished = false;
    let exited;
    const window = () => global.get_window_actors().map(actor => actor.meta_window).find(value => value.get_title() === title);
    const received = () => {
      try { return new TextDecoder().decode(GLib.file_get_contents(directory + '/received')[1]); }
      catch { return ''; }
    };
    try {
      process = launcher.spawnv(['python3', script, directory, title, String(new Gio.Credentials().get_unix_pid())]);
      processId = process.get_identifier();
      exited = new Promise(resolve => process.wait_async(null, (child, result) => {
        try { child.wait_finish(result); } finally { finished = true; resolve(); }
      }));
      await until(() => window() && Gio.File.new_for_path(directory + '/ready').query_exists(null), 'real GTK3 terminal and raw PTY ready', 15000);
      Main.activateWindow(window());
      await until(() => global.display.focus_window === window(), 'actual terminal focused');
      const box = window().get_frame_rect();
      await desktop.pointClick(box.x + box.width / 2, box.y + box.height / 2);
      await desktop.key(Clutter.KEY_a);
      await until(() => received() === 'a', 'native ASCII key reaches the actual PTY');
      await target.offer('positive-control');
      Main.activateWindow(window());
      await until(() => global.display.focus_window === window(), 'VTE positive-control window focused');
      // Use GTK's real mnemonic rather than mixing Gtk3 client allocation and
      // compositor decoration coordinates. No IPC injects paste or PTY bytes.
      await desktop.key(Clutter.KEY_p, [Clutter.KEY_Alt_L]);
      await until(() => received() === 'apositive-control', 'native Paste button proves real clipboard-to-PTY delivery');
      print('[simulation] VTE positive controls passed: native ASCII key and real clipboard paste reached the raw PTY');
      const prefix = received();
      // Raw PTYs legitimately expose CR instead of LF on paste. A single-line
      // sample isolates the plugin's natural-paste action from newline policy.
      const source = 'Natural terminal paste: Aa123 !? /tmp/file';
      const item = await capture(desktop, target, source);
      Main.activateWindow(window());
      await until(() => global.display.focus_window === window(), 'VTE focused before plugin entry');
      const terminalBox = window().get_frame_rect();
      await desktop.pointClick(terminalBox.x + terminalBox.width / 2, terminalBox.y + terminalBox.height / 2);
      await desktop.open();
      await desktop.key(Clutter.KEY_Down);
      assert(desktop.focus === desktop.history._itemRows.get(item.id).focusActors[0], 'Native paste must target captured content');
      await desktop.key(Clutter.KEY_v);
      print(`[simulation] Natural terminal paste: capturedPurpose=${desktop.app._terminalInput._targetPurpose}`);
      await desktop.app._terminalInput._queue;
      try {
        await until(() => received() === prefix + source, 'natural paste reaches actual PTY byte-for-byte', 10000);
      } catch (error) {
        const actual = received().slice(prefix.length);
        printerr(`[simulation] Terminal paste mismatch: expectedBytes=${new TextEncoder().encode(source).length}; actualBytes=${new TextEncoder().encode(actual).length}; actualSha256=${GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, new TextEncoder().encode(actual))}`);
        throw error;
      }
      await pause(100);
      assert(received() === prefix + source, 'Terminal paste must not duplicate, bracket or execute content in the raw receiver');
    } finally {
      window()?.delete(global.get_current_time());
      if (process) {
        await pause(100);
        // A fixture that never mapped still owns a PTY child. Gracefully signal
        // its Python parent before the bounded force-exit fallback.
        if (!finished) {
          const stop = Gio.Subprocess.new(['python3', '-c',
            'import os,signal,sys\ntry: os.kill(int(sys.argv[1]),signal.SIGTERM)\nexcept ProcessLookupError: pass',
            processId], Gio.SubprocessFlags.NONE);
          await new Promise(resolve => stop.wait_async(null, (child, result) => { child.wait_finish(result); resolve(); }));
          for (let attempt = 0; attempt < 10 && !finished; attempt++) await pause(20);
          if (!finished) process.force_exit();
        }
        await exited;
      }
      await target.close();
    }
  },
};
