import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const output = Gio.File.new_for_path(ARGV[0]);
const application = new Gtk.Application({
  application_id: 'io.github.guleoo.ClipboardXGnomeTypingTarget',
  flags: Gio.ApplicationFlags.NON_UNIQUE,
});

application.connect('activate', app => {
  const buffer = new Gtk.TextBuffer();
  const textView = new Gtk.TextView({
    buffer,
    monospace: true,
    hexpand: true,
    vexpand: true,
  });
  const window = new Gtk.ApplicationWindow({
    application: app,
    title: 'Clipboard X Gnome Typing Target',
    default_width: 640,
    default_height: 480,
    child: textView,
  });
  let saveSource = 0;
  const save = () => {
    saveSource = 0;
    const [start, end] = buffer.get_bounds();
    // GJS can marshal an empty Uint8Array as NULL; an empty string still writes
    // a real zero-byte snapshot when the readiness control clears the buffer.
    const text = buffer.get_text(start, end, true);
    output.replace_contents(text, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    return GLib.SOURCE_REMOVE;
  };
  buffer.connect('changed', () => {
    if (saveSource)
      GLib.source_remove(saveSource);
    saveSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, save);
  });
  window.connect('close-request', () => {
    if (saveSource)
      GLib.source_remove(saveSource);
    save();
    return false;
  });
  window.present();
  textView.grab_focus();
});

application.run([]);
