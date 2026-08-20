import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseDictionary, serializeDictionary} from '../../../src/clipboard/tokenizer/dictionary/format.js';
import {
  DICTIONARY_LOCALES,
  localeCandidates,
  normalizeLocale,
  selectLocale,
  SYSTEM_DICTIONARY_ID,
} from '../../../src/clipboard/tokenizer/dictionary/locale.js';
import {Lexicon, parseEntries} from '../../../src/clipboard/tokenizer/dictionary/lexicon.js';
import {DictionaryStore} from '../../../src/clipboard/tokenizer/dictionary/store.js';
import {tokenizeText} from '../../../src/clipboard/tokenizer/processors.js';
import {Tokenizer} from '../../../src/clipboard/tokenizer/tokenizer.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function removeTree(file) {
  if (!file.query_exists(null))
    return;
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
    const enumerator = file.enumerate_children(
      Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
    let info;
    while ((info = enumerator.next_file(null)))
      removeTree(file.get_child(info.get_name()));
    enumerator.close(null);
  }
  file.delete(null);
}

assertEqual(normalizeLocale('pt-BR.UTF-8'), 'pt_br', 'locale normalization');
assertEqual(localeCandidates(['zh_CN.UTF-8', 'zh', 'C']), ['zh_cn', 'zh'], 'locale fallback order');
assertEqual(localeCandidates(['fr_FR.UTF-8', 'de_DE']), ['fr_fr', 'fr'],
  'only the active display language should select dictionaries');
assertEqual(selectLocale(['zh_CN.UTF-8', 'zh', 'C']), 'zh_cn',
  'dictionary language selection should default to the exact display locale');
assertEqual(selectLocale(['fr_CA.UTF-8', 'fr', 'C']), 'fr_fr',
  'dictionary language selection should use a supported regional variant');
assertEqual(selectLocale(['vi_VN.UTF-8', 'vi', 'C']), 'en',
  'unsupported display languages should fall back to English');
assert(DICTIONARY_LOCALES.includes('en') && DICTIONARY_LOCALES.includes('zh_cn'),
  'dictionary language choices should include source and translated locales');
assertEqual(parseEntries('注销 80\n# ignored\ninvalid-word 20').map(entry => entry.word), ['注销'],
  'dictionary entry parsing');

const parsed = parseDictionary([
  '# locale: ja',
  '# name: Japanese test',
  '秘密鍵 90',
].join('\n'));
assertEqual(parseDictionary(serializeDictionary(parsed)), parsed, 'dictionary format round trip');

const lexicon = new Lexicon(parseEntries('注销 80\n密钥 63'));
assertEqual(
  lexicon.segment('注销密钥', ['注', '销', '密', '钥']),
  ['注销', '密钥'],
  'dictionary words should override character-level ICU fallback',
);

const testRoot = Gio.File.new_for_path(GLib.dir_make_tmp('clipboard-x-dictionaries-XXXXXX'));
const storeRoot = testRoot.get_child('store');
const importSource = testRoot.get_child('custom-ja.txt');
const plainImportSource = testRoot.get_child('plain-words.txt');
const seedPath = Gio.File.new_for_uri(import.meta.url)
  .get_parent()
  .resolve_relative_path('../../../src/clipboard/tokenizer/dictionary/seeds/zh--cppjieba-core.dict')
  .get_path();

