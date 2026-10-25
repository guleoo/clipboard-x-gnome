import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {Server} from '../helpers/server.js';
import {Peer} from '../helpers/peer.js';
import {Gate} from '../helpers/gate.js';
import {withCleanup} from '../helpers/resources.js';

export const cases = {
  async 'EDIT-05-remote'(desktop) {
    let server;
    let peer;
    let gate;
    let target;
    const processes = [];
    const app = desktop.app;
    const launch = app._launchEditor;
    const report = app._reportError;
    const errors = [];
    app._launchEditor = async function (...args) {
      const process = await launch.apply(this, args);
      if (process) processes.push(process);
      return process;
    };
    app._reportError = function (error) { errors.push(error); report.call(this, error); };
    await withCleanup(async () => {
      server = await Server.open(desktop);
      gate = await Gate.open(server.address);
      await server.configure(server.channel.id, server.identity.key, gate.address);
      desktop.settings.set_uint('image-full-threshold', 1);
      target = await Target.open(desktop);
      peer = await Peer.open(desktop, server);
      await server.enable();
      const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 640, 40);
      pixbuf.fill(0x23a4cdff);
      const bytes = pixbuf.save_to_bufferv('png', [], [])[1];
      const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
      const remote = await peer.call('publish', {types: {'image/png': GLib.base64_encode(bytes)}, threshold: 1});
      await until(() => app._controller.items.some(item => item.id === remote.id), 'lazy remote image snapshot received', 15000);
      const item = app._controller.items.find(value => value.id === remote.id);
      assert(!item.primary.path && !item.primary.bytes, 'Remote editor fixture must begin with preview-only original');
      const helper = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
        .get_child('fixtures').get_child('editor-receiver.py').get_path();
      const edit = async output => {
        desktop.settings.set_string('editor-command', ['python3', helper, output, 'stdin']
          .map(value => GLib.shell_quote(value)).join(' ') + ' %i');
        await desktop.open();
        await desktop.click(desktop.history._itemRows.get(item.id).focusActors
          .find(actor => actor._clipboardXGnomeEntryAction === 'edit'));
        await until(() => !desktop.indicator.menu.isOpen, 'remote Edit closes panel');
      };
      const first = `${GLib.get_tmp_dir()}/remote-editor-first.json`;
      const downloads = () => gate.state.requests.filter(request => request.method === 'GET'
        && /\/items\/[^/]+\/contents\/[^/?]+$/.test(request.path)).length;
      await server.disable();
      const requests = downloads();
      await edit(first);
      await until(() => errors.length > 0, 'offline lazy editor reports the original-is-not-local error');
      assert(!processes.length && !Gio.File.new_for_path(first).query_exists(null)
        && downloads() === requests, 'Offline lazy edit must neither request the original nor spawn an editor');
      await server.enable();
      await edit(first);
      await until(() => Gio.File.new_for_path(first).query_exists(null), 'actual editor consumes the complete lazy original', 30000);
      const read = path => {
        const [, data] = Gio.File.new_for_path(path).load_contents(null);
        return JSON.parse(new TextDecoder().decode(data));
      };
      assert(read(first).sha256 === hash && read(first).size === bytes.length,
        'Source → server → receiver → editor must deliver original bytes, not the preview');
      assert(item.primary.path && (await server.item(item.id)).contents[0].availability === 'available',
        'Both server and receiver must now retain the original');
      await server.disable();
      const second = `${GLib.get_tmp_dir()}/remote-editor-cached.json`;
      const previous = downloads();
      await edit(second);
      await until(() => Gio.File.new_for_path(second).query_exists(null), 'cached original edits while offline');
      assert(read(second).sha256 === hash && read(second).size === bytes.length
        && downloads() === previous, 'Cached offline editing must not need a new download');
    }, () => [{close: async () => {
      app._launchEditor = launch;
      app._reportError = report;
      for (const process of processes) {
        process.force_exit();
        await new Promise(resolve => process.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
      }
    }}, peer, target, server, gate]);
  },
};
