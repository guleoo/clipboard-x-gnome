import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, until} from './desktop.js';

export class Peer {
  static async open(desktop, server, {channelId = server.channel.id} = {}) {
    const identity = await server.device();
    await server.join(channelId, identity.id);
    const peer = new Peer(identity);
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('GSETTINGS_BACKEND', 'memory', true);
    for (const [name, folder] of [['XDG_DATA_HOME', 'data'], ['XDG_CONFIG_HOME', 'config'], ['XDG_CACHE_HOME', 'cache']]) {
      const path = `${peer.directory}/${folder}`;
      GLib.mkdir_with_parents(path, 0o700);
      launcher.setenv(name, path, true);
    }
    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('sync-peer.js');
    peer.process = launcher.spawnv(['gjs', '-m', script.get_path(), desktop.app.dir.get_uri(), peer.directory,
      JSON.stringify({address: server.address, identity, channelId, parentPid: new Gio.Credentials().get_unix_pid()})]);
    try {
      await until(() => peer.state.ready || peer.state.error, 'independent source client ready', 15000);
      assert(peer.state.ready, `Source bootstrap failed: ${peer.state.error?.message}`);
      return peer;
    } catch (error) { await peer.close(); throw error; }
  }

  constructor(identity) {
    this.identity = identity;
    this.directory = GLib.dir_make_tmp('cbx-peer-XXXXXX');
    this.command = 0;
  }

  get state() {
    try {
      const [, bytes] = Gio.File.new_for_path(`${this.directory}/state.json`).load_contents(null);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return {}; }
  }

  async call(action, parameters = {}) {
    const id = ++this.command;
    Gio.File.new_for_path(`${this.directory}/command.json`).replace_contents(
      new TextEncoder().encode(JSON.stringify({id, action, ...parameters})), null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    await until(() => this.state.command === id, `source ${action} completed`, 30000);
    assert(!this.state.error, `Source ${action}: ${this.state.error?.message}`);
    return this.state.result;
  }

  async close() {
    if (!this.process) return;
    this.process.force_exit();
    await new Promise(resolve => this.process.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
    this.process = null;
  }
}
