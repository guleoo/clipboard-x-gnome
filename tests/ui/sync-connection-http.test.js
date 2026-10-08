import Soup from 'gi://Soup?version=3.0';
import System from 'system';

import {HttpTransport} from '../../src/sync/http/transport.js';
import {createConnectionActions} from '../../src/ui/settings/sync-connection.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

// Exercise native session creation/teardown in an isolated GJS process, never Shell.
const deviceId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';
const server = new Soup.Server();
let requests = 0;
let sessions = 0;
let closed = 0;
let failure = '';
const store = {current: {serverAddress: '', apiKey: '', activeChannelId: ''},
  save() { throw new Error('A connection probe must not save configuration'); }};
const snapshot = JSON.stringify(store.current);
server.add_handler(null, (_server, message, path) => {
  requests++;
  assert(message.get_request_headers().get_one('Authorization') === 'Bearer probe-key',
    'Every probe must authenticate with its unsaved API key');
  assert(message.get_request_headers().get_one('X-Clipboard-X-Device-Id') === deviceId,
    'Every probe must carry the device identity');
  const values = {
    '/api/v1/status': {apiVersion: 1, state: 'online', serverVersion: 'probe-fixture'},
    '/api/v1/channels': {channels: [{id: channelId, name: 'Probe channel'}]},
  };
  const failed = path === failure;
  message.set_status(failed ? 503 : 200, null);
  message.set_response('application/json', Soup.MemoryUse.COPY,
    JSON.stringify(failed ? {error: {code: 'temporarily_unavailable'}} : values[path]));
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const address = server.get_uris()[0].to_string();
const connection = createConnectionActions({
  store,
  notifyChanged() { throw new Error('A connection probe must not restart synchronization'); },
  now: () => Date.now(),
  createTransport(configuration) {
    sessions++;
    const transport = new HttpTransport(configuration, {deviceId});
    const abort = transport.abort.bind(transport);
    let aborted = false;
    transport.abort = () => {
      assert(!aborted, 'A temporary session must be released exactly once');
      aborted = true;
      closed++;
      abort();
    };
    return transport;
  },
});
const draft = {serverAddress: address, apiKey: 'probe-key', activeChannelId: ''};

try {
  for (let index = 0; index < 30; index++) {
    const result = await connection.test(draft);
    assert(result.status.status === 'online' && result.channels[0].active,
      `Repeated probe ${index + 1} must return valid status and channel selection`);
    assert(closed === sessions && JSON.stringify(store.current) === snapshot,
      'Each successful probe must release its sessions without altering saved configuration');
    // Include GC between successful probes to exercise native wrapper lifetimes.
    if (index % 3 === 2)
      System.gc();
  }
  assert(requests === 60, 'Thirty consecutive probes must perform exactly sixty read-only requests');
  for (const path of ['/api/v1/status', '/api/v1/channels']) {
    failure = path;
    let error;
    try { await connection.test(draft); }
    catch (caught) { error = caught; }
    assert(error?.status === 503 && closed === sessions,
      'Failed probes must release native sessions and preserve the server error');
    failure = '';
    const recovered = await connection.test(draft);
    assert(recovered.status.status === 'online', 'A probe must recover after a failed request');
    System.gc();
  }
  assert(JSON.stringify(store.current) === snapshot, 'Repeated probes must remain read-only');
  print('PASS repeated native HTTP connection probes, failure recovery, and session cleanup');
} finally {
  server.disconnect();
}
