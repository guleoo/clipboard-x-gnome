import {
  channel,
  configuration,
  configurationChanges,
  connectionResult,
  serverAddress,
} from '../../src/sync/configuration.js';

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

const channelId = '11111111-1111-4111-8111-111111111111';
assert(serverAddress(' 192.168.1.2:8765 ') === '192.168.1.2:8765',
  'server addresses may omit the scheme');
assert(serverAddress('http://127.0.0.1:8765') === 'http://127.0.0.1:8765',
  'HTTP server addresses must be accepted');
assert(serverAddress('https://clipboard.example.test/base') === 'https://clipboard.example.test/base',
  'HTTPS server addresses and reverse-proxy paths must be accepted');
assertRejects(() => serverAddress(''), 'empty server address must be rejected');
assertRejects(() => serverAddress('host\nAuthorization: secret'), 'control characters must be rejected');

const current = configuration({
  'server-address': '192.168.1.2:8765',
  'api-key-configured': true,
  'active-channel-id': channelId,
  'active-channel-name': '家庭',
});
assert(current.serverAddress === '192.168.1.2:8765' && current.apiKeyConfigured,
  'configuration must preserve the service-owned connection state');
assert(current.activeChannelId === channelId && current.activeChannelName === '家庭',
  'configuration must preserve the active channel');

const changes = configurationChanges({
  serverAddress: '[::1]:8765',
  apiKey: 'cbx_device_secret',
  activeChannelId: channelId,
});
assert(changes['server-address'] === '[::1]:8765'
    && changes['api-key'] === 'cbx_device_secret'
    && changes['active-channel-id'] === channelId,
  'configuration changes must serialize public field names to Sync1 fields');
assertRejects(() => configurationChanges({apiKey: ''}), 'empty replacement API keys must be rejected');
assertRejects(() => configurationChanges({activeChannelId: 'default'}), 'channel IDs must be UUIDs');

const availableChannel = channel({id: channelId, name: '家庭', active: true});
assert(availableChannel.active && availableChannel.name === '家庭', 'channel metadata must validate');
assertRejects(() => channel({id: channelId, name: '家庭'}), 'channel active state is required');

const result = connectionResult({
  state: 'online',
  'latency-ms': 12,
  'server-version': '0.1.0',
  message: 'Connected',
});
assert(result.state === 'online' && result.latencyMs === 12, 'connection results must validate');
assertRejects(() => connectionResult({state: 'connected', 'latency-ms': -1}),
  'invalid connection result state and latency must be rejected');
