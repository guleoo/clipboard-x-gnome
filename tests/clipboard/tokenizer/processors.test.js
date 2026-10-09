import {
  composeTokens,
  tokenizeText,
} from '../../../src/clipboard/tokenizer/processors.js';

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
