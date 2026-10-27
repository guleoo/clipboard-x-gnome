import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {Server} from '../helpers/server.js';
import {Peer} from '../helpers/peer.js';
import {restart} from '../helpers/restart.js';
import {capture} from '../clipboard/native.js';
import {withCleanup} from '../helpers/resources.js';

async function fixture(desktop, run) {
  let server;
  let target;
  let peer;
  return withCleanup(async () => {
    server = await Server.open(desktop);
    target = await Target.open(desktop);
    await server.enable();
    await run({server, target, peer: async options => {
      assert(!peer, 'Only one independent source is needed per case');
      peer = await Peer.open(desktop, server, options);
      return peer;
    }});
  }, () => [peer, target, server]);
}

async function publish(desktop, item) {
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors
    .find(actor => actor._clipboardXGnomeEntryAction === 'sync'));
  await until(() => desktop.app._sync.getTransferForItem(item.id)?.state === 'completed', 'actual publication confirmed', 30000);
}

async function received(desktop, id) {
  await until(() => desktop.app._controller.items.some(item => item.id === id && item.remote), 'remote snapshot received by automatic poll', 15000);
  return desktop.app._controller.items.find(item => item.id === id);
}

async function polls(desktop, count = 2) {
  let completed = 0;
  const sync = desktop.app._sync;
  const signal = sync.connect('poll-completed', () => { completed++; });
  try { await until(() => completed >= count, 'automatic poll cycles', 15000); }
  finally { sync.disconnect(signal); }
}

function syncButton(desktop, item) {
  return desktop.history._itemRows.get(item.id).focusActors.find(actor => actor._clipboardXGnomeEntryAction === 'sync');
}

