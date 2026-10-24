import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncClient} from '../../../src/sync/client.js';
import {MemoryProgressStore} from './fixtures/progress-store.js';
import {transfer as wireTransfer, publication as wirePublication} from './fixtures/wire.js';
import {MAX_TRANSFER_STATES} from '../../../src/sync/constants.js';

const deviceId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';
const transferId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Lifecycle test did not reach its expected stage')), 3000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const observe = promise => promise.then(value => ({value}), error => ({error}));
const copy = value => JSON.parse(JSON.stringify(value));

class Settings {
  constructor() {
    this.values = new Map([
      ['sync-enabled', true], ['device-id', deviceId], ['device-tag', 'Current device'],
      ['device-icon-kind', 'laptop'], ['sync-poll-interval-seconds', 3600],
      ['text-full-threshold', 4096],
    ]);
    this.signals = new Map();
    this.next = 1;
  }

  get_boolean(key) { return Boolean(this.values.get(key)); }
  get_string(key) { return String(this.values.get(key) ?? ''); }
  get_uint(key) { return Number(this.values.get(key) ?? 0); }
  set_string(key, value) { this.values.set(key, value); }
  connect(name, callback) {
    const id = this.next++;
    this.signals.set(id, {name, callback});
    return id;
  }
  disconnect(id) { this.signals.delete(id); }
}

class Store {
  constructor() {
    this.value = {
      serverAddress: 'http://memory.invalid', apiKey: 'memory-key',
      activeChannelId: channelId,
    };
    this.loads = [];
    this.saves = [];
  }

  load() { return this.loads.length ? this.loads.shift().promise : Promise.resolve(copy(this.value)); }
  saveConnection(value) { return this.save('connection', value); }
  save(kind, value) {
    this.saves.push({kind, value: copy(value)});
    this.value = copy(value);
    return Promise.resolve(copy(value));
  }
}

function device(tag = 'Current device') {
  return {id: deviceId, tag, iconKind: 'laptop', state: 'online', lastSeenAt: 1};
}

function transfer(state = 'completed') {
  return wireTransfer({id: transferId, itemId, deviceId, state});
}

function sourceTransfer(state = 'queued') {
  return {...transfer(state), kind: 'content', totalBytes: 4,
    completedBytes: state === 'completed' ? 4 : 0};
}

const sourceWork = {id: transferId, type: 'materialize-content', itemId, contentId: 'content'};
const localSource = {
  representations: [{id: 'content', mimeType: 'text/plain', size: 4,
    bytes: new Uint8Array([1, 2, 3, 4])}],
};
const sourceItem = id => id === itemId ? localSource : null;

class Transport {
  constructor(name) {
    this.name = name;
    this.calls = [];
    this.gates = new Map();
    this.aborted = false;
    this.activeTransfers = false;
    this.workValues = [];
  }

  hold(method) {
    const gate = {...deferred(), entered: deferred()};
    this.gates.set(method, gate);
    return gate;
  }

  reply(method, value) {
    this.calls.push(method);
    const gate = this.gates.get(method);
    if (gate) {
      this.gates.delete(method);
      gate.entered.resolve();
      // Deliberately ignore abort/cancellation: late replies must be guarded by the client.
      return gate.promise;
    }
    return Promise.resolve(value);
  }

  status() {
    return this.reply('status', {
      apiVersion: 1, serverVersion: this.name, state: 'online', revision: 1,
      capabilities: {supportedMimeTypes: [], maxItemBytes: 1024, maxPreviewBytes: 512},
    });
  }
  device() { return this.reply('device', device()); }
  updateProfile(profile) { return this.reply('profile', device(profile.tag)); }
  channels() { return this.reply('channels', {channels: [{id: channelId, name: this.name}]}); }
  transfers() {
    return this.reply('transfers', {transfers: this.activeTransfers ? [transfer('queued')] : []});
  }
  transfer() { return this.reply('transfer', transfer()); }
  cancel() { return this.reply('cancel', {}); }
  changes(_channel, cursor) {
    return this.reply('changes', {cursor: cursor || `${this.name}-changes`, changes: [], hasMore: false});
  }
  work(cursor) {
    return this.reply('work', {cursor: cursor || `${this.name}-work`, work: this.workValues, hasMore: false});
  }
  acceptWork() {
    return this.reply('acceptWork', {uploadId: itemId, transfer: sourceTransfer()});
  }
  rejectWork(workId, code) {
    this.rejection = {workId, code};
    return this.reply('rejectWork', {});
  }
  uploadContent(_upload, _content, _source, onProgress, cancellable) {
    this.upload = {onProgress, cancellable};
    return this.reply('uploadContent', {});
  }
  completeUpload() {
    return this.reply('completeUpload', {transfer: sourceTransfer('completed')});
  }
  abort() { this.aborted = true; }
}

class PublicationTransport extends Transport {
  createItem(_channelId, manifest) {
    this.publication = wirePublication(manifest, {deviceId, uploadId: itemId, transferId});
    return this.reply('createItem', this.publication);
  }

  uploadPreview(_upload, _preview, _source, onProgress, cancellable) {
    this.upload = {onProgress, cancellable};
    return this.reply('uploadPreview', {});
  }

  completeUpload() {
    return this.reply('completeUpload', this.completedPublication());
  }

  completedPublication() {
    return {transfer: {...this.publication.transfer, state: 'completed',
      completedBytes: this.publication.transfer.totalBytes}};
  }
}

class DownloadTransport extends Transport {
  item() {
    return this.reply('item', {
      id: itemId, createdAt: 1,
      origin: {deviceId, tag: 'Source', iconKind: 'laptop'},
      contents: [{id: 'content', mimeType: 'text/plain', size: 4,
        sha256: 'a'.repeat(64), delivery: 'on-demand'}],
      previews: [],
    });
  }

  contentResponse() {
    return {transfer: {...sourceTransfer('completed'), direction: 'download'}};
  }

  requestContent() {
    return this.reply('requestContent', this.contentResponse());
  }

  downloadContent(_channel, _item, _content, _path, options) {
    this.download = options;
    return this.reply('downloadContent', {path: '/unused-downloaded-test-double'});
  }
}

const publicationItem = {
  id: itemId, createdAt: 1, sensitive: false,
  representations: [{id: 'content', mimeType: 'text/plain', size: 4,
    sha256: 'a'.repeat(64), delivery: 'eager', path: '/unused-publication-test-double'}],
  preview: {mimeType: 'text/plain', text: 'test', derivedFrom: 'content', truncated: false},
};
function remoteItem() {
  const item = copy(publicationItem);
  item.remote = true;
  item.originDeviceId = deviceId;
  item.availability = 'preview';
  item.representations[0].path = null;
  return item;
}
const cancelled = () => new Gio.IOErrorEnum({
  code: Gio.IOErrorEnum.CANCELLED, message: 'Operation was cancelled',
});
const assertCancelled = result => assert(
  result.error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
  'A superseded publication must reject with cancellation, not succeed or return an unrelated error',
);

