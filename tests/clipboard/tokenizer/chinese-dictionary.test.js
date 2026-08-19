import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {ChineseDictionary} from '../../../src/clipboard/tokenizer/chinese-dictionary.js';
import {ChineseTokenizer, CHINESE_DICTIONARY_MODE} from '../../../src/clipboard/tokenizer/chinese-tokenizer.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const dictionaryText = [
  '注销 80',
  '密钥 63',
  '剪切板 500',
  '同步 400',
].join('\n');
const dictionary = new ChineseDictionary(dictionaryText);

assertEqual(
  dictionary.segment('注销密钥', ['注', '销', '密', '钥']),
  ['注销', '密钥'],
  'dictionary words should override character-level ICU fallback',
);
assertEqual(
  dictionary.segment('自定义词', ['自', '定', '义', '词'], ['自定义词']),
  ['自定义词'],
  'custom words should take priority',
);
assertEqual(
  new ChineseDictionary().segment('中华人民', ['中华', '人民']),
  ['中华', '人民'],
  'an empty dictionary should preserve the ICU fallback',
);

const tokenizer = new ChineseTokenizer({dictionaryText});
assertEqual(
  tokenizer.tokenize('注销 密钥').map(token => token.text),
  ['注销', '密钥'],
  'Chinese tokenizer should apply the built-in dictionary to Han runs',
);
assertEqual(
  tokenizer.tokenize('插件词库', {
    mode: CHINESE_DICTIONARY_MODE.SYSTEM,
    customWords: ['插件词库'],
  }).map(token => token.text),
  ['插件词库'],
  'custom words should remain active when the built-in dictionary is disabled',
);

const dictionaryPath = Gio.File.new_for_uri(import.meta.url)
  .get_parent()
  .resolve_relative_path('../../../src/clipboard/tokenizer/dictionaries/chinese-core.txt')
  .get_path();
const runtimeTokenizer = new ChineseTokenizer({dictionaryPath});
const coldStarted = GLib.get_monotonic_time();
assertEqual(
  runtimeTokenizer.tokenize('注销 密钥').map(token => token.text),
  ['注销', '密钥'],
  'the packaged dictionary should contain the reported regression words',
);
const coldMilliseconds = (GLib.get_monotonic_time() - coldStarted) / 1000;
assert(coldMilliseconds < 250,
  `cold dictionary loading and tokenization took ${coldMilliseconds.toFixed(1)} ms`);

const repeatedText = '剪切板同步需要保持稳定且不阻塞桌面界面。';
const started = GLib.get_monotonic_time();
for (let index = 0; index < 1000; index++)
  runtimeTokenizer.tokenize(repeatedText);
const elapsedMilliseconds = (GLib.get_monotonic_time() - started) / 1000;
assert(elapsedMilliseconds < 1500,
  `1000 short Chinese tokenizations took ${elapsedMilliseconds.toFixed(1)} ms`);
