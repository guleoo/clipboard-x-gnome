import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {bytesFromString, sha256, stringFromBytes} from '../../src/common/bytes.js';
import {readJson, writeJson} from '../../src/common/data-store.js';
import {writeFile} from '../../src/common/files.js';
import {SyncError} from '../../src/sync/errors.js';
import {normalizeServerAddress} from '../../src/sync/http/client.js';
import {UploadQueue} from '../../src/sync/upload-queue.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

const directory = GLib.dir_make_tmp('clipboard-x-upload-queue-test-XXXXXX');
const payloadPath = GLib.build_filenamev([directory, 'private-payload']);
let caseNumber = 0;
const queues = [];

function fixture() {
  const values = new Map([
    ['sync-enabled', true], ['device-id', GLib.uuid_string_random()],
    ['sync-send-mode', 'automatic'], ['sync-favorites-only', false],
    ['sync-poll-interval-seconds', 1], ['sync-configuration-revision', 0],
  ]);
  const f = {
    directory: GLib.build_filenamev([directory, `case-${++caseNumber}`]),
    settings: {
      get_boolean: key => values.get(key),
      get_string: key => values.get(key),
      get_uint: key => values.get(key),
    },
    values,
    config: {serverAddress: 'localhost:8765/', activeChannelId: GLib.uuid_string_random(), apiKey: 'private-key'},
    online: true,
    historyReady: true,
    now: 1_000_000,
    items: new Map(),
    publications: [],
    preparationCount: 0,
    errors: [],
    warnings: [],
    configuration: async () => ({...f.config}),
    prepare: async () => { f.preparationCount++; },
    publish: async item => { f.publications.push(item.id); },
    create(options = {}) {
      const queue = new UploadQueue(f.settings, {
        directory: f.directory,
        configuration: () => f.configuration(),
        current: () => ({...f.config}),
        ready: () => f.online,
        source: id => f.items.get(id) ?? null,
        sourceReady: () => f.historyReady,
        prepare: () => f.prepare(),
        publish: (item, options) => f.publish(item, options),
        clock: () => f.now,
        logger: {warn: (_operation, error) => f.warnings.push(error), info() {}},
        onError: error => f.errors.push(error),
        ...options,
      });
      queues.push(queue);
      return queue;
    },
    item(options = {}) {
      const item = {
        id: GLib.uuid_string_random(), sensitive: false, favorite: false,
        representations: [{path: payloadPath, bytes: bytesFromString('private-clipboard-text')}],
        text: 'private-clipboard-text',
        ...options,
      };
      f.items.set(item.id, item);
      return item;
    },
    async document(serverAddress = f.config.serverAddress) {
      return readJson(f.path(serverAddress), 8 * 1024 * 1024);
    },
    path(serverAddress = f.config.serverAddress) {
      const hash = sha256(bytesFromString(normalizeServerAddress(serverAddress)));
      return GLib.build_filenamev([f.directory, `${hash}.json`]);
    },
    switchConfig(changes) {
      f.config = {...f.config, ...changes};
      values.set('sync-configuration-revision', values.get('sync-configuration-revision') + 1);
    },
  };
  return f;
}

function removeTree(path) {
  const file = Gio.File.new_for_path(path);
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
    const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let info;
    while ((info = children.next_file(null)))
      removeTree(GLib.build_filenamev([path, info.get_name()]));
    children.close(null);
  }
  file.delete(null);
}