const logger = {
  run(_operation, callback) { return Promise.resolve().then(() => callback({step: (_phase, action) => action()})); },
  info() {},
  error() {},
};

function fixture(transports = [new Transport('current')], options = {}) {
  const settings = new Settings();
  const store = new Store();
  const progressStore = new MemoryProgressStore();
  const created = [];
  const events = [];
  const client = new SyncClient(settings, {
    configurationStore: store,
    progressStore,
    async stageFile(reference, write, cancellable) {
      const targetPath = '/unused-staged-test-double';
      await write(targetPath);
      cancellable.set_error_if_cancelled();
      reference.path = targetPath;
    },
    transportFactory(configuration, options) {
      const transport = transports[created.length];
      assert(transport, 'Stale initialization must not create an additional transport');
      created.push({transport, configuration: copy(configuration), cancellable: options.cancellable});
      return transport;
    },
    logger,
    ...options,
  });
  for (const event of ['status-changed', 'transfer-changed', 'publication-cancelled', 'poll-completed']) {
    client.connect(event, (_client, ...args) => events.push({event, args: copy(args)}));
  }
  return {client, settings, store, progressStore, created, events};
}

function snapshot(f) {
  return JSON.stringify({
    connected: f.client._connected, ready: f.client.ready, capabilities: f.client._capabilities,
    configuration: f.client.configuration, state: f.client._state, channels: f.client._channels,
    transfer: f.client.getTransferForItem(itemId), events: f.events,
    saves: f.store.saves,
    progressSaves: f.progressStore.saves,
  });
}

const replies = {
  status: {apiVersion: 1, serverVersion: 'stale', state: 'degraded', revision: 99, capabilities: {}},
  device: device('Stale device'), profile: device('Stale profile'),
  channels: {channels: [{id: channelId, name: 'Stale channel'}]},
  transfers: {transfers: [transfer()]}, transfer: transfer(),
  changes: {cursor: 'stale-changes', hasMore: false, changes: [{itemId, sequence: 1, kind: 'remove'}]},
  work: {cursor: 'stale-work', hasMore: false, work: []},
};

