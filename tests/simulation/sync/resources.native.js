import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, pause, until} from '../helpers/desktop.js';
import {Server} from '../helpers/server.js';
import {Peer} from '../helpers/peer.js';
import {Target} from '../helpers/target.js';
import {withCleanup} from '../helpers/resources.js';
import {sample} from '../helpers/resource-snapshot.js';
import {capture} from '../clipboard/native.js';
import {restart} from '../helpers/restart.js';

function children(path) {
  const directory = Gio.File.new_for_path(path);
  if (!directory.query_exists(null)) return [];
  const enumerator = directory.enumerate_children('standard::name,standard::type,standard::symlink-target',
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  const values = [];
  try { let info; while ((info = enumerator.next_file(null))) values.push(info); }
  finally { enumerator.close(null); }
  return values;
}

function connections(port) {
  const owned = new Set(children('/proc/self/fd').map(info => info.get_symlink_target()?.match(/^socket:\[(\d+)\]$/)?.[1]));
  const [, bytes] = Gio.File.new_for_path('/proc/net/tcp').load_contents(null);
  return new Set(new TextDecoder().decode(bytes).trim().split('\n').slice(1).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    return fields[3] === '01' && Number.parseInt(fields[2].split(':')[1], 16) === port
      && owned.has(fields[9]) ? [fields[9]] : [];
  }));
}

function temporaryCount(path, staging = false) {
  return children(path).reduce((count, info) => {
    const name = info.get_name();
    return count + (info.get_file_type() === Gio.FileType.DIRECTORY
      ? temporaryCount(`${path}/${name}`, staging || name === '.staging')
      : Number(staging || name.endsWith('.part')));
  }, 0);
}

