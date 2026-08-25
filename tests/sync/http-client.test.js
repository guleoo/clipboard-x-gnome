import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {bytesFromString, sha256, stringFromBytes} from '../../src/common/bytes.js';
import {HttpClient, normalizeServerAddress} from '../../src/sync/http/client.js';
import {HttpTransport} from '../../src/sync/http/transport.js';

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

assert(normalizeServerAddress('127.0.0.1:8765/') === 'http://127.0.0.1:8765',
  'plain host and port must default to HTTP');
assert(normalizeServerAddress('https://example.test/cbx/') === 'https://example.test/cbx',
  'reverse-proxy base paths must be preserved');
assertRejects(() => normalizeServerAddress('https://user:secret@example.test'),
  'credentials must not be embedded in the server URL');
assertRejects(() => normalizeServerAddress('https://example.test/?token=secret'),
  'configuration URLs must not contain queries');

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

const payload = bytesFromString('streamed synchronization content');
const session = {
  send_async() {
    return Promise.resolve(Gio.MemoryInputStream.new_from_bytes(payload));
  },
  abort() {},
};
class DownloadClient extends HttpClient {
  _message() {
    return {
      status_code: 200,
      request_headers: {append() {}, replace() {}},
      response_headers: {get_content_length: () => payload.get_size()},
    };
  }
}

const directory = GLib.dir_make_tmp('clipboard-x-http-client-test-XXXXXX');
const targetPath = GLib.build_filenamev([directory, 'object']);
try {
  const downloadClient = new DownloadClient({
    serverAddress: 'http://example.test',
    apiKey: 'key',
    deviceId: 'device',
    session,
  });
  const progress = [];
  const result = await downloadClient.download('/content', targetPath, {
    maximumBytes: 1024,
    expectedBytes: payload.get_size(),
    expectedSha256: sha256(payload),
    onProgress: bytes => progress.push(bytes),
  });
  const restored = Gio.File.new_for_path(targetPath).load_bytes(null)[0];
  assert(result.size === payload.get_size()
      && stringFromBytes(restored) === 'streamed synchronization content',
    'download must stream to a verified local object');
  assert(progress.at(-1) === payload.get_size(),
    'download progress must finish at the exact logical byte count');
} finally {
  try {
    Gio.File.new_for_path(targetPath).delete(null);
  } catch (_error) {
    // The test may fail before moving the verified temporary object.
  }
  Gio.File.new_for_path(directory).delete(null);
}
