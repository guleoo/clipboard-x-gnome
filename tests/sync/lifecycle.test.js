import {SyncClient} from '../../src/sync/client.js';

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
      activeChannelId: channelId, cursors: {}, workCursor: '',
    };
    this.loads = [];
    this.saves = [];
  }

  load() { return this.loads.length ? this.loads.shift().promise : Promise.resolve(copy(this.value)); }
  saveConnection(value) { return this.save('connection', value); }
  saveProgress(value) { return this.save('progress', value); }
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
  return {
    id: transferId, itemId, deviceId, kind: 'publish', direction: 'upload', state,
    completedBytes: 0, totalBytes: 0, peerDeviceIds: [], createdAt: 1, updatedAt: 2,
  };
}

function sourceTransfer(state = 'queued') {
  return {...transfer(state), kind: 'content', totalBytes: 4,
    completedBytes: state === 'completed' ? 4 : 0};
}

const sourceWork = {id: transferId, type: 'materialize-content', itemId, contentId: 'content'};
const sourceItem = id => id === itemId ? {
  representations: [{id: 'content', mimeType: 'text/plain', size: 4,
    bytes: new Uint8Array([1, 2, 3, 4])}],
} : null;

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
  uploadContent(_upload, _content, _source, onProgress, cancellable) {
    this.upload = {onProgress, cancellable};
    return this.reply('uploadContent', {});
  }
  completeUpload() {
    return this.reply('completeUpload', {transfer: sourceTransfer('completed')});
  }
  abort() { this.aborted = true; }
}

const logger = {
  run(_operation, callback) { return Promise.resolve().then(() => callback({step: (_phase, action) => action()})); },
  info() {},
  error() {},
};

function fixture(transports = [new Transport('current')], options = {}) {
  const settings = new Settings();
  const store = new Store();
  const created = [];
  const events = [];
  const client = new SyncClient(settings, {
    configurationStore: store,
    transportFactory(configuration, options) {
      const transport = transports[created.length];
      assert(transport, 'Stale initialization must not create an additional transport');
      created.push({transport, configuration: copy(configuration), cancellable: options.cancellable});
      return transport;
    },
    logger,
    ...options,
  });
  for (const event of ['status-changed', 'status-details-changed', 'configuration-changed',
    'devices-changed', 'channels-changed', 'transfer-changed', 'item-available', 'item-removed']) {
    client.connect(event, (_client, ...args) => events.push({event, args: copy(args)}));
  }
  return {client, settings, store, created, events};
}

function snapshot(f) {
  return JSON.stringify({
    connected: f.client.connected, capabilities: f.client.capabilities,
    configuration: f.client.configuration, status: f.client.status,
    devices: f.client.devices, channels: f.client.channels,
    transfer: f.client.getTransferForItem(itemId), events: f.events,
    saves: f.store.saves,
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

for (const [method, call] of [
  ['channels', client => client.listChannels()],
  ['transfers', client => client.listTransfers()],
  ['transfer', client => client.getTransfer(transferId)],
]) {
  await test(`public ${method} refresh cannot commit a superseded reply`, async () => {
    const stale = new Transport('stale');
    const current = new Transport('current');
    const f = fixture([stale, current]);
    let gate;
    let pending;
    try {
      await bounded(f.client.start());
      gate = stale.hold(method);
      pending = observe(call(f.client));
      await bounded(gate.entered.promise);
      await bounded(f.client.restart());
      const expected = snapshot(f);
      gate.resolve(method === 'transfer' ? transfer('queued') : copy(replies[method]));
      await bounded(pending);
      assert(snapshot(f) === expected, 'Late public refresh must not change current state or emit events');
      if (method === 'transfer') {
        await bounded(f.client.cancelTransfer(transferId));
        assert(!current.calls.includes('cancel'),
          'A stale transfer reply must not register a remote cancellation target on the new connection');
      }
      assert(!current.aborted, 'Late public refresh must not close the replacement connection');
    } finally {
      f.client.destroy();
      gate?.resolve(copy(replies[method]));
      if (pending)
        await pending;
    }
  });
}

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

assert(failures.length === 0, failures.join('\n'));
