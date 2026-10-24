import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, waitUntil} from '../../helpers/checks.js';
import {runChecks} from '../../helpers/run.js';

export async function startupHistory(indicator, extensionObject) {
  const {ClipboardController} = await import(`${extensionObject.dir.get_uri()}/clipboard/controller.js`);
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const {HistoryStore} = await import(`${extensionObject.dir.get_uri()}/clipboard/history/store.js`);
  const settings = {
    get_string: key => indicator._settings.get_string(key),
    get_boolean: key => key === 'private-mode' || indicator._settings.get_boolean(key),
    get_int: key => ({'history-size': 10, 'cache-size-mib': 16, 'history-retention-days': 1})[key],
    connect: () => 0,
    disconnect() {},
  };
  const deleteFixture = file => {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
      const enumerator = file.enumerate_children(Gio.FILE_ATTRIBUTE_STANDARD_NAME,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
      try {
        let info;
        while ((info = enumerator.next_file(null)))
          deleteFixture(file.get_child(info.get_name()));
      } finally { enumerator.close(null); }
    }
    file.delete(null);
  };
  for (const mode of ['automatic', 'immediate-shutdown', 'unchanged']) {
    const rootPath = GLib.dir_make_tmp('clipboard-x-startup-history-XXXXXX');
    const controller = new ClipboardController(settings);
    const store = new HistoryStore({rootPath, deviceId: indicator._settings.get_string('device-id'),
      items: () => controller.items});
    controller._store = store;
    try {
      const old = Date.now() - 2 * 86_400_000;
      const expired = ClipboardItem.fromText(`Expired startup fixture ${mode}`, {createdAt: old});
      const current = ClipboardItem.fromText(`Current startup fixture ${mode}`);
      const pinned = ClipboardItem.fromText(`Pinned startup fixture ${mode}`, {createdAt: old, favorite: true});
      const seed = mode === 'unchanged' ? [current, pinned] : [expired, current, pinned];
      await store.save(seed);
      const generation = store._saveGeneration;
      const expiredFile = mode === 'unchanged' ? null : Gio.File.new_for_path(expired.primary.path);
      const persistedItems = () => {
        const [, bytes] = Gio.File.new_for_path(store.directory().index).load_contents(null);
        return JSON.parse(new TextDecoder().decode(bytes)).items;
      };
      await controller.start();
      assert(!controller.error && controller.items.length === 2
          && controller.items.some(item => item.id === current.id)
          && controller.items.some(item => item.id === pinned.id),
        'Startup must retain current and pinned items while trimming expired regular items');
      if (mode === 'immediate-shutdown')
        await controller.destroy();
      else if (mode === 'automatic')
        assert(await waitUntil(() => !expiredFile.query_exists(null)
            && !persistedItems().some(item => item.id === expired.id)),
          'Startup pruning must persist and collect expired files without a later clipboard capture');
      else {
        await Scripting.sleep(200);
        assert(controller._saveRevision === 0 && store._saveGeneration === generation,
          'Starting unchanged history must not schedule or perform an unnecessary save');
      }
      if (expiredFile)
        assert(!expiredFile.query_exists(null), 'Pruned startup content must not survive immediate shutdown');
      const saved = persistedItems();
      assert(saved.length === 2 && saved.some(item => item.id === current.id)
          && saved.some(item => item.id === pinned.id)
          && Gio.File.new_for_path(current.primary.path).query_exists(null)
          && Gio.File.new_for_path(pinned.primary.path).query_exists(null),
        'The persisted startup index must contain exactly the retained current and pinned items');
    } finally {
      await controller.destroy();
      deleteFixture(Gio.File.new_for_path(rootPath));
    }
  }
}

export function run() {
  return runChecks([['startupHistory', startupHistory]]);
}
