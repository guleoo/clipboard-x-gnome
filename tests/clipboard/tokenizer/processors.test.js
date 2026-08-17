import {
  composeTokens,
  processText,
  TextProcessors,
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

assertEqual(processText('lines', ' a\n\n b '), ['a', 'b'], 'line processor');
assertEqual(processText('identifiers', 'clipboardSync_device-id'),
  ['clipboard', 'Sync', 'device', 'id'], 'identifier processor');
assertEqual(processText('urls', 'see https://example.com/a and https://example.com/a'),
  ['https://example.com/a'], 'URL processor should deduplicate');
const words = processText('words', '中文分词 works');
assert(words.includes('works') && words.some(word => word !== 'works'),
  'word processor should segment mixed text without assuming a specific ICU dictionary');
assertEqual(processText('graphemes', 'A 👨‍👩‍👧‍👦 中'), ['A', '👨‍👩‍👧‍👦', '中'],
  'grapheme processor must preserve joined emoji and omit whitespace');
assertEqual(processText('uppercase', 'Clipboard 中文'), ['CLIPBOARD 中文'], 'uppercase transformation');
assertEqual(processText('lowercase', 'Clipboard 中文'), ['clipboard 中文'], 'lowercase transformation');
assertEqual(processText('title-case', 'clipboard_x SYNC'), ['Clipboard_x Sync'], 'title-case transformation');
TextProcessors.register('brackets', text => text.match(/\[[^\]]+\]/gu) ?? []);
assertEqual(processText('brackets', 'a [one] [二]'), ['[one]', '[二]'],
  'custom text processor registration');

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
