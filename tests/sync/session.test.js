import {
  heartbeatMilliseconds,
  leaseMilliseconds,
  validate,
} from '../../src/sync/session.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const sessionId = '11111111-1111-4111-8111-111111111111';

assert(leaseMilliseconds(15) === 15_000,
  'the default lease must be represented as fifteen seconds');
assert(leaseMilliseconds(0) === 15_000,
  'missing settings must fall back to the default lease');
assert(leaseMilliseconds(1) === 5_000 && leaseMilliseconds(1000) === 300_000,
  'configured leases must stay within the supported range');
assert(heartbeatMilliseconds(15_000) === 5_000,
  'a fifteen second lease must send a heartbeat every five seconds');

const session = validate({
  'session-id': sessionId,
  'lease-ms': 15_000,
  'expires-at': Date.now() + 15_000,
});
assert(session.id === sessionId && session.leaseMs === 15_000,
  'valid session metadata must be normalized');

let rejected = false;
try {
  validate({'session-id': 'invalid', 'lease-ms': 15_000, 'expires-at': 1});
} catch (_error) {
  rejected = true;
}
assert(rejected, 'invalid session metadata must be rejected');
