"""Owned GTK3/VTE target with a real raw PTY receiver, never an emulated clipboard."""
import json
import os
from pathlib import Path
import signal
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Vte", "2.91")
from gi.repository import GLib, Gtk, Vte

directory = Path(sys.argv[1])
title = sys.argv[2]
owner = int(sys.argv[3])
child_pid = None
window = Gtk.Window(title=title)
window.set_default_size(600, 360)
terminal = Vte.Terminal()
layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
paste = Gtk.Button(label="_Paste clipboard (positive control)", use_underline=True)
paste.connect("clicked", lambda *_: (terminal.paste_clipboard(), terminal.grab_focus()))
layout.pack_start(paste, False, False, 0)
layout.pack_start(terminal, True, True, 0)
window.add(layout)


def close(*_):
    if child_pid:
        try:
            os.kill(child_pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    Gtk.main_quit()


def spawned(_terminal, pid, error, *_):
    global child_pid
    child_pid = pid if pid > 0 else None
    (directory / "spawn.json").write_text(json.dumps({"pid": pid, "error": str(error) if error else None}))


def watch_owner():
    if not Path(f"/proc/{owner}").exists():
        close()
        return False
    return True


receiver = """
import os, pathlib, sys, termios, tty
directory = pathlib.Path(sys.argv[1])
tty.setraw(0)
(directory / 'ready').write_text('ready')
with (directory / 'received').open('wb', buffering=0) as output:
    while True:
        data = os.read(0, 4096)
        if not data:
            break
        output.write(data)
"""
window.connect("destroy", close)
signal.signal(signal.SIGTERM, close)
window.show_all()
terminal.grab_focus()
terminal.spawn_async(Vte.PtyFlags.DEFAULT, None, [sys.executable, "-u", "-c", receiver, str(directory)],
                     None, GLib.SpawnFlags.DEFAULT, child_setup=None, timeout=-1,
                     cancellable=None, callback=spawned)
GLib.timeout_add(250, watch_owner)
try:
    Gtk.main()
finally:
    if child_pid:
        try:
            os.kill(child_pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
