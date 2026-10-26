import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ClipboardItem} from '../../../../src/clipboard/item.js';
import {assert, fixture, pause, until, removeTree} from '../controller-fixture.js';

async function startupHistory() {
  for (const mode of ['automatic', 'immediate-shutdown', 'unchanged']) {
    const rootPath = GLib.dir_make_tmp('clipboard-x-startup-history-XXXXXX');
    const {controller} = fixture({rootPath, values: {'private-mode': true, 'history-size': 10, 'history-retention-days': 1}});
    const store = controller._store;
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
        await until(() => !expiredFile.query_exists(null)
            && !persistedItems().some(item => item.id === expired.id),
          'Startup pruning must persist and collect expired files without a later clipboard capture');
      else {
        await pause(200);
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
      removeTree(Gio.File.new_for_path(rootPath));
    }
  }
}

await startupHistory();

async function orderingAndLimits() {
  const {controller, settings, rootPath} = fixture();
  try {
    await controller.start();
    const local = settings.get_string('device-id');
    const remote = GLib.uuid_string_random();
    const entries = [
      ['older local', 100, false, local], ['newer remote', 400, false, remote],
      ['older pinned remote', 200, true, remote], ['newer pinned local', 300, true, local],
    ].map(([text, createdAt, favorite, originDeviceId]) =>
      ClipboardItem.fromText(text, {createdAt, favorite, originDeviceId, remote: originDeviceId === remote}));
    for (const item of entries) controller.add(item);
    const expected = ['newer pinned local', 'older pinned remote', 'newer remote', 'older local'];
    assert(controller.items.map(item => item.text).join('|') === expected.join('|'),
      'Pin and timestamp ordering must not depend on local/remote origin');
    await controller.persist();
    const restored = fixture({rootPath, values: {'device-id': local}});
    try {
      await restored.controller.start();
      assert(restored.controller.items.map(item => item.text).join('|') === expected.join('|'),
        'Reloading mixed-device files must restore the same pin and timestamp ordering');
    } finally { await restored.controller.destroy(); }
    settings.set_int('history-size', 1);
    assert(controller.items.length === 3 && controller.items.filter(item => item.favorite).length === 2,
      'Reducing the ordinary history count must protect every pinned item');
    controller.clear();
    assert(controller.items.length === 2 && controller.items.every(item => item.favorite),
      'Clear must retain pins across origins');
    controller.toggleFavorite(entries[2].id);
    assert(!controller.items.find(item => item.id === entries[2].id).favorite,
      'Unpin must restore ordinary status without losing the item');
  } finally { await controller.destroy(); removeTree(Gio.File.new_for_path(rootPath)); }
}

async function persistenceFailure() {
  const {controller, rootPath} = fixture();
  try {
    await controller.start();
    controller.add(ClipboardItem.fromText('previous valid durable index'));
    await controller.persist();
    const index = Gio.File.new_for_path(controller._store.directory().index);
    const backup = index.get_parent().get_child('valid-index-backup.json');
    const [, before] = index.load_contents(null);
    const cancelled = new Gio.Cancellable();
    cancelled.cancel();
    let cancelledError;
    try { await controller._store.save(controller.items, cancelled); } catch (error) { cancelledError = error; }
    assert(cancelledError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
      && GLib.base64_encode(before) === GLib.base64_encode(index.load_contents(null)[1]),
    'A cancelled real save must leave the existing original index byte-exact at its unchanged path');
    // Obstruct the real index pathname, not an alternate store.directory().
    // A directory deterministically fails even when the suite runs as root.
    index.move(backup, Gio.FileCopyFlags.NONE, null, null);
    index.make_directory(null);
    let failure;
    try { await controller.persist(); } catch (error) { failure = error; }
    assert(failure?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.IS_DIRECTORY),
      'Saving to the obstructed real index path must report the actual filesystem error');
    assert(index.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY,
      'Failed replacement must not pretend to have published an index');
    const [, kept] = backup.load_contents(null);
    assert(GLib.base64_encode(before) === GLib.base64_encode(kept),
      'The last valid durable index must remain byte-exact for recovery');
    index.delete(null);
    backup.move(index, Gio.FileCopyFlags.NONE, null, null);
    assert((await controller._store.load()).some(item => item.text === 'previous valid durable index'),
      'Restoring the real path must recover the valid committed snapshot');
    controller.add(ClipboardItem.fromText('new content after actual IO recovery'));
    await controller.persist();
    assert((await controller._store.load()).some(item => item.text === 'new content after actual IO recovery'),
      'A real successful retry must persist newer content after the obstruction is removed');
  } finally { await controller.destroy(); removeTree(Gio.File.new_for_path(rootPath)); }
}

async function lifecycleBoundaries() {
  const early = fixture();
  try {
    const item = ClipboardItem.fromText('write screenshot before start');
    await early.controller.writeScreenshot(item);
    assert(early.writes.length === 1 && early.writes[0][1] === item.primary.mimeType,
      'Clipboard output must remain available before history initialization');
    early.controller.add(item, 'screenshot');
    await early.controller.start();
    assert(early.controller.items.some(value => value.id === item.id),
      'Starting must retain a screenshot added before the initial load completes');
  } finally { await early.controller.destroy(); removeTree(Gio.File.new_for_path(early.rootPath)); }

  const stopped = fixture();
  let release;
  const previousShutdown = new Promise(resolve => { release = resolve; });
  const starting = stopped.controller.start({afterShutdown: previousShutdown});
  const stopping = stopped.controller.destroy();
  release();
  try {
    await starting;
    await stopping;
    assert(stopped.controller._selectionSignal === 0 && stopped.controller._settingsSignals.length === 0
      && stopped.platform.selection._eventHandlers.size === 0,
    'Destroy during a pending start must not attach platform or settings signals later');
    await stopped.controller.start();
    assert(stopped.controller._selectionSignal === 0, 'Starting a destroyed controller must not reconnect');
    assert(await stopped.controller.capture() === null && stopped.writes.length === 0,
      'A destroyed controller must not capture or write to its platform');
  } finally { removeTree(Gio.File.new_for_path(stopped.rootPath)); }
}

await orderingAndLimits();
await persistenceFailure();
await lifecycleBoundaries();
