import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseDictionary, parseDictionaryAsync, serializeDictionary} from '../../../src/clipboard/tokenizer/dictionary/format.js';
import {
  DICTIONARY_LOCALES,
  DICTIONARY_REQUIRED_LOCALES,
  localeCandidates,
  normalizeLocale,
  requiresDictionary,
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
assert(requiresDictionary(['zh_CN.UTF-8', 'zh', 'C']),
  'Chinese display languages should expose dictionary settings');
assert(requiresDictionary(['ja_JP.UTF-8', 'ja', 'C']),
  'Japanese display languages should expose dictionary settings');
assert(!requiresDictionary(['ko_KR.UTF-8', 'ko', 'C'])
    && !requiresDictionary(['en_US.UTF-8', 'en', 'C']),
  'languages with reliable system word segmentation should hide dictionary settings');
assertEqual(selectLocale(['zh_CN.UTF-8', 'zh', 'C']), 'zh_cn',
  'dictionary language selection should default to the exact display locale');
assertEqual(selectLocale(['fr_CA.UTF-8', 'fr', 'C']), 'fr_fr',
  'dictionary language selection should use a supported regional variant');
assertEqual(selectLocale(['vi_VN.UTF-8', 'vi', 'C']), 'en',
  'unsupported display languages should fall back to English');
assert(DICTIONARY_LOCALES.includes('en') && DICTIONARY_LOCALES.includes('zh_cn'),
  'dictionary language choices should include source and translated locales');
assertEqual(
  DICTIONARY_LOCALES.filter(locale => DICTIONARY_REQUIRED_LOCALES.includes(locale.split('_')[0])),
  ['ja', 'zh_cn'],
  'dictionary settings should only offer languages that need an external dictionary',
);
assertEqual(parseEntries('注销 80\n# ignored\ninvalid-word 20').map(entry => entry.word), ['注销'],
  'dictionary entry parsing');

const parsed = parseDictionary([
  '# locale: ja',
  '# name: Japanese test',
  '# source: https://example.com/japanese.dict',
  '秘密鍵 90',
].join('\n'));
assertEqual(parseDictionary(serializeDictionary(parsed)), parsed, 'dictionary format round trip');
let parserYields = 0;
const largeDictionary = '# locale: zh\n# name: Batch test\n'
  + Array.from({length: 2048}, (_value, index) => `词条${index} ${index + 1}`).join('\n');
assertEqual(await parseDictionaryAsync(largeDictionary, {}, {
  checkpoint: () => new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    parserYields++;
    resolve();
    return GLib.SOURCE_REMOVE;
  })),
}), parseDictionary(largeDictionary), 'batched parsing must preserve all dictionary entries and metadata');
assert(parserYields === 4, 'large dictionaries must yield to the main loop between parsing batches');

const lexicon = new Lexicon(parseEntries('注销 80\n密钥 63'));
assertEqual(
  lexicon.segment('注销密钥', ['注', '销', '密', '钥']),
  ['注销', '密钥'],
  'dictionary words should override character-level ICU fallback',
);

const testRoot = Gio.File.new_for_path(GLib.dir_make_tmp('clipboard-x-gnome-dictionaries-XXXXXX'));
const storeRoot = testRoot.get_child('store');
const importSource = testRoot.get_child('custom-ja.txt');
const plainImportSource = testRoot.get_child('plain-words.txt');
const seed = testRoot.get_child('zh--test.dict');
GLib.file_set_contents(seed.get_path(), '# locale: zh\n# name: Test dictionary\n注销 80\n密钥 63\n');
const seedPath = seed.get_path();

