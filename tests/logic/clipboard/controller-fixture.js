import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ClipboardController} from '../../../src/clipboard/controller.js';
import {HistoryStore} from '../../../src/clipboard/history/store.js';
import {EventEmitter} from '../../../src/common/event-emitter.js';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export const pause = milliseconds => new Promise(resolve => GLib.timeout_add(
  GLib.PRIORITY_DEFAULT, milliseconds, () => { resolve(); return GLib.SOURCE_REMOVE; }));
export async function until(predicate, message, timeout = 3000) {
  const deadline = GLib.get_monotonic_time() + timeout * 1000;
  while (!predicate() && GLib.get_monotonic_time() < deadline) await pause(10);
  assert(predicate(), message);
}
export function removeTree(file) {
  if (!file.query_exists(null)) return;
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
    const children = file.enumerate_children(Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    try {
      let child;
      while ((child = children.next_file(null))) removeTree(file.get_child(child.get_name()));
    } finally { children.close(null); }
  }
  file.delete(null);
}

export function fixture({rootPath = GLib.dir_make_tmp('cbx-controller-logic-XXXXXX'), values = {}} = {}) {
  const current = new Map(Object.entries({
    'device-id': GLib.uuid_string_random(), 'device-tag': 'Logic test', 'device-icon-kind': 'computer',
    'private-mode': false, 'sensitive-content-mode': 'memory', 'excluded-apps': [], 'trim-whitespace': false,
    'history-size': 100, 'cache-size-mib': 16, 'history-retention-days': 0,
    'capture-size-limit-mib': 16, 'text-preview-limit': 4096, 'thumbnail-size': 320,
    'thumbnail-byte-limit': 262144, ...values,
  }));
  const settings = new EventEmitter();
  settings.set = (key, value) => {
    current.set(key, value);
    settings.emit('changed::' + key);
  };
  for (const type of ['boolean', 'string', 'strv', 'uint', 'int']) {
    settings['get_' + type] = key => {
      assert(current.has(key), 'Unexpected controller setting: ' + key);
      return current.get(key);
    };
    settings['set_' + type] = (key, value) => settings.set(key, value);
  }
  const selection = new EventEmitter();
  selection.get_mimetypes = () => ['text/plain;charset=utf-8'];
  const writes = [];
  const platform = {selection, selectionType: 1, clipboardType: 1, focusedApp: () => null,
    clipboard: {set_content: (...args) => writes.push(args)}};
  const controller = new ClipboardController(settings, {platform});
  controller._store = new HistoryStore({rootPath, deviceId: settings.get_string('device-id'),
    items: () => controller.items});
  return {controller, settings, platform, writes, rootPath};
}
