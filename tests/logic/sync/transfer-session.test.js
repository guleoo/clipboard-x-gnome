import Gio from 'gi://Gio';

import {TransferSession} from '../../../src/sync/transfer-session.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Transfer session test timed out')), 3000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const observe = promise => promise.then(value => ({value}), error => ({error}));
const transfer = {
  transferId: '11111111-1111-4111-8111-111111111111',
  itemId: '22222222-2222-4222-8222-222222222222',
  state: 'queued', completedBytes: 0, totalBytes: 4, updatedAt: 1,
};
const cancellations = [];
const session = new TransferSession({
  isCurrent: () => true,
  transport: () => ({cancel: async id => { cancellations.push(id); }}),
  timeout: () => 3000,
  onChange() {},
});

try {
  session.receive(transfer);
  assert(session.pendingIds().includes(transfer.transferId)
      && session.get(transfer.transferId).state === 'queued',
    'receiving a server task must register both polling ownership and queryable state');
  const first = session.wait(transfer.transferId);
  const second = session.wait(transfer.transferId);
  assert(first === second, 'concurrent consumers must share a single transfer waiter');
  session.receive({...transfer, state: 'completed', completedBytes: 4});
  await bounded(Promise.all([first, second]));
  assert(!session.pendingIds().includes(transfer.transferId)
      && session.get(transfer.transferId).state === 'completed',
    'receiving server completion must settle consumers and release polling ownership together');

  // RECV-06: every consumer of the same remote original must finish when the
  // source reports failure, expiry or cancellation, not wait for its own timer.
  for (const [index, state] of ['failed', 'expired', 'cancelled'].entries()) {
    const remote = {...transfer,
      transferId: `88888888-8888-4888-8888-88888888888${index}`};
    session.receive(remote);
    const first = session.wait(remote.transferId);
    const second = session.wait(remote.transferId);
    assert(first === second, `${state}: consumers must share the remote wait`);
    const consumers = [observe(first), observe(second)];
    const errorMessage = `Source transfer ${state}`;
    session.receive({...remote, state, errorMessage, updatedAt: 2});
    const results = await bounded(Promise.all(consumers));
    assert(results.every(result => result.error?.message === errorMessage)
        && results[0].error === results[1].error,
      `${state}: a confirmed remote terminal state must reject all waiting consumers`);
    assert(!session.pendingIds().includes(remote.transferId),
      `${state}: a confirmed remote terminal state must release polling ownership`);
    const later = await bounded(observe(session.wait(remote.transferId)));
    assert(later.error?.message === errorMessage
        && !session.pendingIds().includes(remote.transferId),
      `${state}: later consumers must receive the terminal failure without reopening a wait`);
  }

  // XFER-06: let the real wait deadline fire while the controlled transport is
  // still cancelling. Consumers must finish even before the server replies;
  // the remote task remains owned until that cancellation is acknowledged.
  let acknowledgeCancel;
  const cancellationGate = new Promise(resolve => { acknowledgeCancel = resolve; });
  let cancellationRecorded;
  const cancelled = new Promise(resolve => { cancellationRecorded = resolve; });
  const timedCancellations = [];
  let timeout = 40;
  const timed = new TransferSession({
    isCurrent: () => true,
    transport: () => ({cancel: async id => {
      timedCancellations.push(id);
      await cancellationGate;
    }}),
    timeout: () => timeout,
    onChange(value) {
      if (value.state === 'cancelled')
        cancellationRecorded();
    },
  });
  try {
    const remote = {...transfer, transferId: '99999999-9999-4999-8999-999999999999'};
    timed.receive(remote);
    const first = timed.wait(remote.transferId);
    const second = timed.wait(remote.transferId);
    assert(first === second, 'The timed transfer must have one wait shared by both consumers');
    const results = await bounded(Promise.all([observe(first), observe(second)]));
    assert(results.every(result => result.error?.message === 'Timed out waiting for synchronized content')
        && results[0].error === results[1].error,
      'The actual short deadline must reject every consumer without awaiting remote cancellation');
    assert(timedCancellations.length === 1 && timedCancellations[0] === remote.transferId
        && timed.pendingIds().includes(remote.transferId),
      'A shared timeout must request remote cancellation once and retain ownership until acknowledgement');
    acknowledgeCancel();
    await bounded(cancelled);
    assert(timed.get(remote.transferId).state === 'cancelled'
        && !timed.pendingIds().includes(remote.transferId),
      'Acknowledged timeout cancellation must release the old remote polling task');
    const later = await bounded(observe(timed.wait(remote.transferId)));
    assert(later.error?.message === 'Transfer cancelled'
        && !timed.pendingIds().includes(remote.transferId),
      'The cancelled transfer must reject later consumers without leaving a new wait');

    timeout = 3000;
    const retry = {...transfer, transferId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
    timed.receive(retry);
    const retries = [observe(timed.wait(retry.transferId)), observe(timed.wait(retry.transferId))];
    timed.receive({...retry, state: 'completed', completedBytes: 4, updatedAt: 2});
    const retried = await bounded(Promise.all(retries));
    assert(retried.every(result => !result.error)
        && timed.pendingIds().length === 0 && timedCancellations.length === 1,
      'Both consumers must be able to retry the same item with a fresh transfer after a timeout');
  } finally {
    acknowledgeCancel();
    timed.close(new Error('Timed transfer test cleanup'));
  }

  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  let localOperation;
  const pending = observe(session.run(async ({cancellable, track}) => {
    localOperation = cancellable;
    track(transfer, {remote: false});
    await gate;
  }));
  try {
    assert(session.running(transfer.transferId), 'run must register a tracked local operation');
    await session.cancel(transfer.transferId);
    assert(localOperation.is_cancelled() && cancellations.length === 0
        && session.get(transfer.transferId).state === 'cancelled',
      'local-only cancellation must stop the operation without sending a server DELETE');
  } finally {
    finish();
  }
  const result = await bounded(pending);
  assert(result.error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
      && !session.running(transfer.transferId),
    'a cancelled operation must reject and release its registration when it finishes');

  const remote = {...transfer, transferId: '77777777-7777-4777-8777-777777777777'};
  let finishRemote;
  const remoteGate = new Promise(resolve => { finishRemote = resolve; });
  const remoteOperation = session.run(async ({track}) => {
    track(remote);
    await remoteGate;
    throw new Error('Unconfirmed upload failure');
  });
  const remoteResult = observe(remoteOperation);
  assert(!session.pendingIds().includes(remote.transferId),
    'A running remote operation must not be polled alongside its live I/O');
  finishRemote();
  await bounded(remoteResult);
  assert(session.get(remote.transferId).state === 'failed' && session.pendingIds().includes(remote.transferId),
    'A local failure is not a server-confirmed terminal state and must remain refreshable');
  session.receive({...remote, state: 'completed', completedBytes: 4, updatedAt: Date.now()});
  assert(!session.pendingIds().includes(remote.transferId),
    'Only a confirmed server terminal state may release an unfinished remote operation');

  const server = {...transfer, transferId: '44444444-4444-4444-8444-444444444444',
    state: 'completed', updatedAt: Date.now() + 60_000};
  session.receive(server);
  const startDownload = transferId => {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    let operation;
    let progress;
    const pending = observe(session.run(async ({cancellable, track, update}) => {
      operation = cancellable;
      progress = update;
      track({...transfer, transferId, state: 'transferring', updatedAt: Date.now()}, {remote: false});
      await gate;
    }));
    return {transferId, pending, finish, operation, progress};
  };
  const downloads = [startDownload('55555555-5555-4555-8555-555555555555'),
    startDownload('66666666-6666-4666-8666-666666666666')];
  try {
    const [older, newer] = downloads;
    older.progress({completedBytes: 1}, true);
    newer.progress({completedBytes: 2}, true);
    session.receive({...server, updatedAt: server.updatedAt + 1});
    const current = session.forItem(transfer.itemId);
    assert(current.transferId === newer.transferId && current.completedBytes === 2,
      'item queries must expose the newest active download progress despite ahead-clock server completion');
    await session.cancel(current.transferId);
    assert(newer.operation.is_cancelled() && !older.operation.is_cancelled()
        && session.get(newer.transferId).state === 'cancelled'
        && session.forItem(transfer.itemId).transferId === older.transferId,
      'cancelling the queried download must stop only that operation and expose the remaining active download');
    await session.cancel(session.forItem(transfer.itemId).transferId);
    session.receive({...server, updatedAt: server.updatedAt + 2});
    assert(older.operation.is_cancelled() && cancellations.length === 0
        && session.forItem(transfer.itemId).transferId === newer.transferId
        && session.forItem(transfer.itemId).state === 'cancelled',
      'after every local download is cancelled, queries must retain the newest operation without a server DELETE');
  } finally {
    for (const download of downloads)
      download.finish();
    const results = await bounded(Promise.all(downloads.map(download => download.pending)));
    assert(results.every(value => value.error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        && downloads.every(download => !session.running(download.transferId)),
      'cancelled concurrent downloads must reject and release all operation registrations');
  }

  const teardownTransfer = {...transfer, transferId: '33333333-3333-4333-8333-333333333333'};
  session.receive(teardownTransfer);
  const waiting = [observe(session.wait(teardownTransfer.transferId)),
    observe(session.wait(teardownTransfer.transferId))];
  const closed = new Error('Session closed');
  session.close(closed);
  const results = await bounded(Promise.all(waiting));
  assert(results.every(value => value.error === closed),
    'session teardown must reject every waiting consumer with the teardown error');
  assert(!session.current && session.values().length === 0,
    'closing the session must invalidate it and clear transfer records');
  let lateError;
  try {
    session.receive(transfer);
  } catch (error) {
    lateError = error;
  }
  assert(lateError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
      && session.pendingIds().length === 0 && session.values().length === 0,
    'late server observations must not repopulate a closed session');
} finally {
  session.close(new Error('Test cleanup'));
}
