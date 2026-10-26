import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {bytesFromString, sha256} from '../../../src/common/bytes.js';
import {writeFile} from '../../../src/common/files.js';
import {assert, fixture, pause, removeTree, until} from './controller-fixture.js';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function captureScopes() {
  const root = GLib.dir_make_tmp('clipboard-x-capture-scopes-XXXXXX');
  const controllers = [];
  const create = async name => {
    const result = fixture({rootPath: root + '/' + name});
    controllers.push(result.controller);
    await result.controller.start();
    result.controller._readSelectionContent = async () => bytesFromString('capture ' + name);
    return result;
  };
  const idle = async controller => {
    for (let attempt = 0; attempt < 100 && controller._captureInProgress; attempt++)
      await pause(10);
    assert(!controller._captureInProgress && !controller._captureCancellable,
      'A completed or cancelled capture must release its scope');
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
    const previousSelection = controller.selectionRevision;
    controller._requestCapture();
    assert(controller.selectionRevision === previousSelection + 1,
      'Clipboard owner changes must invalidate automatic writing before capture or privacy filtering');
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
    removeTree(Gio.File.new_for_path(root));
  }
}

await captureScopes();

// Exercise the actual controller signal subscription against the narrow
// platform contract; the cancellation matrices above control the byte reader.
const connected = fixture();
try {
  await connected.controller.start();
  connected.controller._readSelectionContent = async () => bytesFromString('platform owner signal');
  const revision = connected.controller.selectionRevision;
  connected.platform.selection.emit('owner-changed', connected.platform.selectionType + 1);
  assert(connected.controller.selectionRevision === revision,
    'A non-clipboard selection signal must not trigger capture');
  connected.platform.selection.emit('owner-changed', connected.platform.selectionType);
  await until(() => connected.controller.items.some(item => item.text === 'platform owner signal'),
    'The clipboard selection signal must execute actual capture');
  await connected.controller.destroy();
  connected.platform.selection.emit('owner-changed', connected.platform.selectionType);
  assert(connected.platform.selection._eventHandlers.size === 0
    && connected.controller.selectionRevision === revision + 1,
  'Destroy must disconnect the platform signal before later owner notifications');
} finally {
  await connected.controller.destroy();
  removeTree(Gio.File.new_for_path(connected.rootPath));
}