try {
  const store = new DictionaryStore({rootPath: storeRoot.get_path(), seedPaths: [seedPath]});
  const initial = store.list();
  assert(initial.length === 1 && initial[0].locale === 'zh' && initial[0].entryCount === 45967,
    'pre-imported dictionary should use the regular user dictionary store');
  assert(store.getFile(initial[0].fileName).query_exists(null),
    'stored dictionaries should expose their editable file');

  const chineseTokenizer = new Tokenizer({
    store,
    languageNames: () => ['zh_CN.UTF-8', 'zh', 'C'],
  });
  assertEqual(
    chineseTokenizer.tokenize('注销 密钥').map(token => token.text),
    ['注销', '密钥'],
    'display locale should activate the matching pre-imported dictionary',
  );
  const defaultLoad = store.load(['zh_CN.UTF-8', 'zh', 'C']);
  assert(defaultLoad.systemEnabled && defaultLoad.lexicon.size > 0,
    'the default dictionary plan should enable the system tokenizer and matching files');
  const systemOnlyLoad = store.load(['zh_CN.UTF-8', 'zh', 'C'], [SYSTEM_DICTIONARY_ID]);
  assert(systemOnlyLoad.systemEnabled && systemOnlyLoad.lexicon.size === 0,
    'the system tokenizer should be selectable without loading user dictionaries');
  GLib.file_set_contents(importSource.get_path(), [
    '# locale: zh',
    '# name: User Chinese dictionary',
    '注销 100',
  ].join('\n'));
  const secondChinese = await store.importFile(importSource, 'zh');
  const selectedTokenizer = new Tokenizer({
    store,
    languageNames: () => ['zh_CN.UTF-8', 'zh', 'C'],
  });
  assertEqual(
    selectedTokenizer.tokenize('注销密钥', {dictionaryFiles: [secondChinese.fileName]})
      .map(token => token.text),
    ['注销', '密', '钥'],
    'enabling selected dictionaries should load only those files',
  );
  assertEqual(
    selectedTokenizer.tokenize('注销密钥', {
      dictionaryFiles: [initial[0].fileName, secondChinese.fileName],
    }).map(token => token.text),
    ['注销', '密钥'],
    'multiple enabled dictionaries should be merged for the active language',
  );

  const systemTokenizer = new Tokenizer({
    store,
    languageNames: () => ['en_US.UTF-8', 'en', 'C'],
  });
  assertEqual(
    systemTokenizer.tokenize('注销 密钥').map(token => token.text),
    tokenizeText('注销 密钥').map(token => token.text),
    'a missing display-language dictionary should fall back to the system tokenizer',
  );

  GLib.file_set_contents(importSource.get_path(), [
    '# locale: ja',
    '# name: User Japanese dictionary',
    '秘密鍵 90',
    '画像編集 80',
  ].join('\n'));
  const imported = await store.importFile(importSource, 'en');
  assert(imported.locale === 'ja' && store.list().length === 3,
    'import should preserve the dictionary-declared locale');
  const japaneseTokenizer = new Tokenizer({
    store,
    languageNames: () => ['ja_JP.UTF-8', 'ja', 'C'],
  });
  assertEqual(
    japaneseTokenizer.tokenize('秘密鍵画像編集').map(token => token.text),
    ['秘密鍵', '画像編集'],
    'an imported dictionary should be selected by the display locale',
  );

  GLib.file_set_contents(plainImportSource.get_path(), '비밀키 70\n이미지편집 60\n');
  const plainImported = await store.importFile(plainImportSource, 'ko');
  assert(plainImported.locale === 'ko',
    'an imported dictionary without metadata should use the selected language code');

  store.remove(secondChinese.fileName);
  store.remove(imported.fileName);
  store.remove(plainImported.fileName);
  assert(store.list().length === 1, 'imported dictionary removal');
  const seed = store.list()[0];
  store.remove(seed.fileName);
  const reopened = new DictionaryStore({rootPath: storeRoot.get_path(), seedPaths: [seedPath]});
  assert(reopened.list().length === 0, 'a removed pre-imported dictionary should not be restored');

  const performanceStore = new DictionaryStore({
    rootPath: testRoot.get_child('performance-store').get_path(),
    seedPaths: [seedPath],
  });
  const performanceTokenizer = new Tokenizer({
    store: performanceStore,
    languageNames: () => ['zh_CN.UTF-8', 'zh'],
  });
  const started = GLib.get_monotonic_time();
  for (let index = 0; index < 1000; index++)
    performanceTokenizer.tokenize('剪切板同步需要保持稳定且不阻塞桌面界面。');
  const elapsedMilliseconds = (GLib.get_monotonic_time() - started) / 1000;
  assert(elapsedMilliseconds < 1500,
    `1000 dictionary tokenizations took ${elapsedMilliseconds.toFixed(1)} ms`);
} finally {
  removeTree(testRoot);
}