const failures = [];
async function test(name, action) {
  try {
    await action();
    print(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    print(`FAIL ${name}: ${error.message}`);
  }
}

await test('upload replay waits for the complete initialization pipeline', async () => {
  const transport = new Transport('current');
  const gate = transport.hold('work');
  const f = fixture([transport]);
  const pending = observe(f.client.start());
  try {
    await bounded(gate.entered.promise);
    assert(f.client._connected && !f.client.ready,
      'authentication alone must not expose a ready upload destination');
    assert(!f.events.some(value => value.event === 'poll-completed'),
      'an incomplete startup must not wake the durable upload queue');
    gate.resolve({cursor: 'initial', hasMore: false, work: []});
    await bounded(pending);
    assert(f.client.ready, 'uploads may resume only after initial changes and source work finish');
    await f.client._poll();
    assert(f.events.filter(value => value.event === 'poll-completed').length === 1,
      'a subsequent poll must wake the queue for retry');
    f.client.destroy();
    assert(!f.client.ready, 'destroy must immediately prevent replay');
  } finally {
    f.client.destroy();
    gate.resolve({cursor: 'initial', hasMore: false, work: []});
    await pending;
  }
});

for (const phase of ['transfer-chain', 'publication-manifest']) {
  await test(`publication rechecks source eligibility after waiting for ${phase}`, async () => {
    const transport = new PublicationTransport('current');
    const f = fixture([transport]);
    const release = deferred();
    const entered = deferred();
    let eligible = true;
    let blocker;
    let pending;
    let manifestGate;
    try {
      f.settings.values.set('sync-text', true);
      await bounded(f.client.start());
      if (phase === 'transfer-chain') {
        blocker = observe(f.client._transfers.enqueue(() => {
          entered.resolve();
          return release.promise;
        }));
        await bounded(entered.promise);
      } else {
        manifestGate = transport.hold('createItem');
      }
      pending = observe(f.client.publish(publicationItem, {guard: () => eligible}));
      if (manifestGate)
        await bounded(manifestGate.entered.promise);
      eligible = false;
      release.resolve();
      manifestGate?.resolve(copy(transport.publication));
      assertCancelled(await bounded(pending));
      assert(!transport.calls.some(method => ['uploadPreview', 'uploadContent', 'completeUpload'].includes(method)),
        'Invalidated source content must never be sent or completed after a wait');
      if (phase === 'transfer-chain')
        assert(!transport.calls.includes('createItem'), 'An invalidated queued source must not publish a manifest');
    } finally {
      f.client.destroy();
      release.resolve();
      manifestGate?.resolve({});
      await Promise.all([...(pending ? [pending] : []), ...(blocker ? [blocker] : [])]);
    }
  });
}

await test('successive restarts discard delayed configuration loads', async () => {
  const f = fixture();
  const first = deferred();
  const second = deferred();
  f.store.loads.push(first, second);
  const old = observe(f.client.start());
  let middle;
  try {
    // Allow each initialize call to enter load before superseding it.
    await Promise.resolve();
    await Promise.resolve();
    middle = observe(f.client.restart());
    await Promise.resolve();
    await Promise.resolve();
    await bounded(f.client.restart());
    const expected = snapshot(f);
    second.resolve({...copy(f.store.value), serverAddress: 'http://stale-second.invalid'});
    first.resolve({...copy(f.store.value), serverAddress: 'http://stale-first.invalid'});
    await bounded(Promise.all([old, middle]));
    assert(f.created.length === 1, 'Only the newest load may create a transport');
    assert(snapshot(f) === expected, 'Delayed loads must not replace current public configuration or events');
    assert(!f.created[0].transport.aborted && !f.created[0].cancellable.is_cancelled(),
      'Stale load cleanup must not abort the newest connection');
  } finally {
    f.client.destroy();
    first.resolve(copy(f.store.value));
    second.resolve(copy(f.store.value));
    await Promise.all([old, ...(middle ? [middle] : [])]);
  }
});

for (const method of Object.keys(replies)) {
  for (const lateFailure of [false, true]) {
    await test(`restart ignores late ${method} ${lateFailure ? 'failure' : 'reply'}`, async () => {
      const stale = new Transport('stale');
      const current = new Transport('current');
      stale.activeTransfers = method === 'transfer';
      const gate = stale.hold(method);
      const f = fixture([stale, current]);
      const pending = observe(f.client.start());
      try {
        await bounded(gate.entered.promise);
        await bounded(f.client.restart());
        const expected = snapshot(f);
        const staleCalls = stale.calls.length;
        const currentCalls = current.calls.length;
        assert(stale.aborted && f.created[0].cancellable.is_cancelled(),
          'Restart must abort and cancel its own pending initialization');
        if (lateFailure)
          gate.reject(new Error(`Late ${method} failure`));
        else
          gate.resolve(copy(replies[method]));
        await bounded(pending);
        assert(snapshot(f) === expected, 'Late initialization must not mutate new state, events, transfers or cursors');
        assert(stale.calls.length === staleCalls && current.calls.length === currentCalls,
          'Superseded initialization must not continue on either transport');
        assert(!current.aborted && !f.created[1].cancellable.is_cancelled(),
          'Stale cleanup must not abort or cancel the new connection');
      } finally {
        f.client.destroy();
        gate.resolve(copy(replies[method]));
        await pending;
      }
    });
  }
}

await test('successive restarts isolate the cleanup of three transport generations', async () => {
  const transports = ['first', 'second', 'current'].map(name => new Transport(name));
  const first = transports[0].hold('status');
  const second = transports[1].hold('device');
  const f = fixture(transports);
  const old = observe(f.client.start());
  let middle;
  try {
    await bounded(first.entered.promise);
    middle = observe(f.client.restart());
    await bounded(second.entered.promise);
    await bounded(f.client.restart());
    const expected = snapshot(f);
    second.reject(new Error('Second generation failed after restart'));
    first.resolve(copy(replies.status));
    await bounded(Promise.all([old, middle]));
    assert(snapshot(f) === expected, 'Both superseded initializations must leave the newest state unchanged');
    assert(f.created.slice(0, 2).every(value => value.transport.aborted && value.cancellable.is_cancelled()),
      'Each superseded generation must release its own transport and cancellable');
    assert(!transports[2].aborted && !f.created[2].cancellable.is_cancelled(),
      'Neither stale initialization may release the third generation resources');
  } finally {
    f.client.destroy();
    first.resolve(copy(replies.status));
    second.resolve(copy(replies.device));
    await Promise.all([old, ...(middle ? [middle] : [])]);
  }
});

for (const method of ['load', ...Object.keys(replies)]) {
  await test(`destroy cancels pending ${method} initialization`, async () => {
    const transport = new Transport('destroyed');
    transport.activeTransfers = method === 'transfer';
    const gate = method === 'load' ? deferred() : transport.hold(method);
    const f = fixture([transport]);
    if (method === 'load')
      f.store.loads.push(gate);
    const pending = observe(f.client.start());
    try {
      if (method === 'load') {
        await Promise.resolve();
        await Promise.resolve();
      } else {
        await bounded(gate.entered.promise);
      }
      f.client.destroy();
      const expected = snapshot(f);
      gate.resolve(method === 'load' ? copy(f.store.value) : copy(replies[method]));
      await bounded(pending);
      assert(snapshot(f) === expected, 'Destroyed client must not gain late state or persistence');
      assert(f.settings.signals.size === 0, 'Destroy must disconnect all settings listeners');
      assert(method === 'load' ? f.created.length === 0
        : transport.aborted && f.created[0].cancellable.is_cancelled(),
      'Destroy must release pending resources, without creating a transport after load');
    } finally {
      f.client.destroy();
      gate.resolve(method === 'load' ? copy(f.store.value) : copy(replies[method]));
      await pending;
    }
  });
}

const sourceReplies = {
  acceptWork: {uploadId: itemId, transfer: sourceTransfer()},
  uploadContent: {},
  completeUpload: {transfer: sourceTransfer('completed')},
};

for (const change of ['deleted', 'replaced', 'sensitive', 'representation-replaced']) {
  await test(`source work rejects a source ${change} while acceptance is pending`, async () => {
    const transport = new Transport('current');
    const item = copy(localSource);
    let current = item;
    const f = fixture([transport], {sourceItem: id => id === itemId ? current : null});
    let pending;
    let gate;
    try {
      await bounded(f.client.start());
      gate = transport.hold('acceptWork');
      transport.work = () => Promise.resolve({cursor: 'source-rejected', hasMore: false, work: [sourceWork]});
      pending = observe(f.client._syncWork());
      await bounded(gate.entered.promise);
      if (change === 'deleted')
        current = null;
      else if (change === 'replaced')
        current = copy(item);
      else if (change === 'sensitive')
        item.sensitive = true;
      else
        item.representations = copy(item.representations);
      gate.resolve(copy(sourceReplies.acceptWork));
      const result = await bounded(pending);
      assert(!result.error && !transport.calls.includes('uploadContent') && !transport.calls.includes('completeUpload'),
        'An invalidated source must not start sending or complete an accepted upload');
      assert(transport.rejection?.workId === sourceWork.id && transport.rejection.code === 'source_content_missing'
          && transport.calls.includes('cancel'),
        'Rejecting an accepted work must release peer requesters and cancel its source upload');
      assert(f.client._progress.workCursor === 'source-rejected' && f.client._transfers.pendingIds().length === 0,
        'A confirmed rejection must advance the work page without leaving a pending remote transfer');
    } finally {
      f.client.destroy();
      gate?.resolve(copy(sourceReplies.acceptWork));
      if (pending)
        await pending;
    }
  });
}

for (const change of ['missing', 'sensitive']) {
  await test(`source work rejects an initially ${change} source without acceptance`, async () => {
    const transport = new Transport('current');
    const item = change === 'missing' ? null : {...copy(localSource), sensitive: true};
    const f = fixture([transport], {sourceItem: () => item});
    try {
      await bounded(f.client.start());
      transport.work = () => Promise.resolve({cursor: 'source-rejected', hasMore: false, work: [sourceWork]});
      await bounded(f.client._syncWork());
      assert(transport.rejection?.code === 'source_content_missing' && !transport.calls.includes('acceptWork')
          && !transport.calls.includes('uploadContent') && !transport.calls.includes('cancel')
          && f.client._progress.workCursor === 'source-rejected',
        'An unavailable source must be rejected before acceptance and allow the work cursor to advance');
    } finally {
      f.client.destroy();
    }
  });
}

for (const unavailable of ['missing-file', 'directory']) {
  await test(`source work retires an unreadable ${unavailable} and continues polling`, async () => {
    const directory = Gio.File.new_for_path(GLib.dir_make_tmp('clipboard-x-source-work-XXXXXX'));
    const file = unavailable === 'directory' ? directory : directory.get_child('missing-original');
    const broken = {representations: [{id: 'content', mimeType: 'text/plain', size: 4, path: file.get_path()}]};
    const nextItemId = '55555555-5555-4555-8555-555555555555';
    const nextWorkId = '66666666-6666-4666-8666-666666666666';
    const waitingId = '77777777-7777-4777-8777-777777777777';
    const transport = new Transport('current');
    const nextItem = copy(localSource);
    const f = fixture([transport], {sourceItem: id => id === itemId ? broken
      : id === nextItemId ? nextItem : null});
    f.settings.values.set('sync-transfer-timeout-seconds', 30);
    let fileError;
    try {
      await bounded(f.client.start());
      const waiting = {...sourceTransfer('waiting-for-peer'), id: waitingId, direction: 'download'};
      f.client._transfers.receive({...waiting, transferId: waitingId});
      const waiter = observe(f.client._transfers.wait(waitingId));
      transport.work = () => Promise.resolve({cursor: 'after-unreadable-source', hasMore: false,
        work: [sourceWork, {...sourceWork, id: nextWorkId, itemId: nextItemId}]});
      transport.acceptWork = id => transport.reply('acceptWork', {uploadId: id,
        transfer: id === sourceWork.id ? sourceTransfer()
          : {...sourceTransfer(), id: nextWorkId, itemId: nextItemId}});
      transport.uploadContent = async (uploadId, _contentId, source) => {
        transport.calls.push('uploadContent');
        if (uploadId === sourceWork.id) {
          try {
            const stream = Gio.File.new_for_path(source.path).read(null);
            stream.close(null);
          } catch (error) {
            fileError = error;
            throw error;
          }
        }
      };
      transport.completeUpload = () => transport.reply('completeUpload', {
        transfer: {...sourceTransfer('completed'), id: nextWorkId, itemId: nextItemId},
      });
      transport.transfer = () => transport.reply('transfer', {
        ...waiting, state: 'completed', completedBytes: waiting.totalBytes,
      });
      await bounded(f.client._poll());
      assert(fileError?.matches?.(Gio.IOErrorEnum, unavailable === 'missing-file'
        ? Gio.IOErrorEnum.NOT_FOUND : Gio.IOErrorEnum.IS_DIRECTORY),
        'The regression must exercise a real local file open failure, not an empty source path');
      assert(transport.rejection?.workId === sourceWork.id
          && transport.rejection.code === 'source_content_missing' && transport.calls.includes('cancel')
          && f.client._transfers.get(transferId)?.state === 'cancelled',
        'An unreadable accepted original must reject its source work and cancel the source upload');
      assert(f.client.getTransferForItem(nextItemId)?.state === 'completed'
          && f.client._progress.pendingWork === null
          && f.client._progress.workCursor === 'after-unreadable-source',
        'An unreadable original must not strand the journal, cursor, or later jobs on its work page');
      assert(!(await bounded(waiter)).error && transport.calls.includes('transfer'),
        'The same poll must still refresh and settle independent incoming transfers');
    } finally {
      f.client.destroy();
      directory.delete(null);
    }
  });
}

for (const failure of ['network', 'server-not-found', 'cancelled', 'bytes-source']) {
  await test(`source work preserves ${failure} upload errors`, async () => {
    const directory = Gio.File.new_for_path(GLib.dir_make_tmp('clipboard-x-source-work-XXXXXX'));
    const item = failure === 'bytes-source' ? copy(localSource)
      : {representations: [{id: 'content', mimeType: 'text/plain', size: 4,
        path: directory.get_child('missing-original').get_path()}]};
    const transport = new Transport('current');
    const f = fixture([transport], {sourceItem: () => item});
    try {
      await bounded(f.client.start());
      const cursor = f.client._progress.workCursor;
      const error = failure === 'cancelled' ? cancelled() : failure === 'bytes-source'
        ? new Gio.IOErrorEnum({code: Gio.IOErrorEnum.NOT_FOUND, message: 'Synthetic non-file upload error'})
        : Object.assign(new Error('Synthetic upload request failure'), failure === 'server-not-found'
          ? {status: 404, code: 'not_found'} : {code: 'network_error'});
      transport.work = () => Promise.resolve({cursor: 'unconfirmed-source', hasMore: false, work: [sourceWork]});
      transport.uploadContent = () => Promise.reject(error);
      const result = await bounded(observe(f.client._syncWork()));
      assert(result.error === error && f.client._progress.pendingWork?.id === sourceWork.id
          && f.client._progress.workCursor === cursor && !transport.calls.includes('rejectWork')
          && !transport.calls.includes('cancel'),
        'Only actual local file read failures may retire source work; transport and cancellation errors remain intact');
    } finally {
      f.client.destroy();
      directory.delete(null);
    }
  });
}

for (const method of ['acceptWork', 'completeUpload']) {
  await test(`source removal during ${method} does not revoke an acknowledged completion`, async () => {
    const transport = new Transport('current');
    let current = copy(localSource);
    const f = fixture([transport], {sourceItem: () => current});
    let gate;
    let pending;
    try {
      await bounded(f.client.start());
      gate = transport.hold(method);
      transport.work = () => Promise.resolve({cursor: 'source-complete', hasMore: false, work: [sourceWork]});
      pending = observe(f.client._syncWork());
      await bounded(gate.entered.promise);
      current = null;
      gate.resolve(method === 'acceptWork'
        ? {uploadId: itemId, transfer: sourceTransfer('completed')}
        : {transfer: sourceTransfer('completed')});
      const result = await bounded(pending);
      assert(!result.error && !transport.calls.includes('rejectWork') && !transport.calls.includes('cancel')
          && f.client.getTransferForItem(itemId).state === 'completed'
          && f.client._progress.workCursor === 'source-complete',
        'A server-confirmed completed upload must not be rejected or cancelled after local removal');
    } finally {
      f.client.destroy();
      gate?.resolve(method === 'acceptWork'
        ? {uploadId: itemId, transfer: sourceTransfer('completed')}
        : {transfer: sourceTransfer('completed')});
      if (pending)
        await pending;
    }
  });
}

await test('a failed source rejection leaves its work cursor unacknowledged', async () => {
  const transport = new Transport('current');
  const f = fixture([transport], {sourceItem: () => null});
  try {
    await bounded(f.client.start());
    const cursor = f.client._progress.workCursor;
    transport.work = () => Promise.resolve({cursor: 'source-rejected', hasMore: false, work: [sourceWork]});
    transport.rejectWork = () => Promise.reject(new Error('Source rejection lost its response'));
    const result = await bounded(observe(f.client._syncWork()));
    assert(result.error && f.client._progress.workCursor === cursor,
      'The work cursor must not advance before the server acknowledges source rejection');
    transport.rejectWork = () => Promise.resolve();
    await bounded(f.client._syncWork());
    assert(f.client._progress.workCursor === 'source-rejected', 'A failed rejection must remain retryable');
  } finally {
    f.client.destroy();
  }
});

for (const method of Object.keys(sourceReplies)) {
  for (const lateFailure of [false, true]) {
    await test(`source work ignores late ${method} ${lateFailure ? 'failure' : 'reply'}`, async () => {
      const stale = new Transport('stale');
      const current = new Transport('current');
      stale.workValues = [sourceWork];
      const gate = stale.hold(method);
      const f = fixture([stale, current], {sourceItem});
      const pending = observe(f.client.start());
      try {
        await bounded(gate.entered.promise);
        await bounded(f.client.restart());
        const expected = snapshot(f);
        const staleCalls = stale.calls.length;
        const currentCalls = current.calls.length;
        if (stale.upload) {
          assert(stale.upload.cancellable.is_cancelled(), 'Restart must cancel the source upload operation');
          stale.upload.onProgress(1);
          stale.upload.onProgress(4);
          assert(snapshot(f) === expected, 'Late upload progress must not update new transfers or events');
        }
        if (lateFailure)
          gate.reject(new Error(`Old source ${method} failed`));
        else
          gate.resolve(copy(sourceReplies[method]));
        await bounded(pending);
        stale.upload?.onProgress(4);
        assert(snapshot(f) === expected, 'Late source work must not change new state, events or saved cursors');
        assert(stale.calls.length === staleCalls && current.calls.length === currentCalls,
          'Superseded source work must not continue upload/completion on either transport');
        assert(!current.aborted && !f.created[1].cancellable.is_cancelled(),
          'Source work cleanup must not close the replacement connection');
      } finally {
        f.client.destroy();
        gate.resolve(copy(sourceReplies[method]));
        await pending;
      }
    });
  }
}

for (const lateFailure of [false, true]) {
  await test(`old source upload ${lateFailure ? 'failure' : 'reply'} cannot remove a new operation with the same ID`, async () => {
    const stale = new Transport('stale');
    const current = new Transport('current');
    stale.workValues = current.workValues = [sourceWork];
    const oldGate = stale.hold('uploadContent');
    const newGate = current.hold('uploadContent');
    const f = fixture([stale, current], {sourceItem});
    const old = observe(f.client.start());
    let replacement;
    try {
      await bounded(oldGate.entered.promise);
      replacement = observe(f.client.restart());
      await bounded(newGate.entered.promise);
      const expected = snapshot(f);
      if (lateFailure)
        oldGate.reject(new Error('Old source upload failed'));
      else
        oldGate.resolve({});
      await bounded(old);
      assert(snapshot(f) === expected, 'Old source cleanup must not overwrite the new active transfer');
      assert(stale.upload.cancellable.is_cancelled() && !current.upload.cancellable.is_cancelled(),
        'Old cleanup must cancel only the old upload operation');
      await bounded(f.client.cancelTransfer(transferId));
      assert(current.upload.cancellable.is_cancelled(),
        'The new operation must remain registered and publicly cancellable after old cleanup');
      assert(!current.calls.includes('completeUpload'), 'Old upload must not complete the new upload session');
    } finally {
      f.client.destroy();
      oldGate.resolve({});
      newGate.resolve({});
      await Promise.all([old, ...(replacement ? [replacement] : [])]);
    }
  });
}

await test('source work requires a completed acknowledgement before advancing its cursor', async () => {
  const transport = new Transport('current');
  const f = fixture([transport], {sourceItem});
  try {
    await bounded(f.client.start());
    const cursor = f.client._progress.workCursor;
    transport.work = () => Promise.resolve({cursor: 'unconfirmed-work', hasMore: false, work: [sourceWork]});
    transport.completeUpload = () => Promise.resolve({transfer: sourceTransfer('cancelled')});
    const result = await bounded(observe(f.client._poll()));
    assert(result.error?.code === 'source_upload_failed',
      'A non-completed acknowledgement must fail source work instead of treating it as delivered');
    assert(f.client._progress.workCursor === cursor,
      'Unconfirmed source work must remain replayable at its existing cursor');
    assert(f.client.getTransferForItem(itemId).state === 'failed',
      'The shared lifecycle must expose failure for unconfirmed source content');
  } finally {
    f.client.destroy();
  }
});

for (const phase of ['acceptWork', 'uploadContent', 'completeUpload']) {
  for (const restart of [false, true]) {
    await test(`accepted source work resumes after ${phase} failure${restart ? ' across restart' : ''}`, async () => {
      const transport = new Transport('source');
      const f = fixture([transport], {sourceItem});
      let replacement;
      try {
        await bounded(f.client.start());
        let state = 'queued';
        let failed = false;
        let completed = 0;
        let uploaded = 0;
        const networkFailure = () => {
          failed = true;
          throw Object.assign(new Error('Synthetic temporary network failure'), {code: 'network_error'});
        };
        transport.work = () => Promise.resolve({cursor: 'source-page', hasMore: false,
          work: state === 'queued' ? [sourceWork] : []});
        transport.acceptWork = async () => {
          assert(f.progressStore.saves.at(-1).progress.pendingWork?.id === sourceWork.id,
            'The source work reference must be durable before any accept request');
          state = state === 'queued' ? 'accepted' : state;
          if (phase === 'acceptWork' && !failed)
            networkFailure();
          return {uploadId: itemId, transfer: sourceTransfer(state === 'completed' ? 'completed' : 'queued')};
        };
        transport.uploadContent = async () => {
          if (phase === 'uploadContent' && !failed)
            networkFailure();
          uploaded++;
        };
        transport.completeUpload = async () => {
          state = 'completed';
          completed++;
          if (phase === 'completeUpload' && !failed)
            networkFailure();
          return {transfer: sourceTransfer('completed')};
        };
        const cursor = f.client._progress.workCursor;
        const result = await bounded(observe(f.client._syncWork()));
        assert(result.error?.code === 'network_error' && f.client._progress.pendingWork?.id === sourceWork.id
            && f.client._progress.workCursor === cursor,
          'A lost response must retain source work without advancing its page cursor');
        let active = f.client;
        if (restart) {
          f.client.destroy();
          replacement = new SyncClient(f.settings, {
            configurationStore: f.store, progressStore: f.progressStore,
            transportFactory: () => transport, sourceItem, logger,
          });
          active = replacement;
          await bounded(active.start());
        } else {
          await bounded(active._poll());
        }
        assert(state === 'completed' && uploaded === 1 && completed === 1
            && active._progress.pendingWork === null && active._progress.workCursor === 'source-page',
          'A queued-only feed must not lose accepted work, duplicate acknowledged uploads, or strand its cursor');
        const shown = active.getTransferForItem(itemId);
        assert(shown?.state === 'completed' && !shown.errorCode && active._transfers.pendingIds().length === 0,
          'A recovered server completion must replace the local failure in item queries, even with an earlier timestamp');
      } finally {
        f.client.destroy();
        replacement?.destroy();
      }
    });
  }
}

for (const [status, code] of [[404, 'not_found'], [409, 'invalid_request']]) {
  await test(`unavailable pending work (${status}) does not block later source jobs`, async () => {
    const transport = new Transport('source');
    const f = fixture([transport], {sourceItem});
    try {
      await bounded(f.client.start());
      await f.client._saveProgress({...f.client._progress, pendingWork: sourceWork});
      transport.acceptWork = async () => {
        throw Object.assign(new Error('Queued work is no longer available'), {status, code});
      };
      transport.work = () => transport.reply('work', {cursor: 'after-expired-work', hasMore: false, work: []});
      const before = transport.calls.filter(method => method === 'work').length;
      await bounded(f.client._syncWork());
      assert(f.client._progress.pendingWork === null && f.client._progress.workCursor === 'after-expired-work'
          && transport.calls.filter(method => method === 'work').length === before + 1,
        'Only a confirmed unavailable acceptance may retire stale work and resume the queued-only feed');
    } finally {
      f.client.destroy();
    }
  });
}

await test('completed source work resumes after its local original was removed', async () => {
  const transport = new Transport('source');
  const f = fixture([transport]);
  try {
    await bounded(f.client.start());
    await f.client._saveProgress({...f.client._progress, pendingWork: sourceWork});
    transport.acceptWork = () => Promise.resolve({uploadId: itemId, transfer: sourceTransfer('completed')});
    await bounded(f.client._syncWork());
    assert(f.client._progress.pendingWork === null && !transport.calls.includes('rejectWork')
        && !transport.calls.includes('uploadContent'),
      'Replaying a server-completed job must neither revoke it nor require its removed local bytes');
  } finally {
    f.client.destroy();
  }
});

await test('pending source work is never accepted after a failed journal write', async () => {
  const transport = new Transport('source');
  const f = fixture([transport], {sourceItem});
  try {
    await bounded(f.client.start());
    transport.work = () => Promise.resolve({cursor: 'source-page', hasMore: false, work: [sourceWork]});
    f.progressStore.save = async () => { throw new Error('Synthetic journal write failure'); };
    const result = await bounded(observe(f.client._syncWork()));
    assert(result.error && !transport.calls.includes('acceptWork'),
      'The server must not accept a task whose recovery reference could not be saved');
  } finally {
    f.client.destroy();
  }
});

for (const method of ['item', 'requestContent', 'downloadContent']) {
  for (const action of ['restart', 'destroy']) {
    for (const lateFailure of [false, true]) {
      await test(`remote ${method} ignores late ${lateFailure ? 'failure' : 'reply'} after ${action}`, async () => {
        const stale = new DownloadTransport('stale');
        const current = new DownloadTransport('current');
        const f = fixture([stale, current]);
        const item = remoteItem();
        let gate;
        let pending;
        try {
          await bounded(f.client.start());
          gate = stale.hold(method);
          pending = observe(method === 'item' ? f.client.getItem(itemId) : f.client.materialize(item));
          await bounded(gate.entered.promise);
          await bounded(f.client[action]());
          const expected = snapshot(f);
          const expectedItem = copy(item);
          const oldCalls = stale.calls.length;
          const currentCalls = current.calls.length;
          if (stale.download) {
            assert(stale.download.cancellable.is_cancelled(), 'Reset must cancel the old download');
            stale.download.onProgress(4);
            stale.download.onVerifying();
          }
          if (lateFailure)
            gate.reject(new Error('Late remote content failure'));
          else
            gate.resolve(method === 'requestContent' ? stale.contentResponse()
              : method === 'downloadContent' ? {path: '/unused-late-test-double'} : {});
          assertCancelled(await bounded(pending));
          assert(snapshot(f) === expected && JSON.stringify(item) === JSON.stringify(expectedItem),
            'Old remote content must not restore transfers, set paths, or change availability');
          assert(stale.calls.length === oldCalls && current.calls.length === currentCalls,
            'Old remote requests must not continue on either transport generation');
        } finally {
          f.client.destroy();
          gate?.resolve({});
          if (pending)
            await pending;
        }
      });
    }
  }
}

await test('a remote download queued behind old work cannot run on a replacement connection', async () => {
  const stale = new DownloadTransport('stale');
  const current = new DownloadTransport('current');
  const f = fixture([stale, current]);
  const entered = deferred();
  const release = deferred();
  const item = remoteItem();
  let blocker;
  let pending;
  try {
    await bounded(f.client.start());
    blocker = observe(f.client._transfers.enqueue(() => {
      entered.resolve();
      return release.promise;
    }));
    await bounded(entered.promise);
    pending = observe(f.client.materialize(item));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(stale.calls.includes('requestContent') && !stale.calls.includes('downloadContent'),
      'The fixture must wait after requesting content but before starting its queued download');
    await bounded(f.client.restart());
    const expected = snapshot(f);
    release.resolve();
    assertCancelled(await bounded(pending));
    assert(snapshot(f) === expected && item.representations[0].path === null,
      'A stale queued download must not mutate the replacement state or original content');
    assert(!stale.calls.includes('downloadContent') && !current.calls.includes('downloadContent'),
      'Neither transport may perform the stale queued download');
  } finally {
    f.client.destroy();
    release.resolve();
    await Promise.all([...(blocker ? [blocker] : []), ...(pending ? [pending] : [])]);
  }
});

for (const outcome of ['completed', 'cancelled']) {
  await test(`an evicted remote transfer can still be ${outcome} while its consumer waits`, async () => {
    const transport = new DownloadTransport('current');
    const f = fixture([transport]);
    const waiting = deferred();
    let pending;
    try {
      await bounded(f.client.start());
      f.settings.values.set('sync-transfer-timeout-seconds', 3);
      transport.requestContent = () => Promise.resolve({transfer: {
        ...sourceTransfer('waiting-for-peer'), direction: 'download',
      }});
      transport.transfer = () => transport.reply('transfer', {
        ...sourceTransfer('completed'), direction: 'download',
      });
      f.client.connect('transfer-changed', (_client, transfer) => {
        if (transfer.transferId === transferId && transfer.state === 'waiting-for-peer')
          waiting.resolve();
      });
      const item = remoteItem();
      pending = observe(f.client.materialize(item));
      await bounded(waiting.promise);
      for (let index = 0; index < MAX_TRANSFER_STATES; index++) {
        f.client._transfers.receive({transferId: GLib.uuid_string_random(), itemId: GLib.uuid_string_random(),
          state: 'completed', completedBytes: 1, totalBytes: 1, updatedAt: Date.now()});
      }
      assert(!f.client._transfers.get(transferId) && f.client._transfers.pendingIds().includes(transferId),
        'The UI cache must remain bounded without dropping an unfinished protocol transfer');
      if (outcome === 'completed')
        await bounded(f.client._refreshActiveTransfers());
      else
        await bounded(f.client.cancelTransfer(transferId));
      const result = await bounded(pending);
      if (outcome === 'completed') {
        assert(!result.error && item.representations[0].path && transport.calls.includes('transfer')
            && transport.calls.includes('downloadContent') && !transport.calls.includes('cancel'),
          'An evicted waiting transfer must still refresh and deliver its original when the server completes it');
      } else {
        assert(result.error && transport.calls.includes('cancel') && !transport.calls.includes('downloadContent'),
          'Cancelling an evicted waiting transfer must immediately release its consumer without downloading');
      }
      assert(!f.client._transfers.pendingIds().includes(transferId)
          && f.client._transfers._waiters.size === 0
          && f.client._transfers.values().length <= MAX_TRANSFER_STATES,
        'Completed or cancelled waiters must release protocol state and retain the UI cache limit');
    } finally {
      f.client.destroy();
      if (pending)
        await pending;
    }
  });
}

await test('explicit download cancellation prevents a late result from becoming usable', async () => {
  const transport = new DownloadTransport('current');
  const f = fixture([transport]);
  const item = remoteItem();
  let gate;
  let pending;
  try {
    await bounded(f.client.start());
    gate = transport.hold('downloadContent');
    pending = observe(f.client.materialize(item));
    await bounded(gate.entered.promise);
    const active = f.client.getTransferForItem(item.id);
    await f.client.cancelTransfer(active.transferId);
    gate.resolve({path: '/unused-cancelled-test-double'});
    assertCancelled(await bounded(pending));
    assert(transport.download.cancellable.is_cancelled() && item.representations[0].path === null,
      'A transport ignoring cancellation must not make the returned file usable');
    assert(f.client.getTransferForItem(item.id).state === 'cancelled' && !transport.calls.includes('cancel'),
      'Local-only cancellation must remain cancelled and must not delete a server task');
  } finally {
    f.client.destroy();
    gate?.resolve({});
    if (pending)
      await pending;
  }
});

await test('completed transfer scopes ignore any additional progress callbacks', async () => {
  const transport = new DownloadTransport('current');
  const f = fixture([transport]);
  const item = remoteItem();
  try {
    await bounded(f.client.start());
    await bounded(f.client.materialize(item));
    const expected = snapshot(f);
    transport.download.onProgress(1);
    transport.download.onVerifying();
    assert(snapshot(f) === expected,
      'Progress after a completed scope must not resurrect or regress its terminal state');
  } finally {
    f.client.destroy();
  }
});

await test('scheduled poll failure cannot mark the replacement connection as failed', async () => {
  const stale = new Transport('stale');
  const current = new Transport('current');
  const f = fixture([stale, current]);
  let gate;
  try {
    f.settings.values.set('sync-poll-interval-seconds', 1);
    await bounded(f.client.start());
    gate = stale.hold('changes');
    await bounded(gate.entered.promise);
    f.settings.values.set('sync-poll-interval-seconds', 3600);
    await bounded(f.client.restart());
    const expected = snapshot(f);
    gate.reject(new Error('Old scheduled poll failed'));
    // Let the timer callback's rejection handler run, without starting another poll.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert(snapshot(f) === expected, 'Old poll errors must not change replacement state or emit status errors');
    assert(!current.aborted, 'Old poll errors must not abort the current transport');
  } finally {
    f.client.destroy();
    gate?.resolve(copy(replies.changes));
  }
});

for (const method of ['createItem', 'uploadPreview', 'uploadContent', 'completeUpload']) {
  for (const action of ['restart', 'destroy']) {
    for (const lateFailure of [false, true]) {
      await test(`public publish ignores late ${method} ${lateFailure ? 'cancellation' : 'reply'} after ${action}`, async () => {
        const stale = new PublicationTransport('stale');
        const current = new PublicationTransport('current');
        const gate = stale.hold(method);
        const f = fixture([stale, current]);
        let pending;
        try {
          f.settings.values.set('sync-text', true);
          await bounded(f.client.start());
          pending = observe(f.client.publish(publicationItem));
          await bounded(gate.entered.promise);
          await bounded(f.client[action]());
          const expected = snapshot(f);
          const staleCalls = stale.calls.length;
          const currentCalls = current.calls.length;
          if (stale.upload) {
            assert(stale.upload.cancellable.is_cancelled(), 'Reset must cancel the old publication upload');
            stale.upload.onProgress(4);
            assert(snapshot(f) === expected, 'Old publication progress must not change current state');
          }
          if (lateFailure)
            gate.reject(cancelled());
          else
            gate.resolve(method === 'createItem' ? copy(stale.publication)
              : method === 'completeUpload' ? stale.completedPublication() : {});
          assertCancelled(await bounded(pending));
          stale.upload?.onProgress(4);
          assert(snapshot(f) === expected, 'Old publication reply, error or cleanup must not restore old transfers or events');
          assert(stale.calls.length === staleCalls && current.calls.length === currentCalls,
            'Old publication must not continue on its old or replacement transport');
          if (action === 'restart')
            assert(!current.aborted && !f.created[1].cancellable.is_cancelled(),
              'Old publication cleanup must not close the replacement transport');
        } finally {
          f.client.destroy();
          gate.resolve({});
          if (pending)
            await pending;
        }
      });
    }
  }
}

for (const lateFailure of [false, true]) {
  await test(`old public publish ${lateFailure ? 'cancellation' : 'reply'} preserves a replacement operation with the same ID`, async () => {
    const stale = new PublicationTransport('stale');
    const current = new PublicationTransport('current');
    const oldGate = stale.hold('uploadContent');
    const newGate = current.hold('uploadContent');
    const f = fixture([stale, current]);
    let old;
    let replacement;
    try {
      f.settings.values.set('sync-text', true);
      await bounded(f.client.start());
      old = observe(f.client.publish(publicationItem));
      await bounded(oldGate.entered.promise);
      await bounded(f.client.restart());
      replacement = observe(f.client.publish(publicationItem));
      await bounded(newGate.entered.promise);
      const expected = snapshot(f);
      if (lateFailure)
        oldGate.reject(cancelled());
      else
        oldGate.resolve({});
      assertCancelled(await bounded(old));
      assert(snapshot(f) === expected, 'Old publication cleanup must not overwrite the replacement transfer');
      assert(!current.upload.cancellable.is_cancelled(), 'Old cleanup must not cancel the replacement upload');
      await bounded(f.client.cancelTransfer(transferId));
      assert(current.upload.cancellable.is_cancelled(),
        'Replacement operation must remain publicly cancellable after old publication cleanup');
      assert(!current.calls.includes('completeUpload'), 'Old publication must not complete the replacement upload');
    } finally {
      f.client.destroy();
      oldGate.resolve({});
      newGate.reject(cancelled());
      await Promise.all([...(old ? [old] : []), ...(replacement ? [replacement] : [])]);
    }
  });
}

await test('queued public publications cannot execute on a replacement connection', async () => {
  const stale = new PublicationTransport('stale');
  const current = new PublicationTransport('current');
  const gate = stale.hold('uploadContent');
  const f = fixture([stale, current]);
  let active;
  let queued;
  try {
    f.settings.values.set('sync-text', true);
    await bounded(f.client.start());
    active = observe(f.client.publish(publicationItem));
    await bounded(gate.entered.promise);
    queued = observe(f.client.publish(publicationItem));
    // Let the logger enqueue the second publication behind the held upload.
    await Promise.resolve();
    await bounded(f.client.restart());
    const expected = snapshot(f);
    gate.reject(cancelled());
    assertCancelled(await bounded(active));
    assertCancelled(await bounded(queued));
    assert(snapshot(f) === expected, 'Old queued publications must not change replacement state');
    assert(stale.calls.filter(value => value === 'createItem').length === 1
      && !current.calls.includes('createItem'), 'Only the original active publication may reach a transport');
  } finally {
    f.client.destroy();
    gate.resolve({});
    await Promise.all([...(active ? [active] : []), ...(queued ? [queued] : [])]);
  }
});

await test('public publication superseded before its logger callback is cancelled', async () => {
  const current = new PublicationTransport('current');
  const f = fixture([current]);
  try {
    f.settings.values.set('sync-text', true);
    await bounded(f.client.start());
    const pending = observe(f.client.publish(publicationItem));
    f.settings.values.set('sync-enabled', false);
    await bounded(f.client.restart());
    const expected = snapshot(f);
    assertCancelled(await bounded(pending));
    assert(snapshot(f) === expected && !current.calls.includes('createItem'),
      'A deferred publish callback must not enter the queue after its generation is replaced');
  } finally {
    f.client.destroy();
  }
});

await test('changes wait for durable acceptance and retry rejected entries', async () => {
  const transport = new Transport('current');
  const acceptance = deferred();
  let attempts = 0;
  let accepted = 0;
  const f = fixture([transport], {applyChanges: async () => {
    attempts++;
    if (attempts === 1)
      await acceptance.promise;
    accepted++;
  }});
  try {
    await bounded(f.client.start());
    const before = copy(f.client._progress);
    transport.changes = async () => ({cursor: 'accepted-changes', hasMore: false,
      changes: [{itemId, sequence: 1, kind: 'upsert'}]});
    const pending = observe(f.client._poll());
    await Promise.resolve();
    await Promise.resolve();
    assert(f.client._progress.cursors[channelId] === before.cursors[channelId],
      'Pending acceptance must not advance the changes cursor');
    acceptance.reject(new Error('Temporary history write failure'));
    assert((await bounded(pending)).error, 'An acceptance failure must fail the poll');
    assert(f.client._progress.cursors[channelId] === before.cursors[channelId],
      'A rejected entry must leave the previous cursor retryable');
    await bounded(f.client._poll());
    assert(attempts === 2 && f.client._progress.cursors[channelId] === 'accepted-changes',
      'The next poll must accept the failed entry before saving its cursor');
    assert(accepted === 1, 'Only the retried page may complete durable acceptance');
  } finally {
    acceptance.resolve();
    f.client.destroy();
  }
});

await test('progress write failures do not advance in-memory cursors', async () => {
  const transport = new Transport('current');
  let attempts = 0;
  const f = fixture([transport], {applyChanges: async () => { attempts++; }});
  try {
    await bounded(f.client.start());
    const cursor = f.client._progress.cursors[channelId];
    transport.changes = async () => ({cursor: 'next-changes', hasMore: false,
      changes: [{itemId, sequence: 1, kind: 'upsert'}]});
    const save = f.progressStore.save.bind(f.progressStore);
    f.progressStore.save = async () => { throw new Error('Temporary progress write failure'); };
    assert((await observe(f.client._poll())).error, 'The poll must report persistence failure');
    assert(f.client._progress.cursors[channelId] === cursor,
      'Unpersisted progress must never become the next request cursor');
    f.progressStore.save = save;
    await bounded(f.client._poll());
    assert(attempts === 2 && f.client._progress.cursors[channelId] === 'next-changes',
      'Progress persistence failure must safely replay the page');
  } finally {
    f.client.destroy();
  }
});

await test('initial receive failure leaves polling available for retry', async () => {
  const transport = new Transport('current');
  let attempts = 0;
  transport.changes = async () => ({cursor: 'accepted-changes', hasMore: false,
    changes: [{itemId, sequence: 1, kind: 'upsert'}]});
  const f = fixture([transport], {applyChanges: async () => {
    if (++attempts === 1)
      throw new Error('Temporary receive failure');
  }});
  try {
    await bounded(f.client.start());
    assert(f.client.ready && f.client._connected && f.client._pollSource > 0,
      'A failed initial page must not strand an authenticated client without polling');
    await bounded(f.client._poll());
    assert(attempts === 2 && f.events.filter(value => value.event === 'status-changed').at(-1)?.args[0] === 'online',
      'A later successful poll must recover and accept the page');
  } finally {
    f.client.destroy();
  }
});

await test('superseded change acceptance cannot commit progress or notify', async () => {
  const stale = new Transport('stale');
  const current = new Transport('current');
  const acceptance = deferred();
  const entered = deferred();
  const f = fixture([stale, current], {applyChanges: async (_changes, scope) => {
    entered.resolve();
    await acceptance.promise;
    assert(!scope.isCurrent(), 'The receiver must be able to detect supersession');
  }});
  let pending;
  try {
    await bounded(f.client.start());
    stale.changes = async () => ({cursor: 'stale-accepted', hasMore: false,
      changes: [{itemId, sequence: 1, kind: 'upsert'}]});
    pending = observe(f.client._poll());
    await bounded(entered.promise);
    await bounded(f.client.restart());
    const expected = snapshot(f);
    acceptance.resolve();
    await bounded(pending);
    assert(snapshot(f) === expected, 'Late acceptance must leave the replacement session untouched');
  } finally {
    acceptance.resolve();
    f.client.destroy();
    if (pending)
      await pending;
  }
});

assert(failures.length === 0, failures.join('\n'));
