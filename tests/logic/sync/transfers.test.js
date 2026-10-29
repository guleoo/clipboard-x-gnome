import GLib from 'gi://GLib';

import {MAX_TRANSFER_STATES} from '../../../src/sync/constants.js';
import {TransferTracker} from '../../../src/sync/transfers.js';
import {delay} from './integration/measure.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const emitted = [];
const tracker = new TransferTracker(transfer => emitted.push(transfer));
const base = {
  transferId: '11111111-1111-4111-8111-111111111111',
  itemId: '22222222-2222-4222-8222-222222222222',
  state: 'transferring',
  completedBytes: 2,
  totalBytes: 10,
  updatedAt: 100,
};
tracker.update(base, {immediate: true});
tracker.update({...base, completedBytes: 1, updatedAt: 99}, {immediate: true});
assert(tracker.get(base.transferId).completedBytes === 2,
  'stale progress must not replace a newer transfer state');
tracker.update({...base, state: 'completed', completedBytes: 10, updatedAt: 90}, {immediate: true});
assert(tracker.get(base.transferId).state === 'completed',
  'a terminal server response must not be lost behind a newer local progress timestamp');
assert(tracker.forItem(base.itemId).state === 'completed' && emitted.length === 2,
  'item lookup and immediate terminal notifications must use the latest state');
tracker.clear();
assert(tracker.values().length === 0 && tracker.forItem(base.itemId) === null,
  'destroying synchronization must clear transfer state and item lookups');

for (const serverOffset of [60_000, 0]) {
  const now = 1_000_000;
  const server = {...base, transferId: 'server-request', state: 'completed', updatedAt: now + serverOffset};
  const first = {...base, transferId: 'first-download', updatedAt: now};
  const second = {...base, transferId: 'second-download', updatedAt: now};
  tracker.update(server, {immediate: true});
  tracker.update(first, {immediate: true});
  assert(tracker.forItem(base.itemId).transferId === first.transferId,
    'an active local download must outrank completed server requests with ahead or equal clocks');
  tracker.update({...server, updatedAt: server.updatedAt + 1}, {immediate: true});
  assert(tracker.forItem(base.itemId).transferId === first.transferId,
    'a late completed server request must not hide an active local download');
  tracker.update(second, {immediate: true});
  tracker.update({...first, completedBytes: 5, updatedAt: now + 1}, {immediate: true});
  assert(tracker.forItem(base.itemId).transferId === second.transferId,
    'multiple active downloads must use session operation order, not timestamp or progress arrival order');
  tracker.update({...second, state: 'completed'}, {immediate: true});
  assert(tracker.forItem(base.itemId).transferId === first.transferId,
    'an older active download must remain available when the newer download completes');
  tracker.update({...first, state: 'completed', updatedAt: now + 2}, {immediate: true});
  tracker.update({...server, updatedAt: server.updatedAt + 3}, {immediate: true});
  assert(tracker.forItem(base.itemId).transferId === second.transferId,
    'completed downloads must retain session order despite late responses from older operations');
  tracker.update({...base, itemId: 'other-item', transferId: 'other-download'}, {immediate: true});
  assert(tracker.forItem(base.itemId).transferId === second.transferId,
    'an unrelated active transfer must not change an item lookup');
  tracker.clear();
}

const beforeTerminal = emitted.length;
tracker.update(base, {immediate: true});
tracker.update({...base, completedBytes: 3, updatedAt: 101});
assert(tracker._pendingSources.has(base.transferId), 'progress must remain throttled');
tracker.update({...base, state: 'completed', completedBytes: 10, updatedAt: 90});
assert(emitted.length === beforeTerminal + 2 && emitted.at(-1).state === 'completed'
    && tracker._pendingSources.size === 0,
  'a terminal response must bypass throttling and cancel the pending progress notification');
await delay(60);
assert(emitted.length === beforeTerminal + 2,
  'a terminal notification must not be followed by obsolete throttled progress');
tracker.clear();

tracker.update({...base, itemId: 'evicted-item', transferId: 'evicted'}, {immediate: true});
tracker.update({...base, itemId: 'evicted-item', transferId: 'evicted', completedBytes: 3});
assert(tracker._pendingSources.has('evicted'), 'fixture must queue a throttled update');
for (let index = 0; index < MAX_TRANSFER_STATES * 3; index++)
  tracker.update({...base, transferId: GLib.uuid_string_random(), state: 'completed'}, {immediate: true});
assert(tracker.values().length === MAX_TRANSFER_STATES
    && tracker._lastEmittedAt.size === MAX_TRANSFER_STATES
    && tracker._pendingSources.size === 0,
  'eviction must bound every metadata map and remove pending timers');
assert(!tracker._lastEmittedAt.has('evicted'), 'evicted timestamps must be released');
assert(tracker.forItem('evicted-item') === null, 'eviction must release item lookup state');
tracker.update({...base, transferId: 'evicted', completedBytes: 4}, {immediate: true});
const emittedBeforeWait = emitted.length;
await delay(60);
assert(emitted.length === emittedBeforeWait,
  'reusing an evicted transfer ID must not receive an obsolete timer notification');
tracker.clear();
assert(tracker._lastEmittedAt.size === 0 && tracker._pendingSources.size === 0
    && tracker.forItem(base.itemId) === null,
  'clear must release timestamps, timer metadata and item lookup state');
