import Gio from 'gi://Gio';

import {bytesFromString} from '../../src/common/bytes.js';
import {HttpClient, HttpError} from '../../src/sync/http/client.js';
import {HttpTransport} from '../../src/sync/http/transport.js';
import {message as syncErrorMessage} from '../../src/sync/errors.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const authenticatedClient = new HttpClient({
  serverAddress: 'https://example.test/cbx',
  apiKey: 'device-secret',
  deviceId: '11111111-1111-4111-8111-111111111111',
  session: {abort() {}},
});
const authenticatedMessage = authenticatedClient._message('GET', '/api/v1/status', null);
assert(authenticatedMessage.request_headers.get_one('Authorization') === 'Bearer device-secret'
    && authenticatedMessage.request_headers.get_one('X-Clipboard-X-Device-Id')
      === '11111111-1111-4111-8111-111111111111',
  'every API request must carry the device API key and DeviceId headers');
assert(authenticatedMessage.get_uri().to_string().startsWith('https://example.test/cbx/api/v1/'),
  'API routes must be resolved below the configured reverse-proxy base path');

const failedSession = {
  send_async() { return Promise.reject(new Error('Could not connect to 127.0.0.1')); },
  abort() {},
};
const disconnected = new HttpClient({
  serverAddress: 'http://127.0.0.1:8765',
  apiKey: 'key',
  deviceId: 'device',
  session: failedSession,
});
for (const send of [
  () => disconnected.request('GET', '/api/v1/status'),
  () => disconnected.bytes('/image', {maximumBytes: 1024}),
  () => disconnected.download('/image', '/tmp/unused', {maximumBytes: 1024, expectedBytes: 10}),
  () => disconnected.upload('/image', {
    stream: Gio.MemoryInputStream.new_from_bytes(bytesFromString('test')),
    size: 4,
    mimeType: 'image/png',
  }),
]) {
  try {
    await send();
    throw new Error('A disconnected server must reject the request');
  } catch (error) {
    assert(error instanceof HttpError && error.code === 'server_unavailable'
        && error.message.includes('Could not connect'),
      'transport failures must keep their diagnostic but expose a stable localization code');
    assert(syncErrorMessage(error, text => text === 'Synchronization server is unavailable'
      ? '同步服务器不可用' : text) === '同步服务器不可用',
    'transport failures must use the localized unavailable-server message');
  }
}

const cancelled = new Gio.Cancellable();
cancelled.cancel();
const cancellation = {
  message: 'Operation cancelled',
  matches: (_domain, code) => code === Gio.IOErrorEnum.CANCELLED,
};
const cancelledClient = new HttpClient({
  serverAddress: 'http://127.0.0.1:8765',
  apiKey: 'key',
  deviceId: 'device',
  session: {send_async() { return Promise.reject(cancellation); }, abort() {}},
});
try {
  await cancelledClient.request('GET', '/api/v1/status', {cancellable: cancelled});
  throw new Error('Cancellation must reject the request');
} catch (error) {
  assert(error === cancellation, 'Cancelled requests must not report the server as unavailable');
}

const calls = [];
const lowLevelClient = {
  request(method, path, options = {}) {
    calls.push({method, path, options});
    return Promise.resolve({});
  },
  bytes() {},
  download() {},
  upload() {},
  abort() {},
};
const transport = new HttpTransport({}, {deviceId: 'unused', client: lowLevelClient});
await transport.changes('channel/with/slash', 'cursor value', 42);
assert(calls[0].method === 'GET'
    && calls[0].path === '/api/v1/channels/channel%2Fwith%2Fslash/changes'
    && calls[0].options.query.cursor === 'cursor value'
    && calls[0].options.query.limit === 42,
  'transport must encode path segments and keep query values separate');
await transport.rejectWork('work-id', 'source_content_missing', 'gone');
assert(calls[1].method === 'POST' && calls[1].options.json.code === 'source_content_missing',
  'work rejection must use a structured JSON error');
