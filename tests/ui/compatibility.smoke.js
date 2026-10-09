import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const UUID = 'clipboard-x@guleoo.github.io';
export const METRICS = {};
const WAIT_TIMEOUT_MILLISECONDS = 15_000;
const STARTUP_TIMEOUT_MILLISECONDS = 30_000;
let phase = 'module-loaded';
let startupWatchdog = 0;
let preparedSignal = 0;
let startedSignal = 0;

function stage(name) {
  phase = name;
  print(`Clipboard X [compatibility] ${name}`);
}

function startupState() {
  const layout = Main.layoutManager;
  const extension = Main.extensionManager?.lookup(UUID);
  const backgrounds = (layout?._bgManagers ?? []).map(manager =>
    manager.backgroundActor?.content?.background?.isLoaded ?? 'unknown');
  return `shellStartingUp=${layout?._startingUp ?? 'unknown'}; monitors=${layout?.monitors.length ?? 0}; backgroundLoaded=${backgrounds.join(',') || 'none'}; extensionState=${extension?.state ?? 'unknown'}; indicatorPresent=${Boolean(Main.panel?.statusArea['clipboard-x'])}`;
}

// GNOME calls init() before startup-complete and run() only after its automation helper is ready.
export function init() {
  stage('automation-init');
  stage(Main.layoutManager._startingUp ? 'waiting-for-shell-startup' : 'waiting-for-automation-run');
  preparedSignal = Main.layoutManager.connect('startup-prepared', () => stage('shell-startup-prepared'));
  startedSignal = Main.layoutManager.connect('startup-complete', () => {
    stage('shell-startup-complete');
    stage('waiting-for-automation-run');
  });
  startupWatchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, STARTUP_TIMEOUT_MILLISECONDS, () => {
    startupWatchdog = 0;
    printerr(`Clipboard X [compatibility] Timeout after ${STARTUP_TIMEOUT_MILLISECONDS} ms: ${phase}; ${startupState()}`);
    Meta.exit(Meta.ExitCode.ERROR);
    return GLib.SOURCE_REMOVE;
  });
}

function clearStartupWatchdog() {
  if (startupWatchdog)
    GLib.Source.remove(startupWatchdog);
  startupWatchdog = 0;
  if (preparedSignal)
    Main.layoutManager.disconnect(preparedSignal);
  if (startedSignal)
    Main.layoutManager.disconnect(startedSignal);
  preparedSignal = 0;
  startedSignal = 0;
}

async function wait(name, promise) {
  stage(name);
  let source = 0;
  try {
    const timeout = new Promise((_resolve, reject) => {
      source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WAIT_TIMEOUT_MILLISECONDS, () => {
        source = 0;
        reject(new Error(`Timeout after ${WAIT_TIMEOUT_MILLISECONDS} ms: ${name}; ${startupState()}`));
        return GLib.SOURCE_REMOVE;
      });
    });
    const result = await Promise.race([promise, timeout]);
    print(`Clipboard X [compatibility] ${name} completed`);
    return result;
  } finally {
    if (source)
      GLib.Source.remove(source);
  }
}

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function indicator(previous = null) {
  stage('waiting-for-indicator');
  for (let attempt = 0; attempt < 60; attempt++) {
    const extension = Main.extensionManager.lookup(UUID);
    const actor = Main.panel.statusArea['clipboard-x'];
    if (extension?.enabled && extension.state === ExtensionState.ACTIVE
        && actor && actor !== previous) {
      print('Clipboard X [compatibility] indicator ready');
      return actor;
    }
    await Scripting.sleep(50);
  }
  const extension = Main.extensionManager.lookup(UUID);
  throw new Error(`Extension did not enable: ${extension?.error ?? 'no indicator'}`);
}

async function disable() {
  stage('waiting-for-extension-disable');
  assert(Main.extensionManager.disableExtension(UUID), 'Extension disable request was rejected');
  await wait('extension-disabled', (async () => {
    while (true) {
      const extension = Main.extensionManager.lookup(UUID);
      assert(extension && extension.state !== ExtensionState.ERROR,
        `Extension failed while disabling: ${extension?.error ?? 'not installed'}`);
      if (extension.state === ExtensionState.INACTIVE && !Main.panel.statusArea['clipboard-x'])
        return;
      await Scripting.sleep(20);
    }
  })());
}

async function enable(previous) {
  assert(Main.extensionManager.enableExtension(UUID), 'Extension enable request was rejected');
  return indicator(previous);
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return {promise, resolve};
}

