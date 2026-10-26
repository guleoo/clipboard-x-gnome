import {
  composeTokens,
  tokenizeText,
} from '../../../../src/clipboard/tokenizer/processors.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const source = '打开 https://example.com/a，订单号 123-456 works';
const tokens = tokenizeText(source);
assertEqual(tokenizeText("I can't do that.").map(token => token.text),
  ['I', "can't", 'do', 'that', '.'],
  'tokenizer should segment the reported English sentence without dropping punctuation');
assert(tokens.some(token => token.type === 'url' && token.text === 'https://example.com/a'),
  'tokenizer must keep a URL as one token');
assert(tokens.some(token => token.type === 'number' && token.text === '123-456'),
  'tokenizer must keep a structured number as one token');
const url = tokens.find(token => token.type === 'url');
const number = tokens.find(token => token.type === 'number');
assertEqual(composeTokens(source, tokens, [url.index, number.index]),
  'https://example.com/a 123-456', 'non-adjacent selected tokens should compose predictably');

const overlapping = 'https://example.com/123/user@example.com 42 user7@example.com 43';
const specialTokens = tokenizeText(overlapping);
assertEqual(specialTokens.map(token => [token.type, token.text]), [
  ['url', 'https://example.com/123/user@example.com'],
  ['number', '42'],
  ['email', 'user7@example.com'],
  ['number', '43'],
], 'Nested URL, email and number candidates must retain the same longest-interval selection');
assert(specialTokens.every((token, index) => overlapping.slice(token.start, token.end) === token.text
    && (index === 0 || specialTokens[index - 1].end <= token.start)),
  'Accepted special tokens must retain exact offsets and never overlap');

const numericList = Array.from({length: 4096}, (_value, index) => String(index)).join(' ');
const numericTokens = tokenizeText(numericList);
assert(numericTokens.length === 4096 && numericTokens.every((token, index) =>
  token.type === 'number' && token.text === String(index)
    && numericList.slice(token.start, token.end) === token.text),
'Dense numeric lists must retain every token, in order, with exact source offsets');

function assertWordLimit(operation) {
  try {
    operation();
  } catch (error) {
    assert(error.code === 'word_limit_exceeded', `Unexpected word limit error: ${error.message}`);
    return;
  }
  throw new Error('Exceeding the word limit must fail instead of returning a partial result');
}

for (const text of ['one two three', '1 2 3', 'one, two!', '✅ 🔥 ⭐']) {
  const complete = tokenizeText(text);
  assertEqual(tokenizeText(text, {maximumTokens: complete.length}), complete,
    'A result exactly at the limit must retain all words, punctuation, symbols and offsets');
  assertWordLimit(() => tokenizeText(text, {maximumTokens: complete.length - 1}));
}
assertEqual(tokenizeText('', {maximumTokens: 1}), [], 'Empty text remains valid under the word limit');
assertEqual(tokenizeText('https://example.com/123/user@example.com', {maximumTokens: 1})
  .map(token => token.text), ['https://example.com/123/user@example.com'],
  'Only accepted tokens count toward the limit, not nested email and number candidates');
let segmentedRuns = 0;
assertWordLimit(() => tokenizeText('alpha beta gamma delta epsilon', {
  maximumTokens: 2,
  segmentWordRun: word => { segmentedRuns++; return [word]; },
}));
assert(segmentedRuns === 3, 'Processing must stop at the first excess token, not segment the remaining text');

// The default threshold matrix belongs to the processor. Native acceptance
// checks one small configured boundary; WORD-07 owns actual 2,000-button layout.
for (const count of [1999, 2000, 2001]) {
  const source = Array.from({length: count}, (_value, index) => 'word' + index).join(' ');
  if (count <= 2000) {
    const result = tokenizeText(source, {maximumTokens: 2000});
    assert(result.length === count && result.every((word, index) => word.text === 'word' + index),
      'Default-limit processing must retain every word up to and including 2000');
  } else {
    assertWordLimit(() => tokenizeText(source, {maximumTokens: 2000}));
  }
}