try {
  await writeFile(Gio.File.new_for_path(payloadPath), bytesFromString('private-clipboard-text'));

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    await queue.enqueue(item, {automatic: true});
    await queue.enqueue(item);
    await queue.enqueue(item, {automatic: true});
    const document = await f.document();
    assert(document.entries.length === 1 && document.entries[0].automatic === false,
      'Automatic and manual intentions must deduplicate without demoting a manual upload');
    assert(document.entries[0].serverAddress === 'http://localhost:8765',
      'Queue destinations must use the same normalization as the HTTP client');
    const [, bytes] = Gio.File.new_for_path(f.path()).load_contents(null);
    const text = stringFromBytes(new GLib.Bytes(bytes));
    assert(!text.includes('private-key') && !text.includes('private-clipboard-text')
        && !text.includes(payloadPath) && !text.includes('representations'),
      'Only queue metadata may reach persistent storage');
    await queue.destroy();
    const restored = f.create();
    await restored.flush();
    assert(f.publications.length === 1 && (await f.document()).entries.length === 0,
      'Reload must replay the persisted item reference and remove a completed publication');
    f.item();
    await restored.flush();
    assert(f.publications.length === 1,
      'Re-enabling or flushing must never backfill unqueued historical items');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    let attempts = 0;
    f.values.set('sync-poll-interval-seconds', 8);
    f.publish = async () => {
      attempts++;
      if (attempts <= 2)
        throw new SyncError('server_unavailable', 'Offline fixture');
    };
    await queue.enqueue(item);
    await queue.flush();
    assert((await f.document()).entries[0].retryAt === f.now + 8000,
      'Initial network retry must respect the configured polling interval');
    await queue.flush();
    f.now += 7999;
    await queue.flush();
    assert(attempts === 1, 'A retry must not run before its persisted due time');
    await queue.destroy();
    const restored = f.create();
    f.now++;
    await restored.flush();
    assert(attempts === 2 && (await f.document()).entries[0].retryAt === f.now + 10_000,
      'Reloaded retries must retain their attempts and exponential backoff');
    assert(f.errors.length === 1 && f.warnings.length === 1,
      'Repeated transient failures must not repeatedly notify or log');
    f.now += 10_000;
    await restored.flush();
    assert(attempts === 3 && (await f.document()).entries.length === 0,
      'A due retry that completes must be durably removed');
  }

  {
    const f = fixture();
    const queue = f.create();
    const automatic = f.item();
    const manual = f.item();
    await queue.enqueue(automatic, {automatic: true});
    await queue.enqueue(manual);
    f.online = false;
    await queue.flush();
    assert(f.preparationCount === 0 && (await f.document()).entries.length === 2,
      'Offline queues must remain pending without preparing or publishing');
    f.online = true;
    f.values.set('sync-enabled', false);
    assert(await queue.enqueue(f.item()) === false,
      'Synchronization disabled must immediately ignore even manual enqueue requests');
    await queue.flush();
    assert(f.publications.length === 0 && (await f.document()).entries.length === 2,
      'Disabling synchronization must pause previously accepted work');
    f.values.set('sync-enabled', true);
    f.values.set('sync-send-mode', 'manual');
    await queue.flush();
    assert(f.publications.length === 1 && f.publications[0] === manual.id,
      'Manual send mode must pause automatic intentions without pausing manual intentions');
    f.values.set('sync-send-mode', 'automatic');
    f.values.set('sync-favorites-only', true);
    await queue.flush();
    assert((await f.document()).entries.length === 1,
      'An automatic non-favorite intention must remain pending under favorites-only policy');
    automatic.favorite = true;
    await queue.flush();
    assert(f.publications.length === 2, 'Making the queued source a favorite must resume it');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    const original = {...f.config};
    const originalDevice = f.values.get('device-id');
    await queue.enqueue(item);
    f.switchConfig({activeChannelId: GLib.uuid_string_random()});
    await queue.flush();
    assert(f.publications.length === 0, 'A task must never move to a different active channel');
    await queue.enqueue(item);
    await queue.flush();
    assert(f.publications.length === 1 && (await f.document()).entries.length === 1,
      'The same source may have a distinct intention in another channel');
    f.switchConfig(original);
    f.values.set('device-id', GLib.uuid_string_random());
    await queue.flush();
    assert(f.publications.length === 1, 'A task must never be replayed using another device identity');
    f.values.set('device-id', originalDevice);
    f.switchConfig({serverAddress: 'localhost:9876'});
    await queue.flush();
    assert(f.publications.length === 1 && (await f.document(original.serverAddress)).entries.length === 1,
      'Server switches must leave the old server queue isolated');
    await queue.enqueue(item);
    assert((await f.document()).entries.length === 1,
      'Each server must have its own durable queue file');
    await queue.remove(item.id, {currentOnly: true});
    assert((await f.document()).entries.length === 0
        && (await f.document(original.serverAddress)).entries.length === 1,
      'Explicit cancellation must remove only the destination captured at call time');
    f.switchConfig(original);
    await queue.flush();
    assert(f.publications.length === 2, 'Returning to the original scope must resume its pending task');
  }

  {
    const f = fixture();
    const queue = f.create();
    const missing = f.item();
    const sensitive = f.item();
    await queue.enqueue(missing);
    await queue.enqueue(sensitive);
    f.items.delete(missing.id);
    sensitive.sensitive = true;
    f.historyReady = false;
    await queue.prune();
    await queue.flush();
    assert((await f.document()).entries.length === 2,
      'A history that is still loading must not invalidate persisted references');
    f.historyReady = true;
    await queue.prune();
    assert((await f.document()).entries.length === 0 && f.publications.length === 0,
      'Deleted and sensitive sources must be pruned after history is ready');
    const firstServer = f.config.serverAddress;
    const crossServer = f.item();
    await queue.enqueue(crossServer);
    f.switchConfig({serverAddress: 'localhost:9999'});
    await queue.enqueue(crossServer);
    f.items.delete(crossServer.id);
    await queue.prune();
    assert((await f.document()).entries.length === 0
        && (await f.document(firstServer)).entries.length === 0,
      'Pruning must cover all previously loaded server queues');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    const began = deferred();
    const resume = deferred();
    f.configuration = async () => {
      began.resolve();
      await resume.promise;
      return {...f.config};
    };
    f.online = false;
    const accepted = queue.enqueue(item);
    await began.promise;
    let stopped = false;
    const shutdown = queue.destroy().then(() => { stopped = true; });
    await Promise.resolve();
    assert(!stopped, 'Destroy must wait for an enqueue accepted before its configuration read');
    resume.resolve();
    assert(await accepted, 'Destroy must not discard an already accepted durable intention');
    await shutdown;
    await queue.flush();
    assert(f.publications.length === 0 && (await f.document()).entries.length === 1,
      'A destroyed queue must persist accepted writes but stop all future replay');
    f.configuration = async () => ({...f.config});
    f.online = true;
    await f.create().flush();
    assert(f.publications.length === 1, 'An accepted shutdown-time write must survive the next instance');
  }

  {
    const f = fixture();
    const queue = f.create();
    const began = deferred();
    const resume = deferred();
    f.configuration = async () => {
      began.resolve();
      await resume.promise;
      return {...f.config};
    };
    f.online = false;
    const accepted = queue.enqueue(f.item());
    await began.promise;
    f.switchConfig({serverAddress: 'localhost:4321'});
    resume.resolve();
    assert(await accepted === false && await f.document() === null,
      'A configuration switch during enqueue must not bind an old request to a new destination');
  }

  {
    const f = fixture();
    const barrier = deferred();
    const queue = f.create({afterShutdown: barrier.promise});
    const item = f.item();
    const accepted = queue.enqueue(item);
    await Promise.resolve();
    assert(await f.document() === null,
      'A new instance must not touch server queue files before the previous shutdown barrier');
    barrier.resolve();
    await accepted;
    const server = f.config.serverAddress;
    f.switchConfig({serverAddress: 'localhost:4422'});
    await queue.enqueue(item);
    f.switchConfig({serverAddress: server});
    const cancellation = queue.remove(item.id, {currentOnly: true});
    f.switchConfig({serverAddress: 'localhost:4422'});
    await cancellation;
    assert((await f.document(server)).entries.length === 0 && (await f.document()).entries.length === 1,
      'Cancellation must retain the scope captured synchronously even if configuration changes before mutation');
  }

  {
    const f = fixture();
    const barrier = deferred();
    const queue = f.create({afterShutdown: barrier.promise});
    const original = {...f.config};
    const item = f.item();
    const accepted = queue.enqueue(item);
    f.switchConfig({serverAddress: 'localhost:4455'});
    barrier.resolve();
    assert(await accepted && (await f.document(original.serverAddress)).entries.length === 1
        && await f.document() === null,
      'A write accepted on an established destination must retain that server when queued behind a switch');
    await queue.flush();
    assert(f.publications.length === 0, 'Old-server work must not execute against the new destination');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    await queue.enqueue(item);
    const began = deferred();
    const resume = deferred();
    f.configuration = async () => {
      began.resolve();
      await resume.promise;
      return {...f.config};
    };
    f.online = false;
    const enqueueing = queue.enqueue(item);
    await began.promise;
    const pruning = queue.prune();
    const shutdown = queue.destroy();
    f.items.clear();
    resume.resolve();
    await enqueueing;
    await pruning;
    await shutdown;
    assert((await f.document()).entries.length === 1,
      'A held prune must not mistake controller teardown for real history deletion');
  }

  {
    const f = fixture();
    f.values.set('sync-enabled', false);
    f.configuration = async () => { throw new Error('Disabled local use must not read sync configuration'); };
    const queue = f.create();
    assert(await queue.enqueue(f.item()) === false, 'Disabled capture must not create an upload intent');
    await queue.prune();
    await queue.flush();
    assert(await f.document() === null,
      'Local-only capture must not read connection files or create dormant server queues');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    await queue.enqueue(item);
    const began = deferred();
    const resume = deferred();
    f.publish = async () => { began.resolve(); await resume.promise; };
    const flush = queue.flush();
    assert(queue.flush() === flush, 'Concurrent flush calls must share a single worker');
    await began.promise;
    await queue.destroy();
    assert((await f.document()).entries.length === 1,
      'Destroy must complete without waiting for a held network publication');
    const restored = f.create({afterShutdown: queue.destroy()});
    await restored.enqueue(item);
    resume.resolve();
    await flush;
    assert((await f.document()).entries.length === 1,
      'A late success from a destroyed worker must not remove work accepted by its replacement');
    f.publish = async value => { f.publications.push(value.id); };
    await restored.flush();
    assert(f.publications.length === 1, 'The replacement worker must still replay the retained task');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    await queue.enqueue(item);
    const began = deferred();
    const resume = deferred();
    f.publish = async () => { began.resolve(); await resume.promise; };
    const flush = queue.flush();
    await began.promise;
    await queue.remove(item.id);
    await queue.enqueue(item);
    resume.resolve();
    await flush;
    assert((await f.document()).entries.length === 1,
      'A held publication must not delete a newer requeued intention with the same item ID');
    f.publish = async () => { throw new SyncError('item_conflict', 'Conflict fixture'); };
    await queue.flush();
    assert((await f.document()).entries[0].blocked && f.errors.length === 1,
      'A permanent conflict must block and report the intention once');
    f.now += 1_000_000;
    await queue.flush();
    assert(f.errors.length === 1, 'Blocked intentions must not hot retry or repeatedly notify');
    f.publish = async value => { f.publications.push(value.id); };
    await queue.enqueue(item);
    await queue.flush();
    assert(f.publications.length === 1 && (await f.document()).entries.length === 0,
      'An explicit enqueue must unblock a permanent failure');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    await queue.enqueue(item);
    const began = deferred();
    const resume = deferred();
    f.publish = async () => {
      began.resolve();
      await resume.promise;
      throw new SyncError('item_conflict', 'Stale conflict fixture');
    };
    const flush = queue.flush();
    await began.promise;
    await queue.remove(item.id);
    await queue.enqueue(item);
    resume.resolve();
    await flush;
    const entry = (await f.document()).entries[0];
    assert(entry.attempts === 0 && !entry.blocked && f.errors.length === 0,
      'A late failure must not block, reschedule or report against a newer intention');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    const original = {...f.config};
    await queue.enqueue(item);
    const began = deferred();
    const resume = deferred();
    f.publish = async () => { began.resolve(); await resume.promise; };
    const flush = queue.flush();
    await began.promise;
    f.switchConfig({activeChannelId: GLib.uuid_string_random()});
    resume.resolve();
    await flush;
    assert((await f.document()).entries.length === 1,
      'A success returned after a destination switch must not dequeue the original scope');
    f.switchConfig(original);
    f.prepare = async () => { f.items.delete(item.id); };
    f.publish = async value => { f.publications.push(value.id); };
    await queue.flush();
    assert((await f.document()).entries.length === 0 && f.publications.length === 0,
      'A source deleted during persistence must be checked again before publication');
  }

  {
    const f = fixture();
    const queue = f.create();
    const item = f.item({representations: [{bytes: bytesFromString('new item'), path: null}]});
    await queue.enqueue(item);
    f.prepare = async () => {
      f.preparationCount++;
      item.representations[0].path = payloadPath;
    };
    await queue.flush();
    assert(f.publications.length === 1 && f.preparationCount === 1,
      'New in-memory snapshots must be persisted before their local file checks');
    item.representations[0].path = GLib.build_filenamev([directory, 'missing-content']);
    await queue.enqueue(item);
    f.prepare = async () => {};
    await queue.flush();
    assert((await f.document()).entries[0].blocked && f.errors[0].code === 'source_content_missing',
      'Missing persisted files must block the intent without deleting it or publishing content');
    item.representations[0].path = payloadPath;
    await queue.enqueue(item);
    f.publish = async () => {
      throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Restart fixture'});
    };
    await queue.flush();
    const retained = (await f.document()).entries[0];
    assert(retained.attempts === 0 && !retained.blocked && retained.retryAt === 0,
      'Lifecycle cancellation must retain the unmodified durable intention');
  }

  for (const change of ['delete', 'private-replacement']) {
    const f = fixture();
    const queue = f.create();
    const item = f.item();
    await queue.enqueue(item);
    const began = deferred();
    const resume = deferred();
    f.publish = async (value, {guard}) => {
      began.resolve();
      await resume.promise;
      if (!guard())
        throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Source changed'});
      f.publications.push(value.id);
    };
    const flushing = queue.flush();
    await began.promise;
    if (change === 'delete')
      f.items.delete(item.id);
    else
      f.items.set(item.id, {...item, sensitive: true});
    resume.resolve();
    await flushing;
    await queue.prune();
    assert(f.publications.length === 0 && (await f.document()).entries.length === 0,
      'Sources deleted or replaced with sensitive content while awaiting transmission must not upload');
  }

  {
    const f = fixture();
    const queue = f.create();
    for (let index = 0; index < 21; index++)
      await queue.enqueue(f.item());
    await queue.flush();
    assert(f.publications.length === 20 && (await f.document()).entries.length === 1,
      'A replay batch must be bounded so receiving polls can run between batches');
    await queue.flush();
    assert(f.publications.length === 21, 'The next flush must resume work outside the first batch');
  }

  for (const error of [Object.assign(new Error('HTTP fixture'), {status: 408}),
    Object.assign(new Error('HTTP fixture'), {status: 429}),
    Object.assign(new Error('HTTP fixture'), {status: 503}),
    new SyncError('transfer_expired', 'Expired fixture')]) {
    const f = fixture();
    const queue = f.create();
    await queue.enqueue(f.item());
    f.publish = async () => { throw error; };
    await queue.flush();
    const entry = (await f.document()).entries[0];
    assert(!entry.blocked && entry.retryAt === f.now + 5000,
      'Timeouts, overload, server failures and expired transfers must remain retryable');
  }

  {
    const f = fixture();
    const item = f.item();
    await writeJson(f.path(), {version: 1, entries: Array(10_001).fill({itemId: item.id})});
    let rejected = false;
    try {
      await f.create().enqueue(item);
    } catch (_error) {
      rejected = true;
    }
    assert(rejected && (await f.document()).entries.length === 10_001,
      'Oversized queues must be rejected without overwriting existing durable state');
  }

  console.log('Upload queue behavior tests passed');
} finally {
  await Promise.all(queues.map(queue => queue.destroy()));
  removeTree(directory);
}