try {
  const store = new DictionaryStore({rootPath: storeRoot.get_path(), seedPaths: [seedPath]});
  const initial = await store.list();
  assert(initial.length === 1 && initial[0].locale === 'zh' && initial[0].entryCount > 0,
    'pre-imported dictionary should use the regular user dictionary store');
  assert(store.getFile(initial[0].fileName).query_exists(null),
    'stored dictionaries should expose their editable file');

  const chineseTokenizer = new Tokenizer({
    store,
    languageNames: () => ['zh_CN.UTF-8', 'zh', 'C'],
  });
  assertEqual(
    (await chineseTokenizer.tokenize('注销 密钥')).map(token => token.text),
    ['注销', '密钥'],
    'display locale should activate the matching pre-imported dictionary',
  );
  const defaultLoad = await store.load(['zh_CN.UTF-8', 'zh', 'C']);
  assert(defaultLoad.systemEnabled && defaultLoad.lexicon.size > 0,
    'the default dictionary plan should enable the system tokenizer and matching files');
  const systemOnlyLoad = await store.load(['zh_CN.UTF-8', 'zh', 'C'], [SYSTEM_DICTIONARY_ID]);
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
    (await selectedTokenizer.tokenize('注销密钥', {dictionaryFiles: [secondChinese.fileName]}))
      .map(token => token.text),
    ['注销', '密', '钥'],
    'enabling selected dictionaries should load only those files',
  );
  assertEqual(
    (await selectedTokenizer.tokenize('注销密钥', {
      dictionaryFiles: [initial[0].fileName, secondChinese.fileName],
    })).map(token => token.text),
    ['注销', '密钥'],
    'multiple enabled dictionaries should be merged for the active language',
  );

  const systemTokenizer = new Tokenizer({
    store,
    languageNames: () => ['en_US.UTF-8', 'en', 'C'],
  });
  assertEqual(
    (await systemTokenizer.tokenize('注销 密钥')).map(token => token.text),
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
  assert(imported.locale === 'ja' && (await store.list()).length === 3,
    'import should preserve the dictionary-declared locale');
  const japaneseTokenizer = new Tokenizer({
    store,
    languageNames: () => ['ja_JP.UTF-8', 'ja', 'C'],
  });
  assertEqual(
    (await japaneseTokenizer.tokenize('秘密鍵画像編集')).map(token => token.text),
    ['秘密鍵', '画像編集'],
    'an imported dictionary should be selected by the display locale',
  );

  GLib.file_set_contents(plainImportSource.get_path(), '비밀키 70\n이미지편집 60\n');
  const plainImported = await store.importFile(plainImportSource, 'ko');
  assert(plainImported.locale === 'ko',
    'an imported dictionary without metadata should use the selected language code');

  await store.remove(secondChinese.fileName);
  await store.remove(imported.fileName);
  await store.remove(plainImported.fileName);
  assert((await store.list()).length === 1, 'imported dictionary removal');
  const seed = (await store.list())[0];
  await store.remove(seed.fileName);
  const reopened = new DictionaryStore({rootPath: storeRoot.get_path(), seedPaths: [seedPath]});
  assert((await reopened.list()).length === 0, 'a removed pre-imported dictionary should not be restored');

  GLib.file_set_contents(storeRoot.get_child('zh--large.dict').get_path(), largeDictionary);
  const cancellable = new Gio.Cancellable();
  const add = Lexicon.prototype.add;
  let batches = 0;
  Lexicon.prototype.add = function (entries) {
    if (entries.length > 0 && ++batches === 1)
      cancellable.cancel();
    return add.call(this, entries);
  };
  try {
    const result = await store.load(['zh'], [], cancellable)
      .then(() => null, error => error);
    assert(result?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
      'cancellation during index construction must propagate instead of returning a partial dictionary');
    assert(batches === 1, 'cancellation must stop subsequent index batches');
  } finally {
    Lexicon.prototype.add = add;
  }
  const recovered = await store.load(['zh']);
  assert(recovered.lexicon.size === 2048, 'cancelled loading must not prevent a later complete load');
} finally {
  removeTree(testRoot);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

const combined = {lexicon: new Lexicon(parseEntries('注销密钥 90')), systemEnabled: false};
const separate = {lexicon: new Lexicon(parseEntries('注销 90\n密钥 90')), systemEnabled: false};
const requests = [];
const concurrent = new Tokenizer({
  languageNames: () => ['zh'],
  store: {load: () => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  }},
});
try {
  const first = concurrent.tokenize('注销密钥');
  const shared = concurrent.tokenize('注销密钥');
  await Promise.resolve();
  assert(requests.length === 1, 'concurrent requests with the same dictionary plan must share loading');
  const newer = concurrent.tokenize('注销密钥', {revision: 1});
  await Promise.resolve();
  requests[1].resolve(separate);
  assertEqual((await newer).map(token => token.text), ['注销', '密钥'], 'new revision must use its own index');
  requests[0].resolve(combined);
  assertEqual((await first).map(token => token.text), ['注销密钥'], 'older consumers must retain their own index');
  await shared;
  assertEqual((await concurrent.tokenize('注销密钥', {revision: 1})).map(token => token.text),
    ['注销', '密钥'], 'late old loads must not overwrite the current cache');
  assert(requests.length === 2, 'cached requests must not reload dictionary files');

  const failed = concurrent.tokenize('注销密钥', {revision: 2}).then(() => null, error => error);
  await Promise.resolve();
  requests[2].reject(new Error('Controlled load failure'));
  assert(await failed, 'failed dictionary plans must reject');
  const retry = concurrent.tokenize('注销密钥', {revision: 2});
  await Promise.resolve();
  assert(requests.length === 4, 'failed loading must permit retry instead of caching rejection');
  requests[3].resolve(combined);
  await retry;

  const cancelled = concurrent.tokenize('注销密钥', {revision: 3}).then(() => null, error => error);
  await Promise.resolve();
  concurrent.destroy();
  requests[4].resolve(combined);
  assert((await cancelled)?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
    'destroyed tokenizers must discard pending results');
} finally {
  concurrent.destroy();
}