async function verifyHistoryLifecycle(actor) {
  const extensionObject = actor._actions.extensionObject;
  await wait('clipboard-startup', extensionObject._startup);
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const {SyncConfigurationStore} = await import(`${extensionObject.dir.get_uri()}/sync/configuration-store.js`);
  const historical = ClipboardItem.fromText('History before delayed initialization');
  actor._controller.add(historical);
  await wait('initial-history-save', actor._controller.persist());
  const historicalPath = historical.primary.path;
  const storePrototype = Object.getPrototypeOf(actor._controller._store);
  const syncPrototype = Object.getPrototypeOf(extensionObject._sync);
  const load = storePrototype.load;
  const startSync = syncPrototype.start;
  const restartSync = syncPrototype.restart;
  const publishSync = syncPrototype.publish;
  const configurationPrototype = SyncConfigurationStore.prototype;
  const loadConfiguration = configurationPrototype.load;
  const uploadConfiguration = {
    serverAddress: 'http://compatibility.invalid', apiKey: 'isolated-test-key',
    activeChannelId: '22222222-2222-4222-8222-222222222222',
  };
  const loading = deferred();
  const releaseLoad = deferred();
  let syncStarts = 0;
  let syncRestarts = 0;
  let publications = 0;
  try {
    stage('delayed-history-initialization');
    await disable();
    storePrototype.load = async function (cancellable) {
      const snapshot = await load.call(this, cancellable);
      loading.resolve();
      await releaseLoad.promise;
      return snapshot;
    };
    configurationPrototype.load = async () => ({...uploadConfiguration});
    syncPrototype.start = async function () {
      syncStarts++;
      this._configuration = {...uploadConfiguration, apiKeyConfigured: true};
      this._ready = true;
    };
    syncPrototype.restart = async () => { syncRestarts++; };
    syncPrototype.publish = async () => {
      assert(syncStarts === 1, 'Publication ran before synchronization startup');
      publications++;
    };
    actor = await enable(actor);
    await wait('history-load-hook', loading.promise);
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
    assert((await wait('existing-history-read', load.call(actor._controller._store))).some(item => item.id === historical.id)
        && Gio.File.new_for_path(historicalPath).query_exists(null),
      'An early item overwrote the existing history index or deleted its content');
    assert(publications === 0, 'Publication did not wait for startup to complete');
    releaseLoad.resolve();
    await wait('resumed-clipboard-startup', extensionObject._startup);
    assert(syncStarts === 1 && actor._controller.items.some(item => item.id === historical.id)
        && actor._controller.items.some(item => item.id === incoming.id),
      'Startup lost an existing or early-arriving history item');
    assert((await wait('startup-publication', publishing)).success && publications === 1,
      'Publication did not resume after history and synchronization startup completed');
    settings.set_boolean('sync-enabled', false);
    await wait('merged-history-save', actor._controller.persist());
  } finally {
    releaseLoad.resolve();
    storePrototype.load = load;
    syncPrototype.start = startSync;
    syncPrototype.restart = restartSync;
    syncPrototype.publish = publishSync;
    configurationPrototype.load = loadConfiguration;
  }

  const latest = ClipboardItem.fromText('History immediately before disable');
  actor._controller.add(latest);
  const store = actor._controller._store;
  const save = store.save.bind(store);
  const saving = deferred();
  const releaseSave = deferred();
  let loads = 0;
  try {
    stage('rapid-disable-reenable');
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
    await disable();
    await wait('shutdown-save-hook', saving.promise);
    actor = await enable(actor);
    const oldStartup = extensionObject._startup;
    const oldPublication = extensionObject._publish(latest)
      .then(() => ({}), error => ({error}));
    // Disable again while the previous instance is still flushing to disk.
    await disable();
    actor = await enable(actor);
    const expectedStarts = syncStarts;
    await Scripting.sleep(50);
    assert(loads === 0 && syncStarts === expectedStarts,
      'The replacement started loading or synchronizing before the previous save completed');
    releaseSave.resolve();
    await wait('superseded-startup', oldStartup);
    assert((await wait('superseded-publication', oldPublication)).error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
      'A publication waiting on a superseded startup must be cancelled');
    actor = await indicator();
    await wait('replacement-startup', actor._actions.extensionObject._startup);
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
  clearStartupWatchdog();
  stage('automation-run');
  if (Main.extensionManager._initializationPromise)
    await wait('extension-manager-initialization', Main.extensionManager._initializationPromise);
  Main.overview.hide();
  let actor = await indicator();
  assert(actor._actions.extensionObject._terminalInput._device,
    'Shared backend/seat API did not create the virtual keyboard');
  assert(global.stage.context.get_backend().get_default_seat(),
    'Shared backend/seat API is unavailable');

  stage('main-panel');
  actor.menu.open();
  await Scripting.sleep(150);
  assert(actor.menu.isOpen, 'Main panel did not open');
  assert(actor._historyPanel.actor.orientation === Clutter.Orientation.VERTICAL,
    'Main panel must use the shared orientation property');
  assert(actor._historyPanel.scroll.get_vadjustment(),
    'Shared scroll adjustment API is unavailable');

  stage('tokenizer-panel');
  actor._panelManager.show('tokenizer', actor._tokenizer.createState(null, 'Hello, world!'));
  await Scripting.sleep(100);
  assert(actor._tokenizer._buttons.length > 0, 'Tokenizer panel did not render tokens');
  assert(actor._tokenizer.header.orientation === Clutter.Orientation.VERTICAL,
    'Shared panel header must use orientation');
  stage('quick-phrases-panel');
  actor._openPhrases();
  await Scripting.sleep(100);
  assert(actor._quickPhrases.actor.orientation === Clutter.Orientation.VERTICAL,
    'Quick phrases panel must use orientation');
  actor.menu.close();

  stage('disable-reenable');
  await disable();
  actor = await enable(actor);
  actor.menu.open();
  await Scripting.sleep(100);
  assert(actor.menu.isOpen, 'Panel did not open after re-enabling');
  actor.menu.close();
  actor = await verifyHistoryLifecycle(actor);
  stage('final-disable');
  await disable();
  stage('completed');
  print('Clipboard X: shared Shell APIs and enable/disable/re-enable passed.');
}
