import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assert, until} from '../helpers/desktop.js';
import {Server} from '../helpers/server.js';
import {Peer} from '../helpers/peer.js';
import {Target} from '../helpers/target.js';
import {withCleanup} from '../helpers/resources.js';
import {sample} from '../helpers/resource-snapshot.js';
import {capture} from '../clipboard/native.js';

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

export const cases = {
  async 'OPS-03-sync'(desktop) {
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
      const baseline = connections(port);
      const samples = [];
      let observedConnection = false;
      for (let cycle = -2; cycle < 8; cycle++) {
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
      }
      assert(observedConnection && samples.length === 16,
        'Eight measured cycles must include real Shell TCP activity and both resource phases');
      for (const phase of ['sync-active', 'sync-disabled']) {
        const values = samples.filter(value => value.phase === phase);
        print(`[simulation] Bounded sync trend: phase=${phase}; cycles=${values.length}; rssDeltaKB=${values.at(-1).rssKB - values[0].rssKB}; fdDelta=${values.at(-1).openFDs - values[0].openFDs}; scope=bounded-real-sync-not-long-soak`);
      }
    }, () => [peer, target, server]);
  },
};
