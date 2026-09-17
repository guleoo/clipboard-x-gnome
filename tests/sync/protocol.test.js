import {
  acceptedWork,
  changes,
  channels,
  device,
  item,
  publication,
  status,
  transfer,
  workPage,
} from '../../src/sync/protocol.js';
import {API_ROOT, API_VERSION, routes} from '../../src/sync/http/routes.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertRejects(callback, message) {
  try {
    callback();
  } catch (_error) {
    return;
  }
  throw new Error(message);
}

const deviceId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const transferId = '44444444-4444-4444-8444-444444444444';
const uploadId = '55555555-5555-4555-8555-555555555555';
const workId = '66666666-6666-4666-8666-666666666666';
const digest = 'a'.repeat(64);
const profile = device({id: deviceId, tag: 'Laptop', iconKind: 'laptop',
  iconColor: {light: '#ffffff', dark: '#525252'}}, deviceId);
assert(!Object.hasOwn(profile, 'iconColor'), 'the client must ignore server device colors');
assert(device({id: deviceId, tag: 'Laptop', iconKind: 'laptop'}, deviceId).iconKind === 'laptop',
  'the client must accept device profiles without icon colors');
assert(device({id: deviceId, tag: 'Laptop', iconKind: 'future-platform'}, deviceId).iconKind === 'future-platform',
  'the protocol must preserve arbitrary icon identifiers');
assertRejects(() => device({id: deviceId, tag: 'Laptop', iconKind: 'x'.repeat(129)}, deviceId),
  'icon identifiers longer than the protocol limit must be rejected');
assertRejects(() => device({id: deviceId, tag: 'Laptop', iconKind: ''}, deviceId),
  'empty icon identifiers must be rejected');

assert(API_VERSION === 1 && API_ROOT === '/api/v1', 'HTTP protocol must be explicitly versioned');
assert(routes.item(channelId, itemId) === `/api/v1/channels/${channelId}/items/${itemId}`,
  'item routes must carry channel and item identity');
assert(routes.content(channelId, itemId, digest).endsWith(`/contents/${digest}`),
  'content routes must address immutable representations');

const capabilities = status({
  apiVersion: 1,
  serverVersion: '0.1.0',
  state: 'online',
  capabilities: {
    supportedMimeTypes: ['text/plain;charset=utf-8', 'image/png'],
    maxItemBytes: 64 * 1024 * 1024,
    maxPreviewBytes: 256 * 1024,
  },
});
assert(capabilities.status === 'online' && capabilities.maxPreviewBytes === 256 * 1024,
  'server capabilities must validate');
assertRejects(() => status({apiVersion: 2, state: 'online'}),
  'unsupported protocol versions must be rejected');

const channelList = channels({channels: [{id: channelId, name: '家庭'}]}, channelId);
assert(channelList[0].active, 'the locally selected channel must be marked active');

const transferDocument = {
  id: transferId,
  itemId,
  deviceId,
  kind: 'publish',
  direction: 'upload',
  state: 'queued',
  completedBytes: 0,
  totalBytes: 5,
  peerDeviceIds: [],
  createdAt: 1,
  updatedAt: 1,
};
assert(transfer(transferDocument, deviceId).totalBytes === 5, 'transfer progress must validate');
assertRejects(() => transfer({...transferDocument, completedBytes: 6}),
  'completed bytes may not exceed total bytes');

const published = publication({
  itemId,
  uploadId,
  previewIds: [digest],
  contentIds: [digest],
  transfer: transferDocument,
}, itemId);
assert(published.uploadId === uploadId && published.contentIds[0] === digest,
  'publication must declare exactly which objects need streaming upload');

const remote = item({
  id: itemId,
  createdAt: 10,
  origin: {deviceId, tag: 'Laptop', iconKind: 'custom-os', iconColor: {light: '#2190a4'}},
  contents: [{id: digest, mimeType: 'text/plain;charset=utf-8', size: 5, sha256: digest, delivery: 'on-demand'}],
  previews: [{id: digest, contentId: digest, mimeType: 'text/plain;charset=utf-8', size: 5, sha256: digest, truncated: true}],
}, itemId);
assert(remote.contents[0].delivery === 'on-demand', 'lazy content metadata must be preserved');
assert(remote.originDeviceIconKind === 'custom-os', 'remote icon identifiers must not be restricted to local assets');
assert(!Object.hasOwn(remote, 'originDeviceIconColor'),
  'the client must ignore origin device colors in synchronized items');

const page = changes({cursor: '18', hasMore: false, changes: [{sequence: 18, kind: 'upsert', itemId}]});
assert(page.nextCursor === '18' && page.changes[0].itemId === itemId,
  'change cursors and item events must validate');

const work = workPage({
  cursor: '7',
  hasMore: false,
  work: [{id: workId, type: 'materialize-content', itemId, contentId: digest}],
});
assert(work.work[0].contentId === digest, 'source-device work must identify immutable content');
assert(acceptedWork({uploadId, transfer: {...transferDocument, kind: 'content'}}, itemId, deviceId)
  .uploadId === uploadId, 'accepted work must open an authenticated upload session');
