import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {Server} from '../helpers/server.js';
import {Gate} from '../helpers/gate.js';
import {Peer} from '../helpers/peer.js';
import {restart} from '../helpers/restart.js';
import {capture} from '../clipboard/native.js';
import {withCleanup} from '../helpers/resources.js';

const contentPath = '/items/[^/]+/contents/[^/?]+$';
async function fixture(desktop, run) {
  let server;
  let gate;
  let target;
  let peer;
  return withCleanup(async () => {
    server = await Server.open(desktop);
    gate = await Gate.open(server.address);
    await server.configure(server.channel.id, server.identity.key, gate.address);
    target = await Target.open(desktop);
    await server.enable();
    peer = await Peer.open(desktop, server);
    desktop.settings.set_uint('text-full-threshold', 1);
    await run({server, gate, target, peer});
  }, () => [peer, target, server, gate]);
}
async function received(desktop, id) {
  await until(() => desktop.app._controller.items.some(value => value.id === id && value.remote), 'actual peer snapshot imported', 15000);
  return desktop.app._controller.items.find(value => value.id === id);
}
async function click(desktop, item) {
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
}
async function held(gate) {
  await until(() => gate.state.requests.some(value => value.stage === 'held'), 'actual network download held', 10000);
}
async function complete(desktop, item) {
  await until(() => item.representations.every(value => value.path || value.bytes), 'full actual remote representations received', 20000);
  await until(() => !desktop.app._controller._savePending, 'download adoption persisted');
}

export const cases = {
  'RECV-05': desktop => fixture(desktop, async ({gate, peer, target}) => {
    const remote = await peer.call('publish', {text: 'concurrent activation uses one real download', threshold: 4096});
    const item = await received(desktop, remote.id);
    gate.set({path: contentPath, hold: true});
    await click(desktop, item);
    await held(gate);
    for (let index = 0; index < 4; index++) await click(desktop, item);
    assert(gate.state.requests.filter(value => value.method === 'GET' && new RegExp(contentPath).test(value.path)).length === 1,
      'Repeated native activation must share one in-flight original download');
    gate.set({});
    await complete(desktop, item);
    assert((await target.clipboard()).text === 'concurrent activation uses one real download', 'Concurrent consumers must receive exact full text');
  }),

  'RECV-06': desktop => fixture(desktop, async ({peer, target, server}) => {
    const remote = await peer.call('publish', {text: 'unavailable source cannot become original', threshold: 1});
    const item = await received(desktop, remote.id);
    await peer.call('remove', {itemId: item.id});
    await target.offer('missing source must preserve local clipboard');
    const report = desktop.app._reportError;
    const errors = [];
    desktop.app._reportError = error => { errors.push(error); report.call(desktop.app, error); };
    try {
      await click(desktop, item);
      await until(() => item.availability === 'failed', 'real source rejection reaches this item', 20000);
      assert(errors.length > 0 || desktop.app._sync.getTransferForItem(item.id)?.state === 'failed',
        'This item failure must also expose an error or terminal transfer');
      assert(!item.primary.path && !item.primary.bytes && item.availability !== 'ready', 'Missing source must never become a complete local original');
      assert((await target.clipboard()).text === 'missing source must preserve local clipboard', 'Failed materialization must not copy the preview');
      await server.disable();
      assert(!desktop.app._sync.ready, 'Failed waiting request remains cancellable by disabling synchronization');
    } finally { desktop.app._reportError = report; }
  }),

  'RECV-07': desktop => fixture(desktop, async ({peer, target, server}) => {
    const text = 'all representations become durable';
    const html = `<p><strong>${text}</strong></p>`;
    const remote = await peer.call('publish', {types: {
      'text/plain;charset=utf-8': GLib.base64_encode(new TextEncoder().encode(text)),
      'text/html': GLib.base64_encode(new TextEncoder().encode(html)),
    }, threshold: 4096});
    const item = await received(desktop, remote.id);
    assert(item.representations.length === 2 && item.representations.every(value => !value.path && !value.bytes), 'Snapshot starts without either original');
    await click(desktop, item);
    await complete(desktop, item);
    for (const representation of item.representations) {
      const [, bytes] = Gio.File.new_for_path(representation.path).load_contents(null);
      assert(GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes) === representation.sha256,
        'All downloaded representations must be backed by exact original files');
    }
    assert((await target.clipboard()).text === text, 'Native activation must copy exact primary text');
    await restart(desktop);
    await until(() => desktop.app._sync.ready, 'multi-representation session restored', 15000);
    const restored = desktop.app._controller.items.find(value => value.id === item.id);
    assert(restored.representations.every(value => value.path), 'All adopted originals must survive actual extension restart');
    await server.disable();
    await target.offer('offline cached readback sentinel');
    await click(desktop, restored);
    assert((await target.clipboard()).text === text,
      'Already cached primary remains usable offline without a new request');
  }),

  'RECV-08': desktop => lateSelection(desktop, 'new-copy'),
  'RECV-08-manual': desktop => lateSelection(desktop, 'manual-item'),

  'XFER-02-download': desktop => fixture(desktop, async ({gate, peer, target}) => {
    const text = 'bounded download progress '.repeat(100000);
    const remote = await peer.call('publish', {text, threshold: 4 * 1024 * 1024});
    const item = await received(desktop, remote.id);
    const events = [];
    const sync = desktop.app._sync;
    const signal = sync.connect('transfer-changed', (_client, event) => {
      if (event.itemId === item.id && event.direction === 'download') events.push({...event});
    });
    let heartbeat = 0;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => { heartbeat++; return GLib.SOURCE_CONTINUE; });
    try {
      gate.set({path: contentPath, direction: 'download', delay: 0.015});
      await click(desktop, item);
      await complete(desktop, item);
      const samples = events.filter(value => value.totalBytes === remote.primary.size);
      assert(samples.some(value => value.completedBytes > 0 && value.completedBytes < value.totalBytes),
        'Throttled real download must expose an intermediate exact byte count');
      const previous = new Map();
      for (const event of samples) {
        assert(Number.isSafeInteger(event.completedBytes) && event.completedBytes >= (previous.get(event.transferId) ?? 0)
          && event.completedBytes <= event.totalBytes, 'Download progress must remain precise, monotonic and bounded');
        previous.set(event.transferId, event.completedBytes);
      }
      assert(samples.at(-1)?.completedBytes === remote.primary.size && heartbeat > 10, 'Actual download completes all bytes while Shell keeps running');
      assert((await target.clipboard()).sha256 === remote.primary.sha256, 'Reported completion must match actual final clipboard content');
    } finally { GLib.Source.remove(timer); sync.disconnect(signal); }
  }),
};

