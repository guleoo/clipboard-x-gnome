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
  'RECV-05-automatic-manual': desktop => fixture(desktop, async ({gate, peer, target}) => {
    const text = 'automatic materialization shares the manual activation original';
    const sentinel = 'automatic history fetching must not change clipboard before explicit activation';
    await capture(desktop, target, sentinel);
    desktop.settings.set_uint('text-full-threshold', 4096);
    gate.set({path: contentPath, hold: true});
    const remote = await peer.call('publish', {text, threshold: 4096});
    const item = await received(desktop, remote.id);
    await held(gate);
    assert(!item.primary.path && (await target.clipboard()).text === sentinel,
      'Automatic fetching must not activate the external clipboard before a user action');
    const revision = desktop.app._controller.selectionRevision;
    await click(desktop, item);
    assert((await target.clipboard()).text === sentinel, 'Activation must not copy a preview while the original is held');
    gate.set({});
    await complete(desktop, item);
    await until(() => desktop.app._controller.selectionRevision > revision,
      'explicit activation produces a real clipboard owner change');
    assert((await target.clipboard()).sha256 === remote.primary.sha256,
      'The native row must activate the exact original; HTTP consumer deduplication runs headlessly');
  }),

  'CLIP-08-remote-loop': desktop => fixture(desktop, async ({server, gate, peer, target}) => {
    desktop.settings.set_string('sync-send-mode', 'automatic');
    const control = await capture(desktop, target, 'positive control: local copying really uploads in automatic mode');
    await until(() => desktop.app._sync.getTransferForItem(control.id)?.state === 'completed',
      'automatic sending is genuinely active before testing remote feedback', 20000);
    assert((await server.items()).items.some(item => item.id === control.id), 'Positive control must reach the actual server');
    const start = gate.state.requests.length;
    const content = desktop.app._content;
    const finish = content._finishReceived;
    const activate = content.activate;
    const observed = new Map();
    const additions = [];
    const controller = desktop.app._controller;
    const addedSignal = controller.connect('item-added', (_controller, item, source) => additions.push({id: item.id, text: item.text, source}));
    content._finishReceived = async function (item, ...options) {
      const state = observed.get(item.text);
      if (state) state.started++;
      try { return await finish.call(this, item, ...options); }
      finally { if (state) state.finished++; }
    };
    content.activate = async function (item, ...options) {
      try { return await activate.call(this, item, ...options); }
      finally { if (observed.has(item.text)) observed.get(item.text).activated = true; }
    };
    const remoteIds = [];
    try {
      for (const mode of ['history', 'activate']) {
        desktop.settings.set_string('sync-receive-mode', mode);
        desktop.settings.set_uint('text-full-threshold', 4096);
        const text = `remote ${mode} writeback cannot become a local automatic publication`;
        const state = {started: 0, finished: 0, activated: false};
        observed.set(text, state);
        const revision = controller.selectionRevision;
        const remote = await peer.call('publish', {text, threshold: 4096});
        remoteIds.push(remote.id);
        const item = await received(desktop, remote.id);
        if (mode === 'history') {
          await until(() => state.started > 0 && state.finished === state.started, 'history automatic content fetch finished', 20000);
          await click(desktop, item);
          await until(() => state.activated, 'explicit remote activation has finished');
        } else {
          await until(() => state.started > 0 && state.finished === state.started, 'receive-and-activate has finished', 20000);
        }
        await until(() => controller.selectionRevision > revision && !controller._captureInProgress && !controller._captureQueued,
          'remote writeback owner event and self-capture have settled');
        assert((await target.clipboard()).text === text, 'Remote writeback must actually own the external GTK clipboard');
        let polls = 0;
        const sync = desktop.app._sync;
        const pollSignal = sync.connect('poll-completed', () => polls++);
        try {
          await until(() => polls >= 2 && !desktop.app._uploadQueue._worker,
            'two automatic polls and any outgoing worker have drained', 15000);
          await desktop.app._uploadQueue._chain;
        } finally { sync.disconnect(pollSignal); }
        assert(controller.items.filter(value => value.text === text).length === 1
          && controller.items.find(value => value.text === text)?.id === remote.id && item.remote,
        'Clipboard recapture must retain exactly the remote identity, not create a local duplicate');
        assert(!additions.some(value => value.text === text && value.source !== 'remote'),
          'Remote activation must not emit a fresh local item-added publication trigger');
        assert(![...desktop.app._uploadQueue._queues.values()].some(queue =>
          [...queue.entries.values()].some(entry => entry.itemId === remote.id)), 'Remote identity must never remain in a local outbox');
      }
      const items = (await server.items()).items;
      assert(items.length === 1 + remoteIds.length && remoteIds.every(id => items.filter(item => item.id === id).length === 1),
        'Actual server history must contain only the positive control and independently published remote items');
      assert(!gate.state.requests.slice(start).some(value => value.method === 'POST' && /\/channels\/[^/]+\/items$/.test(value.path)),
        'Remote clipboard feedback must not issue any publication request, including one later deduplicated by the server');
    } finally {
      content._finishReceived = finish;
      content.activate = activate;
      controller.disconnect(addedSignal);
    }
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
    const start = GLib.get_monotonic_time();
    let last = start;
    let gap = 0;
    let heartbeat = 0;
    const sample = () => {
      const now = GLib.get_monotonic_time();
      gap = Math.max(gap, (now - last) / 1000); last = now;
    };
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
      sample(); heartbeat++; return GLib.SOURCE_CONTINUE;
    });
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
      sample();
      assert(gap < 1000, 'A slow network download must not hide a one-second Shell main-loop stall');
    } finally {
      sample();
      print(`[simulation] Download responsiveness: durationMs=${((GLib.get_monotonic_time() - start) / 1000).toFixed(1)}; maxGapMs=${gap.toFixed(1)}; ticks=${heartbeat}; budgetMs=1000`);
      GLib.Source.remove(timer);
      sync.disconnect(signal);
    }
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
