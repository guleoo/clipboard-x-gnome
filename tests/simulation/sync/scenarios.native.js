import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, until} from '../helpers/desktop.js';
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

function digest(bytes) { return GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes); }
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

export const cases = {
  'SEND-03-image': desktop => fixture(desktop, async ({server, target}) => {
    // One real image owner/thumbnail/row wiring check. Byte-boundary matrices
    // run against the same production modules in the headless HTTP suite.
    const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 48, 24);
    image.fill(0x336699ff);
    const bytes = image.save_to_bufferv('png', [], [])[1];
    desktop.settings.set_uint('image-full-threshold', 1);
    await target.offerBytes({'image/png': bytes});
    await until(() => desktop.app._controller.items.some(item => item.primary.sha256 === digest(bytes) && item.preview?.path),
      'actual image and thumbnail captured');
    const item = desktop.app._controller.items.find(value => value.primary.sha256 === digest(bytes));
    await published(desktop, item);
    const remote = await server.item(item.id);
    assert(remote.contents[0].delivery === 'on-demand' && remote.contents[0].availability === 'source-required'
      && remote.previews.length > 0, 'Native PNG row publishes a real lightweight image snapshot');
  }),

  'RECV-02-restore': desktop => fixture(desktop, async ({server, peer, target}) => {
    desktop.settings.set_uint('text-full-threshold', 1);
    const source = await peer();
    const remote = await source.call('publish', {text: 'retained before receiver joins', threshold: 1});
    await server.enable();
    await received(desktop, remote.id);
    await server.disable();
    await restart(desktop);
    await server.enable();
    await desktop.open();
    await until(() => desktop.history._itemRows.has(remote.id), 'restored incoming item rendered after actual extension restart');
    // Cursor, destination and queue-file matrices run through the same real
    // clients/stores in the headless HTTP suite. Keep only Shell lifecycle wiring.
    desktop.settings.set_string('sync-send-mode', 'automatic');
    const local = await capture(desktop, target, 'automatic publication remains connected after extension restart');
    await until(() => desktop.app._sync.getTransferForItem(local.id)?.state === 'completed', 'restored outgoing trigger reaches backend', 30000);
    assert((await server.item(local.id)).id === local.id, 'Actual restart must restore outgoing as well as incoming wiring');
    const publications = () => [...desktop.app._uploadQueue._queues.values()]
      .flatMap(queue => [...queue.publications.values()]);
    assert(publications().some(value => value.itemId === local.id), 'Confirmed local item retains its frozen publication');
    await desktop.open();
    await desktop.click(desktop.history._itemRows.get(local.id).focusActors
      .find(actor => actor._clipboardXGnomeEntryAction === 'delete'));
    await until(() => !desktop.app._controller.items.some(value => value.id === local.id)
      && !publications().some(value => value.itemId === local.id),
    'Native deletion must propagate through Controller changed to durable queue pruning');
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

};
