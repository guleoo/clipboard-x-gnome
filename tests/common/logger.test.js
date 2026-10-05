import Gio from 'gi://Gio';
import {createLogger} from '../../src/common/logger.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const records = [];
const sourceRoot = import.meta.url.replace('tests/common/logger.test.js', 'src/');
let counter = 0;
let time = 100;
const logger = createLogger('sync', {
  sink: record => records.push(record),
  identifier: () => `operation-${++counter}`,
  now: () => '2026-10-05T00:00:00.000Z',
  monotonic: () => time,
});
const failure = new Error('CLIPBOARD_SECRET API_KEY_SECRET http://credential@server/path');
failure.code = 'server_unavailable';
failure.details = {text: 'CLIPBOARD_SECRET'};
failure.stack = `Error: CLIPBOARD_SECRET\nfn@${sourceRoot}sync/client.js:42:9\n` +
  'fn@http://API_KEY_SECRET@server/private:1:2\n' +
  'fn@https://server/sync/API_KEY_SECRET.js:42:9\nCLIPBOARD_SECRET';
failure.cause = new Error('API_KEY_SECRET');
failure.cause.cause = failure;
let thrown;
try {
  await logger.run('initialize', scope => scope.step('device', () => {
    time += 25;
    throw failure;
  }));
} catch (error) {
  thrown = error;
}
assert(thrown === failure, 'logging must rethrow the original error');
const failed = records.find(record => record.outcome === 'failed');
assert(failed.phase === 'device' && failed.durationMs === 25, 'failure phase and duration');
assert(failed.error.code === 'server_unavailable', 'known machine-readable error codes are preserved');
assert(failed.error.frames[0] === '/sync/client.js:42:9', 'only project-relative stack locations are retained');
assert(failed.causes.length === 1, 'cyclic causes must not grow the log record');
const count = records.length;
logger.error('notification', failure);
assert(records.length === count, 'propagating an already recorded failure must not duplicate it');

await logger.run('poll', scope => scope.step('changes', () => 5), {quiet: true});
assert(records.length === count, 'successful background polling must produce no log output');
try {
  await logger.run('retry', scope => scope.step('status', () => { throw failure; }), {quiet: true});
} catch (_) {}
assert(records.at(-1).phase === 'status' && records.at(-1).id !== failed.id,
  'a new operation must record a reused error object with its new context');
const unknown = {code: 'API_KEY_SECRET', constructor: {name: 'CLIPBOARD_SECRET'},
  message: 'CLIPBOARD_SECRET', stack: Array(100).fill(`x@${sourceRoot}sync/client.js:1:2`).join('\n')};
logger.error('protocol', unknown);
assert(records.at(-1).error.code === 'unknown' && records.at(-1).error.type === 'Error',
  'arbitrary server error codes/types must not be logged');
assert(records.at(-1).error.frames.length === 12, 'stack records must be bounded');
const serialized = JSON.stringify(records);
for (const secret of ['CLIPBOARD_SECRET', 'API_KEY_SECRET', 'PRIVATE_USER', 'credential@'])
  assert(!serialized.includes(secret), `diagnostics must not disclose ${secret}`);

let release;
const pending = new Promise(resolve => { release = resolve; });
const first = logger.run('first', scope => scope.step('waiting', () => pending));
const second = logger.run('second', scope => scope.step('finishing', () => 7));
await second;
release(8);
assert(await first === 8, 'successful values must be returned unchanged');
const firstRecords = records.filter(record => record.operation === 'first');
const secondRecords = records.filter(record => record.operation === 'second');
assert(new Set(firstRecords.map(record => record.id)).size === 1
  && firstRecords[0].id !== secondRecords[0].id, 'concurrent operations must keep independent IDs');

const cancel = Object.assign(new Error('PRIVATE_USER'), {
  matches: (_domain, code) => code === Gio.IOErrorEnum.CANCELLED,
});
try {
  await logger.run('download', () => { throw cancel; }, {quiet: true});
} catch (error) {
  assert(error === cancel, 'cancellation must retain its original identity');
}
assert(records.at(-1).level === 'info' && records.at(-1).outcome === 'cancelled',
  'cancellation is not an operational error');
const broken = createLogger('test', {sink: () => { throw new Error('sink broken'); }});
assert(await broken.run('value', () => 9) === 9, 'sink errors must not affect successful operations');
const original = new Error('original');
for (const field of ['stack', 'cause', 'code', 'constructor', 'matches'])
  Object.defineProperty(original, field, {get() { throw new Error('getter failed'); }});
try {
  await broken.run('failure', () => { throw original; });
} catch (error) {
  assert(error === original, 'sink errors must not replace application failures');
}
