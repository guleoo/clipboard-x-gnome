import Gdk from 'gi://Gdk?version=3.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=3.0';

Gtk.init(null);
const clipboard = Gtk.Clipboard.get(Gdk.Atom.intern('CLIPBOARD', false));
clipboard.set_text(ARGV[0] ?? 'Clipboard X Gnome XWayland source', -1);
GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1500, () => Gtk.main_quit());
Gtk.main();
