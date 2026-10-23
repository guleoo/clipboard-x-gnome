import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const UUID = 'clipboard-x-gnome@guleoo.github.io';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function captureScopes(extensionObject, defaults) {
  const {ClipboardController} = await import(`${extensionObject.dir.get_uri()}/clipboard/controller.js`);
  const {HistoryStore} = await import(`${extensionObject.dir.get_uri()}/clipboard/history/store.js`);
  const {bytesFromString, sha256} = await import(`${extensionObject.dir.get_uri()}/common/bytes.js`);
  const {writeFile} = await import(`${extensionObject.dir.get_uri()}/common/files.js`);
  const root = GLib.dir_make_tmp('clipboard-x-capture-scopes-XXXXXX');
  const controllers = [];
  const create = async name => {
    const values = new Map(Object.entries({
      'private-mode': false, 'sensitive-content-mode': 'memory', 'excluded-apps': [],
      'trim-whitespace': false, 'history-size': 100, 'cache-size-mib': 16,
      'history-retention-days': 0, 'capture-size-limit-mib': 16,
    }));
    const signals = new Map();
    let nextSignal = 0;
    const settings = {connect(name, callback) { signals.set(++nextSignal, {name, callback}); return nextSignal; },
      disconnect: id => signals.delete(id),
      set(key, value) {
        values.set(key, value);
        for (const signal of signals.values()) {
          if (signal.name === `changed::${key}`)
            signal.callback(settings);
        }
      }};
    for (const type of ['boolean', 'string', 'strv', 'uint', 'int']) {
      settings[`get_${type}`] = key => values.has(key) ? values.get(key) : defaults[`get_${type}`](key);
    }
    const controller = new ClipboardController(settings);
    controller._store = new HistoryStore({rootPath: `${root}/${name}`,
      deviceId: defaults.get_string('device-id'), items: () => controller.items});
    controllers.push(controller);
    await controller.start();
    const selection = controller._selection;
    controller._selection = {get_mimetypes: () => ['text/plain;charset=utf-8'],
      disconnect: id => selection.disconnect(id)};
    controller._readSelectionContent = async () => bytesFromString(`capture ${name}`);
    return {controller, settings};
  };
  const idle = async controller => {
    for (let attempt = 0; attempt < 100 && controller._captureInProgress; attempt++)
      await Scripting.sleep(10);
    assert(!controller._captureInProgress && !controller._captureCancellable,
      'A completed or cancelled capture must release its scope');
  };
  const removeFixture = file => {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
      const enumerator = file.enumerate_children(Gio.FILE_ATTRIBUTE_STANDARD_NAME,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
      try {
        let info;
        while ((info = enumerator.next_file(null)))
          removeFixture(file.get_child(info.get_name()));
      } finally { enumerator.close(null); }
    }
    file.delete(null);
  };
  try {
    const {controller, settings} = await create('owners');
    settings.set('sensitive-content-mode', 'discard');
    controller._selection.get_mimetypes = () => ['text/plain;charset=utf-8', 'text/html'];
    const firstRead = deferred();
    const releaseFirst = deferred();
    let reads = 0;
    let scope;
    controller._readSelectionContent = async (_mime, _limit, cancellable) => {
      reads++;
      scope = cancellable;
      firstRead.resolve();
      await releaseFirst.promise;
      return bytesFromString('obsolete public owner');
    };
    const obsolete = controller.capture();
    await firstRead.promise;
    controller._selection.get_mimetypes = () => ['application/x-keepass2', 'text/plain;charset=utf-8', 'text/html'];
    controller._requestCapture();
    assert(scope.is_cancelled(), 'Owner changes must cancel the current MIME transfer scope immediately');
    releaseFirst.resolve();
    assert(await obsolete === null, 'An owner change must discard the entire previous capture');
    await idle(controller);
    await controller.persist();
    assert(reads === 1 && controller.items.length === 0 && (await controller._store.load()).length === 0,
      'A sensitive replacement must not leak secondary MIME bytes into an ordinary persisted item');

    controller._selection.get_mimetypes = () => ['text/plain;charset=utf-8'];
    const entered = deferred();
    const release = deferred();
    reads = 0;
    controller._readSelectionContent = async () => {
      if (++reads === 1) { entered.resolve(); await release.promise; return bytesFromString('old owner'); }
      return bytesFromString('latest queued owner');
    };
    const replaced = controller.capture();
    await entered.promise;
    controller._requestCapture();
    release.resolve();
    assert(await replaced === null, 'Replacing an ordinary owner must also invalidate its old capture');
    await idle(controller);
    assert(reads === 2 && controller.items.length === 1 && controller.items[0].text === 'latest queued owner',
      'The queued owner must start with a fresh uncancelled scope');
    await controller.destroy();

    for (const [key, changed, restored] of [
      ['private-mode', true, false], ['sensitive-content-mode', 'discard', 'memory'],
      ['excluded-apps', ['excluded-fixture'], []],
    ]) {
      const fixture = await create(key);
      const entered = deferred();
      const release = deferred();
      fixture.controller._readSelectionContent = async () => { entered.resolve(); await release.promise; return bytesFromString(key); };
      const capturing = fixture.controller.capture();
      await entered.promise;
      fixture.settings.set(key, changed);
      fixture.settings.set(key, restored);
      release.resolve();
      assert(await capturing === null && fixture.controller.items.length === 0,
        `Changing ${key} and changing it back must still invalidate the active snapshot`);
      await idle(fixture.controller);
      fixture.controller._readSelectionContent = async () => bytesFromString(`fresh ${key}`);
      assert(await fixture.controller.capture(), 'Policy cancellation must not poison a later capture');
      await fixture.controller.destroy();
    }

    const preparing = await create('prepared');
    const prepared = deferred();
    const releasePrepared = deferred();
    preparing.controller._prepareItem = async (item, cancellable) => {
      const bytes = bytesFromString('isolated preview');
      const preview = {mimeType: 'image/png', size: bytes.get_size(), sha256: sha256(bytes),
        derivedFrom: item.primary.id, truncated: true};
      await preparing.controller._store.stage(preview,
        path => writeFile(Gio.File.new_for_path(path), bytes, cancellable), cancellable);
      item.preview = preview;
      prepared.resolve();
      await releasePrepared.promise;
    };
    const preparingCapture = preparing.controller.capture();
    await prepared.promise;
    preparing.settings.set('private-mode', true);
    releasePrepared.resolve();
    assert(await preparingCapture === null && preparing.controller.items.length === 0
        && preparing.controller._store._staged.size === 0,
      'Cancellation after preview preparation must discard staging before commit');
    await preparing.controller.destroy();

    const failing = await create('failures');
    for (const error of [new Error('Injected transfer failure'),
      new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Injected transfer cancellation'})]) {
      failing.controller._readSelectionContent = async () => { throw error; };
      assert(await failing.controller.capture() === null, 'Failed transfers must not create incomplete history');
      await idle(failing.controller);
    }
    const prepare = failing.controller._prepareItem;
    const preparationError = new Error('Injected preparation failure');
    failing.controller._readSelectionContent = async () => bytesFromString('preparation failure fixture');
    failing.controller._prepareItem = async () => { throw preparationError; };
    let caught;
    try { await failing.controller.capture(); } catch (error) { caught = error; }
    assert(caught === preparationError && failing.controller.items.length === 0,
      'Unexpected preparation errors must propagate without committing or retaining the capture scope');
    await idle(failing.controller);
    failing.controller._prepareItem = prepare;
    failing.controller._readSelectionContent = async () => bytesFromString('capture after preparation failure');
    assert(await failing.controller.capture(), 'A preparation error must not block future captures');
    const stopping = deferred();
    const releaseStop = deferred();
    failing.controller._readSelectionContent = async () => { stopping.resolve(); await releaseStop.promise; return bytesFromString('after disable'); };
    const stoppedCapture = failing.controller.capture();
    await stopping.promise;
    const shutdown = failing.controller.destroy();
    releaseStop.resolve();
    assert(await stoppedCapture === null, 'Disabling during a transfer must prevent its late commit');
    await shutdown;
    const restarted = await create('failures');
    assert(await restarted.controller.capture(), 'A new controller must capture normally after the old shutdown');
    await restarted.controller.destroy();
  } finally {
    await Promise.all(controllers.map(controller => controller.destroy()));
    removeFixture(Gio.File.new_for_path(root));
  }
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.stateObj, 'Clipboard X Gnome extension is unavailable');
  const indicator = Main.panel.statusArea['clipboard-x-gnome'];
  assert(indicator, 'Clipboard X Gnome indicator is unavailable');
  await captureScopes(extension.stateObj, indicator._settings);

  const controller = indicator._controller;
  const settings = indicator._settings;
  const originalSelection = controller._selection;
  const originalReadSelectionContent = controller._readSelectionContent;
  const originalSensitiveMode = settings.get_string('sensitive-content-mode');
  const originalSyncEnabled = settings.get_boolean('sync-enabled');
  const originalSendMode = settings.get_string('sync-send-mode');
  const originalFavoritesOnly = settings.get_boolean('sync-favorites-only');
  const publish = extension.stateObj._publish;
  const pinFixtures = [];
  const text = `sensitive-capture-${GLib.uuid_string_random()}`;
  let markedItem = null;

  try {
    settings.set_boolean('sync-enabled', false);
    settings.set_string('sensitive-content-mode', 'memory');
    controller._selection = {get_mimetypes: () => ['text/plain;charset=utf-8']};
    controller._readSelectionContent = () => Promise.resolve(
      new GLib.Bytes(new TextEncoder().encode(text)));

    const ordinaryItem = await controller.capture();
    await controller.persist();
    assert(ordinaryItem?.primary.path, 'Ordinary clipboard content did not persist');

    controller._selection.get_mimetypes = () => [
      'application/x-keepass2', 'text/plain;charset=utf-8',
    ];
    markedItem = await controller.capture();
    assert(markedItem?.sensitive && markedItem.id !== ordinaryItem.id
        && !controller.items.includes(ordinaryItem),
    'Sensitive recopy did not replace the ordinary duplicate');
    await controller.persist();
    assert(!markedItem.primary.path
        && !GLib.file_test(ordinaryItem.primary.path, GLib.FileTest.EXISTS)
        && !(await controller._store.load()).some(item => item.primary.sha256 === markedItem.primary.sha256),
    'Sensitive content remained in persistent history');

    let refusal = null;
    try {
      await extension.stateObj._publish(markedItem);
    } catch (error) {
      refusal = error;
    }
    assert(refusal?.code === 'sensitive_content',
      'Manual synchronization did not reject sensitive content');

    settings.set_boolean('sync-enabled', true);
    const row = indicator._historyPanel.entry(markedItem);
    assert(!row.focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'sync'),
      'Sensitive history row exposed a synchronization action');
    row.destroy();

    settings.set_string('sensitive-content-mode', 'discard');
    assert(await controller.capture() === null,
      'Discard policy recorded marked content');

    const {ClipboardItem} = await import(`${extension.stateObj.dir.get_uri()}/clipboard/item.js`);
    let publications = 0;
    extension.stateObj._publish = async () => publications++;
    settings.set_string('sync-send-mode', 'automatic');
    settings.set_boolean('sync-favorites-only', true);
    for (const remote of [true, false]) {
      const item = ClipboardItem.fromText(`pin-source-${remote}-${GLib.uuid_string_random()}`, {
        originDeviceId: remote ? GLib.uuid_string_random() : settings.get_string('device-id'), remote,
      });
      pinFixtures.push(item);
      controller.add(item, remote ? 'remote' : 'local');
      controller.toggleFavorite(item.id);
      await Scripting.sleep(10);
      assert(publications === (remote ? 0 : 1),
        'Pinning received content must not publish it, while eligible local pins must still publish');
    }
  } finally {
    extension.stateObj._publish = publish;
    for (const item of pinFixtures)
      controller.remove(item.id);
    if (markedItem)
      controller.remove(markedItem.id);
    controller._selection = originalSelection;
    controller._readSelectionContent = originalReadSelectionContent;
    settings.set_string('sensitive-content-mode', originalSensitiveMode);
    settings.set_boolean('sync-enabled', originalSyncEnabled);
    settings.set_string('sync-send-mode', originalSendMode);
    settings.set_boolean('sync-favorites-only', originalFavoritesOnly);
  }
}
