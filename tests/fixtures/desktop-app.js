// Independent GTK Wayland clipboard source and text receiver. Never imported by Shell.
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const directory = Gio.File.new_for_path(ARGV[0]);
const title = ARGV[1];
const application = new Gtk.Application({application_id: 'io.github.guleoo.CbxAcceptance',
  flags: Gio.ApplicationFlags.NON_UNIQUE});
const stateFile = directory.get_child('state.json');
const commandFile = directory.get_child('command.json');
let state = {ready: false, command: 0, text: '', edits: 0, paused: false,
  preedit: '', preeditUpdates: 0};
let provider = null;
let busy = false;

function save() {
  stateFile.replace_contents(new TextEncoder().encode(JSON.stringify(state)), null, false,
    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

async function bytesFromClipboard(clipboard, mime) {
  const [stream, actualMime] = await new Promise((resolve, reject) => clipboard.read_async(
    [mime], GLib.PRIORITY_DEFAULT, null, (object, result) => {
      try { resolve(object.read_finish(result)); } catch (error) { reject(error); }
    }));
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(
        65536, GLib.PRIORITY_DEFAULT, null, (object, result) => {
          try { resolve(object.read_bytes_finish(result)); } catch (error) { reject(error); }
        }));
      if (bytes.get_size() === 0) break;
      size += bytes.get_size();
      if (size > 32 * 1024 * 1024) throw new Error('Fixture clipboard read exceeds 32 MB');
      chunks.push(bytes.get_data());
    }
  } finally { stream.close(null); }
  const contents = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { contents.set(chunk, offset); offset += chunk.length; }
  return {mime: actualMime, size, sha256: GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, contents),
    text: mime.startsWith('text/') ? new TextDecoder().decode(contents) : null};
}

application.connect('activate', app => {
  const buffer = new Gtk.TextBuffer();
  const entry = new Gtk.TextView({buffer, monospace: true, hexpand: true, vexpand: true});
  const window = new Gtk.ApplicationWindow({application: app, title,
    default_width: 560, default_height: 320, child: entry});
  const clipboard = Gdk.Display.get_default().get_clipboard();
  buffer.connect('changed', () => {
    state.edits++;
    state.text = buffer.get_text(...buffer.get_bounds(), true);
  });
  entry.connect('preedit-changed', (_view, preedit) => {
    state.preedit = preedit;
    if (preedit) state.preeditUpdates++;
  });
  window.present();
  entry.grab_focus();
  state.ready = true;
  const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
    save(); // Periodic snapshot, not debounce: partial typing remains observable.
    if (busy || !commandFile.query_exists(null)) return GLib.SOURCE_CONTINUE;
    const [, raw] = commandFile.load_contents(null);
    const command = JSON.parse(new TextDecoder().decode(raw));
    if (command.id === state.command) return GLib.SOURCE_CONTINUE;
    busy = true;
    (async () => {
      try {
        state.error = null;
        state.result = null;
        if (command.action === 'offer') {
          const representations = Object.entries(command.types).map(([mime, encoded]) =>
            Gdk.ContentProvider.new_for_bytes(mime, new GLib.Bytes(GLib.base64_decode(encoded))));
          provider = Gdk.ContentProvider.new_union(representations);
          if (!clipboard.set_content(provider)) throw new Error('Clipboard offer rejected');
          if (command.pause) {
            Gdk.Display.get_default().flush();
            state.command = command.id;
            state.paused = true;
            save();
            // Block only this owned source, before GTK can service a data request.
            // Symbolic Python signals avoid architecture-specific signal numbers.
            const pause = Gio.Subprocess.new(['python3', '-c',
              'import os, signal; os.kill(os.getppid(), signal.SIGSTOP)'], Gio.SubprocessFlags.NONE);
            pause.wait_check(null);
            state.paused = false;
          }
        } else if (command.action === 'read') {
          state.result = await bytesFromClipboard(clipboard, command.mime);
        } else if (command.action === 'clear') {
          buffer.set_text('', -1);
        } else if (command.action === 'quit') {
          window.close();
        } else {
          throw new Error(`Unknown fixture command: ${command.action}`);
        }
      } catch (error) {
        state.error = error.message;
      } finally {
        state.command = command.id;
        busy = false;
        save();
      }
    })();
    return GLib.SOURCE_CONTINUE;
  });
  window.connect('close-request', () => {
    GLib.Source.remove(source);
    provider = null;
    return false;
  });
});
application.run([]);
