import {apiKey, configuration, serverAddress} from '../../src/sync/configuration.js';

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
assertRejects(() => serverAddress('ftp://clipboard.example.test'), 'non-HTTP schemes must be rejected');
assertRejects(() => serverAddress('host\nAuthorization: secret'), 'control characters must be rejected');

assert(apiKey(' cbx_device_secret ') === 'cbx_device_secret', 'API keys must be trimmed');
assertRejects(() => apiKey(''), 'empty API keys must be rejected by default');
assert(apiKey('', {allowEmpty: true}) === '', 'settings storage may represent an empty API key');

const current = configuration({
  serverAddress: '192.168.1.2:8765',
  apiKey: 'cbx_device_secret',
  activeChannelId: channelId,
}, '家庭');
assert(current.serverAddress === '192.168.1.2:8765' && current.apiKeyConfigured,
  'public configuration must hide the API key while reporting whether it exists');
assert(current.activeChannelId === channelId && current.activeChannelName === '家庭',
  'public configuration must preserve the active channel');
assert(!Object.hasOwn(current, 'apiKey'), 'public configuration must never expose the API key');
assertRejects(() => configuration({activeChannelId: 'default'}), 'channel IDs must be UUIDs');
