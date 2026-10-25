import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {Server} from '../helpers/server.js';
import {Peer} from '../helpers/peer.js';
import {Gate} from '../helpers/gate.js';
import {restart} from '../helpers/restart.js';
import {withCleanup} from '../helpers/resources.js';
import {capture} from '../clipboard/native.js';

const contentPath = '/items/[^/]+/contents/[^/?]+$';
const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);

async function fixture(desktop, run, {enable = true, gate = false} = {}) {
  let server;
  let target;
  let source;
  const gates = [];
  return withCleanup(async () => {
    server = await Server.open(desktop);
    target = await Target.open(desktop);
    const openGate = async () => {
      const value = await Gate.open(server.address);
      gates.push(value);
      return value;
    };
    const proxy = gate ? await openGate() : null;
    if (proxy) await server.configure(server.channel.id, server.identity.key, proxy.address);
    if (enable) await server.enable();
    await run({server, target, gate: proxy, openGate, peer: async () => {
      assert(!source, 'A case needs only one independently persisted source client');
      source = await Peer.open(desktop, server);
      return source;
    }});
  }, () => [source, target, server, ...gates]);
}

function image(seed) {
  const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 48, 24);
  pixbuf.fill(((0x334400 + seed * 101) << 8) | 0xff);
  return pixbuf.save_to_bufferv('png', [], [])[1];
}
function digest(bytes) { return GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes); }
function document(path) {
  const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
  return JSON.parse(new TextDecoder().decode(bytes));
}
function queryCursor(path) {
  const match = /[?&]cursor=([^&]*)/.exec(path);
  return match ? decodeURIComponent(match[1]) : '';
}
function pending(desktop, itemId) {
  return [...desktop.app._uploadQueue._queues.values()].flatMap(queue => [...queue.entries.values()])
    .filter(entry => entry.itemId === itemId);
}
async function polls(desktop, count = 2) {
  const sync = desktop.app._sync;
  let completed = 0;
  const signal = sync.connect('poll-completed', () => completed++);
  try { await until(() => completed >= count, 'real automatic polling cycles', 20000); }
  finally { sync.disconnect(signal); }
}
async function received(desktop, id) {
  await until(() => desktop.app._controller.items.some(item => item.id === id && item.remote), 'actual incoming snapshot', 30000);
  return desktop.app._controller.items.find(item => item.id === id);
}
async function action(desktop, item, name = 'sync') {
  await desktop.open();
  await desktop.search(item.text || '');
  const row = desktop.history._itemRows.get(item.id);
  assert(row, 'Incoming/local item must have a native content row');
  await desktop.click(name === 'content' ? row.focusActors[0]
    : row.focusActors.find(actor => actor._clipboardXGnomeEntryAction === name));
}
async function published(desktop, item) {
  await action(desktop, item);
  await until(() => desktop.app._sync.getTransferForItem(item.id)?.state === 'completed', 'actual upload confirmed', 30000);
}
async function original(item) {
  await until(() => Boolean(item.primary.path), 'original adopted into managed storage', 30000);
  const [, bytes] = Gio.File.new_for_path(item.primary.path).load_contents(null);
  assert(bytes.length === item.primary.size && digest(bytes) === item.primary.sha256,
    'Adopted original must match declared byte count and SHA-256');
}
async function failedConfiguration(desktop) {
  await until(() => desktop.app._sync._state === 'error' && !desktop.app._sync.ready,
    'actual connection authentication failure', 20000);
}

