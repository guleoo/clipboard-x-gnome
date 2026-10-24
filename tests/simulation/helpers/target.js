import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, until} from './desktop.js';

export class Target {
  static async open(desktop) {
    const target = new Target(desktop);
    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent()
      .get_parent().get_child('fixtures').get_child('desktop-app.js');
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    target.process = launcher.spawnv(['gjs', '-m', script.get_path(), target.directory, target.title]);
    await until(() => target.state.ready && target.window, 'independent GTK target ready', 10000);
    await target.focus();
    return target;
  }

  constructor(desktop) {
    this.desktop = desktop;
    this.directory = GLib.dir_make_tmp('cbx-target-XXXXXX');
    this.title = `CBX target ${GLib.uuid_string_random()}`;
    this._command = 0;
  }

  get window() {
    return global.get_window_actors().map(actor => actor.meta_window)
      .find(window => window.get_title() === this.title);
  }

  get state() {
    try {
      const [, contents] = Gio.File.new_for_path(`${this.directory}/state.json`).load_contents(null);
      return JSON.parse(new TextDecoder().decode(contents));
    } catch { return {}; }
  }

  async focus() {
    await this.desktop.close();
    Main.activateWindow(this.window);
    await until(() => global.display.focus_window === this.window, 'target keyboard focus');
    // Clipboard offers need a serial belonging to this Wayland client. Merely
    // activating its window is not an input event on every Mutter version.
    const box = this.window.get_frame_rect();
    await this.desktop.pointClick(box.x + box.width / 2, box.y + box.height / 2);
  }

  async call(action, parameters = {}) {
    const command = ++this._command;
    Gio.File.new_for_path(`${this.directory}/command.json`).replace_contents(
      new TextEncoder().encode(JSON.stringify({id: command, action, ...parameters})), null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    await until(() => this.state.command === command, `target ${action} completed`, 10000);
    assert(!this.state.error, `GTK target ${action}: ${this.state.error}`);
    return this.state.result;
  }

  async offer(text, other = {}) {
    await this.focus();
    const types = {'text/plain;charset=utf-8': new TextEncoder().encode(text), ...other};
    return this.offerBytes(types);
  }

  async offerBytes(representations, {pause = false} = {}) {
    await this.focus();
    const types = Object.fromEntries(Object.entries(representations).map(([mime, bytes]) =>
      [mime, GLib.base64_encode(bytes)]));
    await this.call('offer', {types, pause});
    this.paused = pause;
    if (pause) {
      await until(() => {
        const [, value] = GLib.file_get_contents(`/proc/${this.process.get_identifier()}/status`);
        return /^State:\s+T/m.test(new TextDecoder().decode(value));
      }, 'owned clipboard provider stopped before servicing its offer');
    }
  }

  async resume() {
    if (!this.paused) return;
    const signal = Gio.Subprocess.new(['python3', '-c',
      'import os, signal, sys; os.kill(int(sys.argv[1]), signal.SIGCONT)', this.process.get_identifier()],
    Gio.SubprocessFlags.NONE);
    await new Promise((resolve, reject) => signal.wait_check_async(null, (process, result) => {
      try { process.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
    }));
    await until(() => !this.state.paused, 'source resumed');
    this.paused = false;
  }

  async clipboard(mime = 'text/plain;charset=utf-8') {
    await this.focus();
    return this.call('read', {mime});
  }

  async close() {
    if (!this.process) return;
    try { if (!this.paused) await this.call('quit'); } finally {
      // Only this owned fixture process is terminated if its normal close stalls.
      this.process.force_exit();
      await new Promise(resolve => this.process.wait_async(null, (process, result) => {
        process.wait_finish(result);
        resolve();
      }));
      this.process = null;
    }
  }
}
