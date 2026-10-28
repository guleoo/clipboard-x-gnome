import {order} from '../../../../src/clipboard/history/order.js';
import {search} from '../../../../src/clipboard/history/search.js';

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

// Search rules belong here; native coverage only verifies input-to-row wiring.
const entries = [
  {id: 'alpha', preview: {text: 'Alpha Beta'}},
  {id: 'unicode', preview: {text: '中文内容 🙂'}},
  {id: 'second-alpha', preview: {text: 'another ALPHA'}},
  {id: 'other', preview: {text: 'No matching letters'}},
  {id: 'no-preview', text: 'Alpha is not a preview'},
];
const cache = new WeakMap();
for (const [query, limit, expected] of [
  ['alpha', Infinity, ['alpha', 'second-alpha']],
  [' ALPHA ', Infinity, ['alpha', 'second-alpha']],
  ['中文', Infinity, ['unicode']],
  ['🙂', Infinity, ['unicode']],
  ['absent-value', Infinity, []],
  ['', Infinity, entries.map(item => item.id)],
  [' \t\n ', 2, ['alpha', 'unicode']],
  ['alpha', 1, ['alpha']],
  ['alpha', 2, ['alpha', 'second-alpha']],
]) {
  const result = search(entries, query, limit, cache);
  assert(result.map(item => item.id).join() === expected.join(),
    `Search ${JSON.stringify(query)} with limit ${limit} must retain matching order and preview semantics`);
  assert(result.every(item => entries.includes(item)), 'Search must return original items, not copies');
}
assert(entries.map(item => item.id).join() === 'alpha,unicode,second-alpha,other,no-preview',
  'Searching must not reorder or trim the source history');
