import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const output = Gio.File.new_for_path(ARGV[0]);
const application = new Gtk.Application({
  application_id: 'io.github.guleoo.ClipboardXTypingTarget',
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
    title: 'Clipboard X Typing Target',
    default_width: 640,
    default_height: 480,
    child: textView,
  });
  let saveSource = 0;
  const save = () => {
    saveSource = 0;
    const [start, end] = buffer.get_bounds();
    const bytes = new TextEncoder().encode(buffer.get_text(start, end, true));
    output.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
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