async function exercise(desktop, {seconds = 0} = {}) {
    let server;
    let peer;
    let target;
    await withCleanup(async () => {
      server = await Server.open(desktop);
      target = await Target.open(desktop);
      peer = await Peer.open(desktop, server);
      const port = Number(server.address.split(':').at(-1));
      // The admin fixture may keep its own connection; peer sockets belong to
      // another PID. Only new sockets owned by this Shell are plugin candidates.
      const samples = [];
      let observedConnection = false;
      let started = 0;
      for (let cycle = -2; cycle < 8 || seconds && (!started
        || GLib.get_monotonic_time() - started < seconds * 1_000_000); cycle++) {
        if (cycle === 0) started = GLib.get_monotonic_time();
        const cycleStarted = GLib.get_monotonic_time();
        const baseline = connections(port);
        await server.enable();
        const sync = desktop.app._sync;
        const tasks = sync._transfers;
        let polls = 0;
        let errors = 0;
        const signals = [sync.connect('poll-completed', () => polls++),
          sync.connect('status-changed', (_client, state) => { if (state === 'error') errors++; }),
          sync.connect('transfer-changed', () => {
            if (!observedConnection)
              observedConnection = [...connections(port)].some(inode => !baseline.has(inode));
          })];
        try {
          const local = await capture(desktop, target, `resource upload ${cycle}`);
          await desktop.open();
          await desktop.click(desktop.history._itemRows.get(local.id).focusActors
            .find(actor => actor._clipboardXGnomeEntryAction === 'sync'));
          await until(() => sync.getTransferForItem(local.id)?.state === 'completed', 'small actual upload completes', 20000);
          const remote = await peer.call('publish', {text: `resource receive ${cycle}`, threshold: 4096});
          await until(() => desktop.app._controller.items.some(item => item.id === remote.id && item.remote
            && item.availability === 'ready' && item.primary.path), 'peer original is received and adopted', 20000);
          await until(() => polls >= 2 && !sync._polling && !tasks.pendingIds().length
            && !tasks._waiters.size && !tasks._materializations.size && !tasks._operations.size
            && !tasks._cancellables.size && !desktop.app._uploadQueue._worker,
          'two real polls finish without lingering transfer or queue work', 20000);
          await desktop.open();
          await desktop.search('resource');
          await desktop.search('');
          await desktop.close();
          await desktop.app._controller.persist();
          const store = desktop.app._controller._store;
          assert(errors === 0 && sync.ready && sync._state === 'online', 'Repeated work must not conceal failed polling');
          assert(store._staged.size === 0 && temporaryCount(store.rootPath) === 0,
            'Completed capture/receive/save must leave no staged objects or partial download files');
          if (cycle >= 0) samples.push(sample(cycle, 'sync-active'));
          const cancellable = sync._cancellable;
          await server.disable();
          assert(sync._pollSource === 0 && sync._transport === null && cancellable.is_cancelled(),
            'Native sync off must release the polling source, transport and I/O generation');
          await until(() => [...connections(port)].every(inode => baseline.has(inode)),
            'Shell-owned synchronization TCP connections close after native sync off');
          assert(!tasks.pendingIds().length && !tasks._waiters.size && !tasks._materializations.size
            && !tasks._operations.size && !tasks._cancellables.size && temporaryCount(store.rootPath) === 0,
          'Stopped generations must retain neither transfer consumers, I/O owners nor temporary content');
          if (cycle >= 0) samples.push(sample(cycle, 'sync-disabled'));
        } finally { for (const signal of signals) sync.disconnect(signal); }
        if (seconds && cycle >= 0) {
          // Keep the live data set fixed: legitimate history growth must not
          // masquerade as a process leak. Exercise actual remote tombstones.
          for (const item of [...desktop.app._controller.items]) {
            desktop.app._controller.remove(item.id);
            await server.request('DELETE', `/items/${item.id}`);
          }
          await desktop.app._controller.persist();
          await desktop.app._uploadQueue.prune();
          if ((cycle + 1) % 10 === 0) await restart(desktop);
          print(`[simulation] Soak progress: cycles=${cycle + 1}; elapsedSeconds=${((GLib.get_monotonic_time() - started) / 1_000_000).toFixed(1)}; liveItems=${desktop.app._controller.items.length}`);
          await pause(Math.max(0, 30_000 - (GLib.get_monotonic_time() - cycleStarted) / 1000));
        }
      }
      const elapsedSeconds = (GLib.get_monotonic_time() - started) / 1_000_000;
      assert(observedConnection && (seconds ? elapsedSeconds >= seconds && samples.length >= 16 : samples.length === 16),
        'Measured cycles must include real Shell TCP activity, both resource phases and the requested duration');
      const trends = {};
      for (const phase of ['sync-active', 'sync-disabled']) {
        const values = samples.filter(value => value.phase === phase);
        const medians = Array.from({length: Math.min(6, values.length)}, (_, window) => {
          const count = Math.min(6, values.length);
          const sorted = values.slice(Math.floor(window * values.length / count), Math.floor((window + 1) * values.length / count))
            .map(value => value.rssKB).sort((left, right) => left - right);
          return sorted[Math.floor(sorted.length / 2)];
        });
        trends[phase] = {rssWindowMediansKB: medians, rssDeltaKB: values.at(-1).rssKB - values[0].rssKB,
          fdDelta: values.at(-1).openFDs - values[0].openFDs, cycles: values.length};
        print(`[simulation] Sync resource trend: phase=${phase}; cycles=${values.length}; rssDeltaKB=${trends[phase].rssDeltaKB}; fdDelta=${trends[phase].fdDelta}; rssWindowMediansKB=${medians.join(',')}; elapsedSeconds=${elapsedSeconds.toFixed(1)}; scope=${seconds ? 'two-hour-real-sync-with-restarts' : 'bounded-real-sync-not-long-soak'}`);
      }
      if (seconds) Gio.File.new_for_path(`${GLib.getenv('CBX_SIMULATION_ARTIFACTS')}/OPS-03-soak-resources.json`)
        .replace_contents(new TextEncoder().encode(JSON.stringify({elapsedSeconds, samples, trends}, null, 2)),
          null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }, () => [peer, target, server]);
}

export const cases = {
  'OPS-03-sync': desktop => exercise(desktop),
  'OPS-03-soak': desktop => exercise(desktop, {seconds: 7200}),
};
