import Gio from 'gi://Gio';

import {TransferSession} from '../../src/sync/transfer-session.js';

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
  session.record(transfer, true);
  const first = session.wait(transfer.transferId);
  const second = session.wait(transfer.transferId);
  assert(first === second, 'concurrent consumers must share a single transfer waiter');
  session.record({...transfer, state: 'completed', completedBytes: 4}, true);
  await bounded(Promise.all([first, second]));

  session.record(transfer, true);
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

  const teardownTransfer = {...transfer, transferId: '33333333-3333-4333-8333-333333333333'};
  session.record(teardownTransfer, true);
  const waiting = [observe(session.wait(teardownTransfer.transferId)),
    observe(session.wait(teardownTransfer.transferId))];
  const closed = new Error('Session closed');
  session.close(closed);
  const results = await bounded(Promise.all(waiting));
  assert(results.every(value => value.error === closed),
    'session teardown must reject every waiting consumer with the teardown error');
  assert(!session.current && session.values().length === 0,
    'closing the session must invalidate it and clear transfer records');
} finally {
  session.close(new Error('Test cleanup'));
}
