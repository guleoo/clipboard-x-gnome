import {truncateUtf8} from '../../src/common/bytes.js';
import {EventEmitter} from '../../src/common/event-emitter.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const result = truncateUtf8('A👨‍👩‍👧‍👦B', 2);
assertEqual(result.text, 'A', 'truncation must preserve grapheme clusters');
assert(result.truncated, 'truncation flag');

const emitter = new EventEmitter();
let value = 0;
const id = emitter.connect('change', (_source, next) => value = next);
emitter.emit('change', 3);
assertEqual(value, 3, 'event emitter delivery');
emitter.disconnect(id);
emitter.emit('change', 4);
assertEqual(value, 3, 'event emitter disconnect');