// Independent entry points ensure a failure in external-copy precedence cannot
// prevent the distinct native history-selection precedence from being tested.
async function lateSelection(desktop, selection) {
  return fixture(desktop, async ({gate, peer, target}) => {
    const local = await capture(desktop, target, 'manually selected local item wins');
    const remote = await peer.call('publish', {text: `late original must not replace ${selection}`, threshold: 4096});
    const item = await received(desktop, remote.id);
    const content = desktop.app._content;
    const activate = content.activate;
    let settled = false;
    content.activate = async function (value, ...options) {
      try { return await activate.call(this, value, ...options); }
      finally { if (value.id === item.id) settled = true; }
    };
    try {
      gate.set({path: contentPath, hold: true});
      await click(desktop, item);
      await held(gate);
      if (selection === 'new-copy') {
        await capture(desktop, target, 'new external owner wins');
      } else {
        await desktop.open();
        await desktop.search(local.text);
        await desktop.click(desktop.history._itemRows.get(local.id).focusActors[0]);
      }
      const expected = selection === 'new-copy' ? 'new external owner wins' : local.text;
      assert((await target.clipboard()).text === expected, 'Newer choice must already own the real clipboard');
      gate.set({});
      await complete(desktop, item);
      await until(() => settled, 'original native activation promise has settled');
      const actual = (await target.clipboard()).text;
      assert(actual === expected, `Late remote download must not overwrite ${selection} (actual=${JSON.stringify(actual)})`);
    } finally { content.activate = activate; }
  });
}