export const cases = {
  'SEND-03-image': desktop => fixture(desktop, async ({server, target}) => {
    for (const [seed, delta] of [[1, -1], [2, 0], [3, 1]]) {
      const bytes = image(seed);
      desktop.settings.set_uint('image-full-threshold', bytes.length + delta);
      await target.offerBytes({'image/png': bytes});
      await until(() => desktop.app._controller.items.some(item => item.primary.sha256 === digest(bytes)), 'real PNG captured');
      const item = desktop.app._controller.items.find(value => value.primary.sha256 === digest(bytes));
      await published(desktop, item);
      const remote = await server.item(item.id);
      assert(remote.contents[0].size === bytes.length && remote.contents[0].delivery === (delta >= 0 ? 'eager' : 'on-demand'),
        'Image threshold uses actual encoded bytes, including equality');
      assert(remote.contents[0].availability === (delta >= 0 ? 'available' : 'source-required'),
        'Snapshot completion must distinguish a cached original from source-required image data');
    }
  }),

  'RECV-03-boundaries': desktop => fixture(desktop, async ({peer}) => {
    const source = await peer();
    let sequence = 0;
    for (const mime of ['text/plain;charset=utf-8', 'image/png']) {
      for (const senderEager of [false, true]) {
        for (const delta of [-1, 0, 1]) {
          const bytes = mime === 'image/png' ? image(++sequence + 10)
            : new TextEncoder().encode(`UTF-8 中文 equality ${++sequence}`);
          desktop.settings.set_uint(mime === 'image/png' ? 'image-full-threshold' : 'text-full-threshold', bytes.length + delta);
          const remote = await source.call('publish', {types: {[mime]: GLib.base64_encode(bytes)},
            threshold: senderEager ? bytes.length : 1});
          const item = await received(desktop, remote.id);
          if (delta >= 0) await original(item);
          else {
            await polls(desktop);
            assert(!item.primary.path && !item.primary.bytes,
              'Receiver must keep above-threshold content lazy even if sender already uploaded the original');
          }
          assert(item.primary.size === bytes.length && item.primary.sha256 === digest(bytes),
            'Receive policy must not replace original metadata with preview byte counts');
        }
      }
    }
  }),

  'RECV-02-pages': desktop => fixture(desktop, async ({server, gate, peer}) => {
    desktop.settings.set_int('history-size', 500);
    desktop.settings.set_uint('text-full-threshold', 1);
    const source = await peer();
    const ids = [];
    // Exceed the production page size (200), not a patched small test page.
    for (let index = 0; index < 205; index++) {
      const remote = await source.call('publish', {text: `retained before receiver joined ${index}`, threshold: 1});
      ids.push(remote.id);
    }
    assert(!desktop.app._controller.items.some(item => ids.includes(item.id)), 'Cold receiver has not connected while source publishes');
    const start = gate.state.requests.length;
    await server.enable();
    await until(() => ids.every(id => desktop.app._controller.items.some(item => item.id === id)), 'all retained pages imported by joining receiver', 60000);
    assert(ids.every(id => desktop.app._controller.items.filter(item => item.id === id).length === 1),
      'Repeated upsert events within the real feed must not create duplicate history rows');
    const changes = gate.state.requests.slice(start).filter(value => /\/changes\?/.test(value.path));
    const cursors = changes.map(value => queryCursor(value.path));
    assert(changes.length >= 2 && cursors[0] === '' && cursors.some(value => value !== ''),
      'Real production pagination must request a later page with an advanced cursor');
    const cursor = desktop.app._sync._progress.cursors[server.channel.id];
    assert(typeof cursor === 'string' && cursor.length > 0, 'Accepted pages must advance in-memory progress');
    const {SyncProgressStore} = await import(`${desktop.app.dir.get_uri()}/sync/progress-store.js`);
    const persisted = await new SyncProgressStore().load({serverAddress: gate.address, deviceId: server.identity.id});
    assert(persisted.cursors[server.channel.id] === cursor, 'A fresh progress store must read the acknowledged cursor from disk');
    const beforeRestart = gate.state.requests.length;
    await restart(desktop);
    await until(() => desktop.app._sync.ready, 'receiver restarted against retained feed', 30000);
    const resumed = gate.state.requests.slice(beforeRestart).find(value => /\/changes\?/.test(value.path));
    assert(resumed && queryCursor(resumed.path) === cursor,
      'Actual extension restart must resume the durable cursor rather than replay the entire feed');
    assert(ids.every(id => desktop.app._controller.items.filter(item => item.id === id).length === 1),
      'Cursor restoration must retain each imported item exactly once');
  }, {enable: false, gate: true}),

  'SEND-05-destinations': desktop => fixture(desktop, async ({server, target, openGate}) => {
    const first = await openGate();
    const second = await openGate();
    const other = await server.createChannel();
    await server.join(other.id, server.identity.id);
    await server.configure(server.channel.id, 'invalid-key-for-pending-intent', first.address);
    desktop.settings.set_string('sync-send-mode', 'automatic');
    await desktop.open();
    await desktop.click(desktop.history.syncButton);
    await failedConfiguration(desktop);
    const queued = await capture(desktop, target, 'pending destination A must not be sent to B');
    await until(() => pending(desktop, queued.id).length === 1, 'offline automatic intent saved');
    const firstQueue = [...desktop.app._uploadQueue._queues.values()].find(queue =>
      [...queue.entries.values()].some(entry => entry.itemId === queued.id));
    assert(document(firstQueue.path).entries.some(entry => entry.itemId === queued.id && entry.channelId === server.channel.id
      && entry.deviceId === server.identity.id && entry.serverAddress === first.address), 'Durable intent captures server, Channel and DeviceId');
    await server.configure(other.id, server.identity.key, second.address);
    desktop.settings.set_string('sync-send-mode', 'automatic');
    await until(() => desktop.app._sync.ready && desktop.app._sync.configuration.activeChannelId === other.id, 'alternate destination ready', 30000);
    const otherItem = await capture(desktop, target, 'new destination B publication');
    await until(() => desktop.app._sync.getTransferForItem(otherItem.id)?.state === 'completed', 'B publication really completed', 30000);
    await polls(desktop);
    const alternate = await server.request('GET', `/items?channelId=${other.id}&limit=200`);
    assert(alternate.items.some(item => item.id === otherItem.id) && !alternate.items.some(item => item.id === queued.id),
      'A pending reference must never leak into a different address/Channel');
    assert(document(firstQueue.path).entries.some(entry => entry.itemId === queued.id), 'Dormant server queue remains on disk while B is active');
    const secondQueue = [...desktop.app._uploadQueue._queues.values()].find(queue => queue.path !== firstQueue.path);
    assert(secondQueue && Gio.File.new_for_path(secondQueue.path).query_exists(null),
      'Different server addresses must own distinct actual queue files');
    await restart(desktop);
    await until(() => desktop.app._sync.ready && desktop.app._sync.configuration.activeChannelId === other.id,
      'B restores after a real extension restart with the dormant A queue on disk', 30000);
    await server.configure(server.channel.id, server.identity.key, first.address);
    desktop.settings.set_string('sync-send-mode', 'automatic');
    await until(() => desktop.app._sync.ready && desktop.app._sync.configuration.activeChannelId === server.channel.id, 'original destination resumed', 30000);
    await until(() => desktop.app._sync.getTransferForItem(queued.id)?.state === 'completed' && pending(desktop, queued.id).length === 0,
      'original pending intent resumes and confirms only at its destination', 30000);
    assert((await server.items()).items.some(item => item.id === queued.id)
      && !(await server.items()).items.some(item => item.id === otherItem.id), 'Returning to A restores its queue without mixing B history');
    await until(() => !document(firstQueue.path).entries.some(entry => entry.itemId === queued.id),
      'Acknowledged restored intent is removed from the durable A queue');
  }, {enable: false}),

  'CONN-08-empty': desktop => fixture(desktop, async ({server, target}) => {
    await server.request('DELETE', `/channels/${server.channel.id}/members/${server.identity.id}`);
    await server.configure('', server.identity.key);
    await server.enable();
    assert(desktop.app._sync.configuration.activeChannelId === '' && desktop.app._sync._channels.length === 0,
      'An authenticated device without membership must not invent a Channel');
    const item = await capture(desktop, target, 'no channel must not publish');
    await action(desktop, item);
    await polls(desktop);
    assert(!(await server.items()).items.some(value => value.id === item.id), 'No-Channel attempt cannot publish into an arbitrary destination');
    assert(!pending(desktop, item.id).length, 'An invalid destination must not become a malformed durable intent');
    await server.join(server.channel.id, server.identity.id);
    await server.configure();
    await until(() => desktop.app._sync.ready && desktop.app._sync.configuration.activeChannelId === server.channel.id,
      'restored membership re-establishes an actual usable Channel', 20000);
    await published(desktop, item);
  }, {enable: false}),

  'CONN-08-revoked': desktop => fixture(desktop, async ({server, peer}) => {
    const source = await peer();
    const observations = [];
    const sync = desktop.app._sync;
    const signal = sync.connect('status-changed', (_sync, state, details) => observations.push({state, details}));
    try {
      await server.request('DELETE', `/channels/${server.channel.id}/members/${server.identity.id}`);
      const remote = await source.call('publish', {text: 'not visible after Channel revocation', threshold: 1});
      await until(() => observations.some(value => value.state === 'error' && value.details?.errorCode === 'channel_forbidden'),
        'real server Channel revocation is reported by the live session', 20000);
      assert(!desktop.app._controller.items.some(item => item.id === remote.id), 'Revoked member cannot import subsequent changes');
      await server.join(server.channel.id, server.identity.id);
      await until(() => desktop.app._controller.items.some(item => item.id === remote.id), 'poll recovers after membership is restored', 20000);
    } finally { sync.disconnect(signal); }
  }),

  'CONN-09-device': desktop => fixture(desktop, async ({server}) => {
    const errors = [];
    const sync = desktop.app._sync;
    const signal = sync.connect('status-changed', (_sync, state, details) => {
      if (state === 'error') errors.push(details?.errorCode);
    });
    try {
      await server.request('PATCH', `/devices/${server.identity.id}`, {disabled: true});
      await until(() => errors.some(code => ['device_disabled', 'invalid_key', 'not_authorized'].includes(code)),
        'actual revoked device/key is rejected by ongoing polling', 20000);
      await server.request('PATCH', `/devices/${server.identity.id}`, {disabled: false});
      const {key} = await server.request('POST', `/devices/${server.identity.id}/keys`, {});
      server.identity.key = key;
      await server.configure();
      await until(() => desktop.app._sync.ready && desktop.app._sync._state !== 'error', 'new real device key restores connection', 20000);
    } finally { sync.disconnect(signal); }
  }),

  'CONN-09-offline': desktop => fixture(desktop, async ({server}) => {
    // A bound but non-listening socket owns this port while deterministically
    // rejecting connections; do not guess an unused port or touch host services.
    const socket = Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.STREAM, Gio.SocketProtocol.TCP);
    try {
      socket.bind(Gio.InetSocketAddress.new_from_string('127.0.0.1', 0), true);
      await server.configure(server.channel.id, server.identity.key, `http://127.0.0.1:${socket.get_local_address().get_port()}`);
      await desktop.open();
      await desktop.click(desktop.history.syncButton);
      await failedConfiguration(desktop);
      assert(desktop.settings.get_boolean('sync-enabled'), 'Connection refusal must report failure, not silently alter the user enable preference');
      await server.configure();
      await until(() => desktop.app._sync.ready && desktop.app._sync._state !== 'error', 'actual server restores usability after connection refusal', 20000);
    } finally { socket.close(); }
  }, {enable: false}),

  'XFER-05-disable-download': desktop => fixture(desktop, async ({server, gate, peer, target}) => {
    desktop.settings.set_uint('text-full-threshold', 1);
    const source = await peer();
    const remote = await source.call('publish', {text: 'in-flight download from the previous session', threshold: 4096});
    const item = await received(desktop, remote.id);
    const content = desktop.app._content;
    const activate = content.activate;
    let settled = 0;
    content.activate = async function (value, ...options) {
      try { return await activate.call(this, value, ...options); }
      finally { if (value.id === item.id) settled++; }
    };
    try {
      gate.set({path: contentPath, hold: true});
      await action(desktop, item, 'content');
      await until(() => gate.state.requests.some(value => value.stage === 'held'), 'actual original response held');
      await server.disable();
      await capture(desktop, target, 'new local owner after sync disabled');
      gate.set({});
      await until(() => !gate.state.requests.some(value => value.stage === 'held' || value.stage === 'response' || value.stage === 'started'),
        'old network response reaches a terminal state', 15000);
      await until(() => settled === 1, 'disabled session activation promise has settled');
      assert(!item.primary.path && !item.primary.bytes && (await target.clipboard()).text === 'new local owner after sync disabled',
        'Late content from a disabled session cannot adopt an original or replace the clipboard');
      await server.enable();
      const restored = desktop.app._controller.items.find(value => value.id === item.id);
      await action(desktop, restored, 'content');
      await original(restored);
      await until(() => settled === 2, 'new session activation has completed copying the original');
      assert((await target.clipboard()).text === 'in-flight download from the previous session', 'New session can intentionally retry the canceled original');
    } finally { content.activate = activate; }
  }, {gate: true}),

  'XFER-06-cancel-download': desktop => fixture(desktop, async ({gate, peer, target}) => {
    desktop.settings.set_uint('text-full-threshold', 1);
    const source = await peer();
    const remote = await source.call('publish', {text: 'single task cancellation leaves unrelated sync usable', threshold: 4096});
    const item = await received(desktop, remote.id);
    await target.offer('cancel must not copy a preview');
    gate.set({path: contentPath, hold: true});
    await action(desktop, item);
    await until(() => gate.state.requests.some(value => value.stage === 'held'), 'materialization held for native cancellation');
    const transfer = desktop.app._sync.getTransferForItem(item.id);
    assert(transfer && !terminal.has(transfer.state), 'Cancel action starts with an actual active transfer');
    await action(desktop, item);
    await until(() => desktop.app._sync.getTransferForItem(item.id)?.state === 'cancelled', 'native row action cancels its own task');
    assert(desktop.app._sync.ready && !item.primary.path && (await target.clipboard()).text === 'cancel must not copy a preview',
      'Single-task cancellation preserves the session, lazy state and real clipboard');
    gate.set({});
    await until(() => !gate.state.requests.some(value => value.stage === 'held' || value.stage === 'response' || value.stage === 'started')
      && desktop.app._sync._transfers._materializations.size === 0, 'cancelled consumer and old HTTP response have both settled', 15000);
    await action(desktop, item);
    await original(item);
    await until(() => desktop.app._sync.getTransferForItem(item.id)?.state === 'completed', 'retry completion reflected in transfer state');
    const retry = desktop.app._sync.getTransferForItem(item.id);
    assert(retry?.state === 'completed' && retry.transferId !== transfer.transferId,
      'Retry must create a fresh completed operation instead of resurrecting the canceled task');
  }, {gate: true}),

  'XFER-09-glib': desktop => verifyDownload(desktop, false),
  'XFER-09-sha256sum': desktop => verifyDownload(desktop, true),
};

async function verifyDownload(desktop, external) {
  return fixture(desktop, async ({peer}) => {
    desktop.settings.set_boolean('sync-use-sha256sum', external);
    desktop.settings.set_uint('text-full-threshold', 1024 * 1024);
    const source = await peer();
    const text = `real verifier ${external} `.repeat(10000);
    const remote = await source.call('publish', {text, threshold: 1024 * 1024});
    const item = await received(desktop, remote.id);
    await original(item);
    assert(item.primary.sha256 === remote.primary.sha256 && item.primary.size === new TextEncoder().encode(text).length,
      `${external ? 'External sha256sum' : 'Default GLib'} verification must accept exact bytes from the real server framing`);
  });
}
