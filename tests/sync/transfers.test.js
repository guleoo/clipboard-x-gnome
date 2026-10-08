import GLib from 'gi://GLib';

import {MAX_TRANSFER_STATES} from '../../src/sync/constants.js';
import {TransferTracker} from '../../src/sync/transfers.js';
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
assert(tracker.values().length === 0, 'destroying synchronization must clear transfer state');

tracker.update({...base, transferId: 'evicted'}, {immediate: true});
tracker.update({...base, transferId: 'evicted', completedBytes: 3});
assert(tracker._pendingSources.has('evicted'), 'fixture must queue a throttled update');
for (let index = 0; index < MAX_TRANSFER_STATES * 3; index++)
  tracker.update({...base, transferId: GLib.uuid_string_random(), state: 'completed'}, {immediate: true});
assert(tracker.values().length === MAX_TRANSFER_STATES
    && tracker._lastEmittedAt.size === MAX_TRANSFER_STATES
    && tracker._pendingSources.size === 0,
  'eviction must bound every metadata map and remove pending timers');
assert(!tracker._lastEmittedAt.has('evicted'), 'evicted timestamps must be released');
tracker.update({...base, transferId: 'evicted', completedBytes: 4}, {immediate: true});
const emittedBeforeWait = emitted.length;
await delay(60);
assert(emitted.length === emittedBeforeWait,
  'reusing an evicted transfer ID must not receive an obsolete timer notification');
tracker.clear();
assert(tracker._lastEmittedAt.size === 0 && tracker._pendingSources.size === 0,
  'clear must release timestamps and timer metadata');
