import {order} from '../../../src/clipboard/history/order.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const regularOlder = {id: 'regular-older', favorite: false, createdAt: 100};
const pinnedOlder = {id: 'pinned-older', favorite: true, createdAt: 200};
const regularNewer = {id: 'regular-newer', favorite: false, createdAt: 400};
const pinnedNewer = {id: 'pinned-newer', favorite: true, createdAt: 300};
const items = [regularOlder, pinnedOlder, regularNewer, pinnedNewer];

assert(order(items) === items, 'history ordering should update the supplied collection');
assert(
  items.map(item => item.id).join(',')
    === 'pinned-newer,pinned-older,regular-newer,regular-older',
  'pinned entries must stay above newer regular entries after history reloads and captures',
);
