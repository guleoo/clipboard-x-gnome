import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const UUID = 'clipboard-x-gnome@guleoo.github.io';
export const STATUS_AREA_NAME = 'clipboard-x-gnome';

export function fixturePath(name) {
  return Gio.File.new_for_uri(import.meta.url).get_parent()
    .get_parent().get_parent().get_child('fixtures').get_child(name).get_path();
}

export function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

export function capturedKeyEvent(key, modifiers = 0) {
  return {
    type: () => Clutter.EventType.KEY_PRESS,
    get_key_symbol: () => key,
    get_state: () => modifiers,
  };
}

export async function waitUntil(predicate, timeoutMilliseconds = 2000) {
  const deadline = GLib.get_monotonic_time() + timeoutMilliseconds * 1000;
  while (!predicate() && GLib.get_monotonic_time() < deadline)
    await Scripting.sleep(50);
  return predicate();
}

export function waitForExit(process) {
  return new Promise((resolve, reject) => {
    process.wait_async(null, (source, result) => {
      try {
        resolve(source.wait_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function scenario(name, settings, action) {
  print(`Clipboard X Gnome [smoke] ${name}`);
  const snapshot = new Map(settings.list_keys().map(key => [key, settings.get_value(key)]));
  try {
    await action();
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, {cause: error});
  } finally {
    for (const [key, value] of snapshot) {
      if (!settings.get_value(key).equal(value))
        settings.set_value(key, value);
    }
  }
}

export function imageBytes() {
  const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 200, 100);
  image.fill(0x336699ff);
  const [encoded, bytes] = image.save_to_bufferv('png', [], []);
  assert(encoded, 'Could not encode the rectangular clipboard image fixture');
  return bytes;
}
