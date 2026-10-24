import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {until} from './desktop.js';

// A separate streaming process changes network timing, never production transport results.
export class Gate {
  static async open(address) {
    const gate = new Gate();
    const fixture = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('http-gate.py');
    gate.process = Gio.Subprocess.new(['python3', fixture.get_path(), gate.directory, address], Gio.SubprocessFlags.NONE);
    try {
      await until(() => gate.state.port, 'owned HTTP gate ready');
      gate.address = `http://127.0.0.1:${gate.state.port}`;
      return gate;
    } catch (error) { await gate.close(); throw error; }
  }
  constructor() { this.directory = GLib.dir_make_tmp('cbx-http-gate-XXXXXX'); }
  get state() {
    try {
      const [, bytes] = Gio.File.new_for_path(`${this.directory}/state.json`).load_contents(null);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return {requests: []}; }
  }
  set(policy) {
    Gio.File.new_for_path(`${this.directory}/policy.json`).replace_contents(
      new TextEncoder().encode(JSON.stringify(policy)), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
  }
  async close() {
    if (!this.process) return;
    this.process.force_exit();
    await new Promise(resolve => this.process.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
    this.process = null;
  }
}
