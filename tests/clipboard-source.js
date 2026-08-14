import Gdk from 'gi://Gdk?version=3.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=3.0';

Gtk.init();
const clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD);
clipboard.set_text(ARGV[0] ?? 'Clipboard X XWayland source', -1);
GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1500, () => Gtk.main_quit());
Gtk.main();