export const cases = {
  'CONN-06-profile': desktop => fixture(desktop, async ({server}) => {
    const identity = desktop.settings.get_string('device-id');
    assert(/^[0-9a-f-]{36}$/.test(identity), 'First startup generates a DeviceId');
    desktop.settings.set_string('device-tag', 'Updated native device tag');
    desktop.settings.set_string('device-icon-kind', 'linux');
    await polls(desktop);
    const {devices} = await server.request('GET', '/devices');
    const device = devices.find(value => value.id === server.identity.id);
    assert(device?.tag === 'Updated native device tag' && device.iconKind === 'linux',
      'Actual management API must immediately observe the updated profile');
    await restart(desktop);
    await until(() => desktop.app._sync.ready, 'profile session restored', 15000);
    assert(desktop.settings.get_string('device-id') === identity, 'Profile edits and actual restart must retain DeviceId');
  }),

  'SEND-01': desktop => fixture(desktop, async ({server, target}) => {
    const manual = await capture(desktop, target, 'manual publication must wait for action');
    await polls(desktop);
    assert(!(await server.items()).items.some(item => item.id === manual.id), 'Manual mode must not publish on capture');
    await publish(desktop, manual);
    assert((await server.item(manual.id)).id === manual.id, 'Native row action must reach actual server');
    desktop.settings.set_string('sync-send-mode', 'automatic');
    const automatic = await capture(desktop, target, 'automatic native publication');
    await until(() => desktop.app._sync.getTransferForItem(automatic.id)?.state === 'completed', 'automatic upload completed', 20000);
    assert((await server.item(automatic.id)).id === automatic.id, 'Automatic mode must publish actual owner changes');
  }),

  'SEND-01-pinned': desktop => fixture(desktop, async ({server, target}) => {
    desktop.settings.set_boolean('sync-favorites-only', true);
    desktop.settings.set_string('sync-send-mode', 'automatic');
    const item = await capture(desktop, target, 'only pinned automatic publication');
    await polls(desktop);
    assert(!(await server.items()).items.some(value => value.id === item.id), 'Unpinned capture must not publish');
    await desktop.open();
    await desktop.click(desktop.history._itemRows.get(item.id).focusActors
      .find(actor => actor._clipboardXGnomeEntryAction === 'pin'));
    await until(() => desktop.app._sync.getTransferForItem(item.id)?.state === 'completed', 'pin triggers real automatic publication', 20000);
    assert((await server.item(item.id)).id === item.id, 'Pin action must cross the configured policy boundary');
  }),

  'SEND-02': desktop => fixture(desktop, async ({server, target}) => {
    desktop.settings.set_boolean('sync-text', true);
    desktop.settings.set_boolean('sync-html', true);
    const text = 'Real rich-text capture reaches the configured backend';
    await target.offer(text, {'text/html': new TextEncoder().encode(`<p><strong>${text}</strong></p>`)});
    await until(() => desktop.app._controller.items.some(item => item.text === text), 'actual rich text capture');
    const item = desktop.app._controller.items.find(value => value.text === text);
    assert(item.representations.length === 2, 'The actual owner capture preserves both rich-text formats');
    await publish(desktop, item);
    const remote = await server.item(item.id);
    assert(remote.contents.some(value => value.mimeType.startsWith('text/plain'))
      && remote.contents.some(value => value.mimeType === 'text/html'), 'Native upload action preserves both captured formats');
  }),

  'SEND-06': desktop => fixture(desktop, async ({server, target}) => {
    desktop.settings.set_string('sync-send-mode', 'automatic');
    await server.disable();
    const item = await capture(desktop, target, 'copied while synchronization disabled');
    await server.enable();
    await polls(desktop);
    assert(!(await server.items()).items.some(value => value.id === item.id), 'Re-enable must not backfill copies made while disabled');
    const references = [...desktop.app._uploadQueue._queues.values()].flatMap(queue => [...queue.entries.values()]);
    assert(!references.some(value => value.itemId === item.id), 'Disabled capture must never acquire a durable upload reference');
  }),

  'SEND-10': desktop => fixture(desktop, async ({server, target}) => {
    desktop.settings.set_uint('text-full-threshold', 1);
    const item = await capture(desktop, target, 'durable actual confirmation before restart');
    await publish(desktop, item);
    const path = desktop.app._controller._store.directory().index;
    let saved;
    await until(() => {
      try {
        const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
        saved = JSON.parse(new TextDecoder().decode(bytes)).items.find(value => value.id === item.id);
        return saved?.representations.every(value => value.delivery === 'on-demand');
      } catch { return false; }
    }, 'production confirmation must persist the changed delivery without test-triggered saving');
    await restart(desktop);
    await until(() => desktop.app._sync.ready, 'online after actual extension restart', 15000);
    const restored = desktop.app._controller.items.find(value => value.id === item.id);
    assert(restored && (await server.item(item.id)).contents[0].delivery === 'on-demand',
      'Confirmed content must remain durable across actual disable/re-enable');
    const [, bytes] = Gio.File.new_for_path(desktop.app._controller._store.directory().index).load_contents(null);
    saved = JSON.parse(new TextDecoder().decode(bytes)).items.find(value => value.id === item.id);
    assert(saved?.representations.every(value => value.delivery === 'on-demand'), 'Confirmed manifest state must reach durable history');
  }),

  'RECV-01': desktop => fixture(desktop, async ({target, peer}) => {
    const source = await peer();
    for (const mode of ['disabled', 'history', 'activate']) {
      desktop.settings.set_string('sync-receive-mode', mode);
      await target.offer(`local clipboard sentinel ${mode}`);
      const text = `remote ${mode} ${GLib.uuid_string_random()}`;
      const remote = await source.call('publish', {text, threshold: 4096});
      if (mode === 'disabled') {
        await polls(desktop);
        assert(!desktop.app._controller.items.some(item => item.id === remote.id), 'Disabled receive must acknowledge without importing');
      } else {
        const item = await received(desktop, remote.id);
        await until(() => Boolean(item.primary.path), 'within-threshold original downloaded', 15000);
      }
      await polls(desktop, 1);
      assert((await target.clipboard()).text === (mode === 'activate' ? text : `local clipboard sentinel ${mode}`),
        `Receive ${mode} must respect the actual system clipboard`);
    }
  }),

  'RECV-03': desktop => fixture(desktop, async ({target, peer}) => {
    const source = await peer();
    desktop.settings.set_uint('text-full-threshold', 64);
    const text = 'sender lazy, receiver eager';
    const remote = await source.call('publish', {text, threshold: 1});
    const item = await received(desktop, remote.id);
    await until(() => Boolean(item.primary.path), 'receiver threshold requests sender-lazy original automatically', 20000);
    await desktop.open();
    await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
    assert((await target.clipboard()).text === text, 'Receiver threshold must obtain full exact source bytes');
  }),

  'RECV-04': desktop => fixture(desktop, async ({server, target, peer}) => {
    const source = await peer();
    desktop.settings.set_uint('text-full-threshold', 1);
    desktop.settings.set_uint('image-full-threshold', 1);
    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 400, 40);
    pixbuf.fill(0x336699ff);
    const image = pixbuf.save_to_bufferv('png', [], [])[1];
    const text = 'full lazy text '.repeat(1000);
    for (const [mime, bytes] of [['text/plain;charset=utf-8', new TextEncoder().encode(text)], ['image/png', image]]) {
      const remote = await source.call('publish', {types: {[mime]: GLib.base64_encode(bytes)}, threshold: 1});
      const item = await received(desktop, remote.id);
      await polls(desktop, 1);
      assert(!item.primary.path && !item.primary.bytes, 'Lazy receive must remain a lightweight snapshot before use');
      assert((await server.item(item.id)).contents[0].availability === 'source-required', 'Server must also begin without the lazy original');
      await desktop.open();
      await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
      await until(() => Boolean(item.primary.path), 'row activation obtains lazy source original', 25000);
      await until(() => !desktop.indicator.menu.isOpen, 'materialized activation closes panel');
      const copied = await target.clipboard(mime);
      assert(copied.sha256 === remote.primary.sha256 && copied.size === bytes.length, 'Two-hop lazy download must preserve exact original bytes');
      assert(item.primary.path.includes(`/${source.identity.id}/objects/`), 'Remote originals must be adopted under their source device directory');
      assert((await server.item(item.id)).contents[0].availability === 'available', 'Actual source must also materialize the server cache');
    }
  }),

  'RECV-09': desktop => fixture(desktop, async ({server, peer}) => {
    const source = await peer();
    const remote = await source.call('publish', {text: 'local deletion must not delete remote history', threshold: 4096});
    let item = await received(desktop, remote.id);
    await desktop.open();
    await desktop.click(desktop.history._itemRows.get(item.id).focusActors
      .find(actor => actor._clipboardXGnomeEntryAction === 'delete'));
    await until(() => !desktop.app._controller.items.some(value => value.id === item.id), 'local row removed');
    assert((await server.item(item.id)).id === item.id, 'Local Delete must not mutate server history');
    const second = await source.call('publish', {text: 'administrator deletion propagates', threshold: 4096});
    item = await received(desktop, second.id);
    await server.request('DELETE', `/items/${item.id}`);
    await until(() => !desktop.app._controller.items.some(value => value.id === item.id), 'real remote deletion feed applied', 15000);
  }),

  'XFER-02': desktop => fixture(desktop, async ({server, target}) => {
    desktop.settings.set_uint('text-full-threshold', 4 * 1024 * 1024);
    const events = [];
    const sync = desktop.app._sync;
    const signal = sync.connect('transfer-changed', (_client, event) => events.push({...event}));
    const start = GLib.get_monotonic_time();
    let last = start;
    let gap = 0;
    let ticks = 0;
    const sample = () => {
      const now = GLib.get_monotonic_time();
      gap = Math.max(gap, (now - last) / 1000); last = now;
    };
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
      sample(); ticks++; return GLib.SOURCE_CONTINUE;
    });
    try {
      const text = 'progress '.repeat(250000);
      const item = await capture(desktop, target, text);
      await publish(desktop, item);
      const samples = events.filter(event => event.itemId === item.id && event.totalBytes > 0);
      assert(samples.length >= 2, 'Actual transfer must report progress, not only a final flag');
      const previous = new Map();
      for (const event of samples) {
        const key = `${event.transferId}:${event.totalBytes}`;
        assert(typeof event.transferId === 'string', 'Progress must identify its actual transfer');
        assert(Number.isSafeInteger(event.completedBytes) && event.completedBytes >= 0 && event.completedBytes <= event.totalBytes,
          'Actual progress bytes must be precise and bounded');
        assert(event.completedBytes >= (previous.get(key) ?? 0), 'Actual transfer progress must not move backwards');
        previous.set(key, event.completedBytes);
      }
      const final = samples.at(-1);
      assert(final.state === 'completed' && final.completedBytes === final.totalBytes,
        'Completed transfer must have all declared bytes');
      const remote = await server.item(item.id);
      assert(final.totalBytes === [...remote.contents.filter(value => value.delivery === 'eager'), ...remote.previews]
        .reduce((sum, value) => sum + value.size, 0), 'Progress total must equal the actual uploaded representations plus previews');
      assert(remote.contents[0].size === new TextEncoder().encode(text).length,
        'Progress must agree with the actual remote payload size');
      sample();
      assert(ticks > 5 && gap < 1000, 'Actual capture and upload must keep the Shell main loop responsive');
    } finally {
      sample();
      print(`[simulation] Upload responsiveness: durationMs=${((GLib.get_monotonic_time() - start) / 1000).toFixed(1)}; maxGapMs=${gap.toFixed(1)}; ticks=${ticks}; budgetMs=1000`);
      GLib.Source.remove(timer);
      sync.disconnect(signal);
    }
  }),

  'XFER-04': desktop => fixture(desktop, async ({target, server}) => {
    for (let index = 0; index < 20; index++) {
      const item = await capture(desktop, target, `Completed restore fixture ${index}`);
      await publish(desktop, item);
    }
    await server.disable();
    const sync = desktop.app._sync;
    let restoring = false;
    let restored = 0;
    const counts = {render: 0, persist: 0, save: 0};
    const originals = [];
    for (const [object, name] of [[desktop.history, 'render'], [desktop.app._controller, 'persist'], [desktop.app._controller._store, 'save']]) {
      const original = object[name];
      originals.push(() => { object[name] = original; });
      object[name] = function (...args) { if (restoring) counts[name]++; return original.apply(this, args); };
    }
    const restore = sync._restoreTransfers;
    sync._restoreTransfers = async function (...args) {
      restoring = true;
      try { return await restore.apply(this, args); } finally { restoring = false; }
    };
    const signal = sync.connect('transfer-changed', (_client, transfer) => {
      if (restoring && transfer.kind === 'publish' && transfer.state === 'completed') restored++;
    });
    let last = GLib.get_monotonic_time();
    let gap = 0;
    let ticks = 0;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
      const now = GLib.get_monotonic_time(); gap = Math.max(gap, (now - last) / 1000); last = now; ticks++;
      return GLib.SOURCE_CONTINUE;
    });
    try {
      await server.enable();
      await polls(desktop, 1);
      await pause(30);
      print(`[simulation] Real sync restore heartbeat: maxGapMs=${gap.toFixed(1)}; ticks=${ticks}`);
      assert(ticks > 5 && gap < 1000, 'Full actual restore must not block Shell for one second');
      assert(restored >= 20 && Object.values(counts).every(count => count === 0),
        'Actual completed-publication replay must neither save each item nor rebuild history');
      assert(desktop.app._controller.items.filter(item => !item.remote).length === 20, 'Restoration must not duplicate history');
    } finally {
      GLib.Source.remove(timer);
      sync.disconnect(signal);
      sync._restoreTransfers = restore;
      for (const restoreOriginal of originals) restoreOriginal();
    }
  }),
};
