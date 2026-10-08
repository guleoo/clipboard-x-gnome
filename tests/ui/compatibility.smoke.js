import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x@guleoo.github.io';
export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function indicator() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const extension = Main.extensionManager.lookup(UUID);
    const actor = Main.panel.statusArea['clipboard-x'];
    if (extension?.enabled && actor)
      return actor;
    await Scripting.sleep(50);
  }
  const extension = Main.extensionManager.lookup(UUID);
  throw new Error(`Extension did not enable: ${extension?.error ?? 'no indicator'}`);
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return {promise, resolve};
}

async function verifyHistoryLifecycle(actor) {
  const extensionObject = actor._actions.extensionObject;
  await extensionObject._startup;
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const historical = ClipboardItem.fromText('History before delayed initialization');
  actor._controller.add(historical);
  await actor._controller.persist();
  const historicalPath = historical.primary.path;
  const storePrototype = Object.getPrototypeOf(actor._controller._store);
  const syncPrototype = Object.getPrototypeOf(extensionObject._sync);
  const load = storePrototype.load;
  const startSync = syncPrototype.start;
  const restartSync = syncPrototype.restart;
  const publishSync = syncPrototype.publish;
  const loading = deferred();
  const releaseLoad = deferred();
  let syncStarts = 0;
  let syncRestarts = 0;
  let publications = 0;
  try {
    Main.extensionManager.disableExtension(UUID);
    storePrototype.load = async function (cancellable) {
      const snapshot = await load.call(this, cancellable);
      loading.resolve();
      await releaseLoad.promise;
      return snapshot;
    };
    syncPrototype.start = async () => { syncStarts++; };
    syncPrototype.restart = async () => { syncRestarts++; };
    syncPrototype.publish = async () => {
      assert(syncStarts === 1, 'Publication ran before synchronization startup');
      publications++;
    };
    Main.extensionManager.enableExtension(UUID);
    actor = await indicator();
    await loading.promise;
    const settings = actor._settings;
    settings.set_boolean('sync-enabled', true);
    settings.set_boolean('sync-enabled', false);
    assert(syncStarts === 0 && syncRestarts === 0,
      'Synchronization started or restarted before history initialization completed');
    settings.set_boolean('sync-enabled', true);
    const publishing = extensionObject._publish(historical)
      .then(() => ({success: true}), error => ({error}));
    const incoming = ClipboardItem.fromText('Item added during delayed initialization');
    actor._controller.add(incoming, 'remote');
    await Scripting.sleep(200); // Let the normal 150 ms save deadline expire while loading is held.
    assert((await load.call(actor._controller._store)).some(item => item.id === historical.id)
        && Gio.File.new_for_path(historicalPath).query_exists(null),
      'An early item overwrote the existing history index or deleted its content');
    assert(publications === 0, 'Publication did not wait for startup to complete');
    releaseLoad.resolve();
    await extensionObject._startup;
    assert(syncStarts === 1 && actor._controller.items.some(item => item.id === historical.id)
        && actor._controller.items.some(item => item.id === incoming.id),
      'Startup lost an existing or early-arriving history item');
    assert((await publishing).success && publications === 1,
      'Publication did not resume after history and synchronization startup completed');
    settings.set_boolean('sync-enabled', false);
    await actor._controller.persist();
  } finally {
    releaseLoad.resolve();
    storePrototype.load = load;
    syncPrototype.start = startSync;
    syncPrototype.restart = restartSync;
    syncPrototype.publish = publishSync;
  }

  const latest = ClipboardItem.fromText('History immediately before disable');
  actor._controller.add(latest);
  const store = actor._controller._store;
  const save = store.save.bind(store);
  const saving = deferred();
  const releaseSave = deferred();
  let loads = 0;
  try {
    store.save = async (...args) => {
      saving.resolve();
      await releaseSave.promise;
      return save(...args);
    };
    storePrototype.load = async function (cancellable) {
      loads++;
      return load.call(this, cancellable);
    };
    syncPrototype.start = async () => { syncStarts++; };
    Main.extensionManager.disableExtension(UUID);
    await saving.promise;
    Main.extensionManager.enableExtension(UUID);
    actor = await indicator();
    const oldStartup = extensionObject._startup;
    const oldPublication = extensionObject._publish(latest)
      .then(() => ({}), error => ({error}));
    // Disable again while the previous instance is still flushing to disk.
    Main.extensionManager.disableExtension(UUID);
    Main.extensionManager.enableExtension(UUID);
    actor = await indicator();
    const expectedStarts = syncStarts;
    await Scripting.sleep(50);
    assert(loads === 0 && syncStarts === expectedStarts,
      'The replacement started loading or synchronizing before the previous save completed');
    releaseSave.resolve();
    await oldStartup;
    assert((await oldPublication).error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
      'A publication waiting on a superseded startup must be cancelled');
    actor = await indicator();
    await actor._actions.extensionObject._startup;
    assert(syncStarts === expectedStarts + 1,
      'A disabled startup continued and started synchronization on the old instance');
    const reloaded = actor._controller.items.find(item => item.id === latest.id);
    assert(reloaded && Gio.File.new_for_path(reloaded.primary.path).query_exists(null),
      'Immediate disable/re-enable lost the history item waiting for its debounced save');
  } finally {
    releaseSave.resolve();
    store.save = save;
    storePrototype.load = load;
    syncPrototype.start = startSync;
  }
  return actor;
}

export async function run() {
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  Main.overview.hide();
  let actor = await indicator();
  assert(actor._actions.extensionObject._terminalInput._device,
    'Shared backend/seat API did not create the virtual keyboard');
  assert(global.stage.context.get_backend().get_default_seat(),
    'Shared backend/seat API is unavailable');

  actor.menu.open();
  await Scripting.sleep(150);
  assert(actor.menu.isOpen, 'Main panel did not open');
  assert(actor._historyPanel.actor.orientation === Clutter.Orientation.VERTICAL,
    'Main panel must use the shared orientation property');
  assert(actor._historyPanel.scroll.get_vadjustment(),
    'Shared scroll adjustment API is unavailable');

  actor._panelManager.show('tokenizer', actor._tokenizer.createState(null, 'Hello, world!'));
  await Scripting.sleep(100);
  assert(actor._tokenizer._buttons.length > 0, 'Tokenizer panel did not render tokens');
  assert(actor._tokenizer.header.orientation === Clutter.Orientation.VERTICAL,
    'Shared panel header must use orientation');
  actor._openPhrases();
  await Scripting.sleep(100);
  assert(actor._quickPhrases.actor.orientation === Clutter.Orientation.VERTICAL,
    'Quick phrases panel must use orientation');
  actor.menu.close();

  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(150);
  assert(!Main.panel.statusArea['clipboard-x'], 'Disabling did not destroy the indicator');
  Main.extensionManager.enableExtension(UUID);
  actor = await indicator();
  actor.menu.open();
  await Scripting.sleep(100);
  assert(actor.menu.isOpen, 'Panel did not open after re-enabling');
  actor.menu.close();
  actor = await verifyHistoryLifecycle(actor);
  Main.extensionManager.disableExtension(UUID);
  print('Clipboard X: shared Shell APIs and enable/disable/re-enable passed.');
}
