import {typingSequence} from '../../../src/clipboard/terminal/sequence.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const sequence = typingSequence("A中🙂\r\nB\rC\t'");
assert(sequence.length === 9, 'terminal typing must preserve every Unicode character and control character');
assert(sequence[0] === 'A', 'ASCII character is incorrect');
assert(sequence[1] === '中', 'CJK character is incorrect');
assert(sequence[2] === '🙂', 'non-BMP character is incorrect');
assert(sequence[3] === '\n' && sequence[5] === '\n',
  'line endings must be normalized to Return');
assert(sequence[7] === '\t', 'tab must remain a keyboard Tab');
assert(sequence[8] === "'", 'punctuation character is incorrect');

assert(typingSequence('').length === 0, 'empty text must not generate keyboard events');
