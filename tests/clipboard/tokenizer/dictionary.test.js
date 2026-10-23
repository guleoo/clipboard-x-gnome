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

async function waitUntil(predicate) {
  const deadline = GLib.get_monotonic_time() + 3_000_000;
  while (!predicate()) {
    assert(GLib.get_monotonic_time() < deadline, 'Dictionary file change was not observed');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
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
const chineseSource = testRoot.get_child('zh--test.dict');
GLib.file_set_contents(chineseSource.get_path(), '# locale: zh\n# name: Test dictionary\n注销 80\n密钥 63\n');
const tokenizers = [];
const createTokenizer = options => {
  const tokenizer = new Tokenizer(options);
  tokenizers.push(tokenizer);
  return tokenizer;
};

try {
  const store = new DictionaryStore({rootPath: storeRoot.get_path()});
  assert((await store.list()).length === 0,
    'a new dictionary store must remain empty until a user imports a dictionary');
  const emptyLoad = await store.load(['zh']);
  assert(emptyLoad.systemEnabled && emptyLoad.lexicon.size === 0,
    'a fresh store should use system segmentation without installing dictionaries');
  const emptyDirectory = storeRoot.enumerate_children(
    Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, null,
  );
  try {
    assert(emptyDirectory.next_file(null) === null,
      'listing and loading an empty store must not create bookkeeping files');
  } finally {
    emptyDirectory.close(null);
  }
  await store.importFile(chineseSource);
  const initial = await store.list();
  assert(initial.length === 1 && initial[0].locale === 'zh' && initial[0].entryCount > 0,
    'explicit import should add the dictionary to the user dictionary store');
  assert(store.getFile(initial[0].fileName).query_exists(null),
    'stored dictionaries should expose their editable file');

  GLib.file_set_contents(store.getFile(initial[0].fileName).get_path(),
    '# locale: ja\n# name: Edited dictionary\n注销 80\n密钥 63\n');
  const edited = (await store.list())[0];
  assert(edited.locale === 'zh' && edited.name === 'Edited dictionary',
    'editing metadata must preserve the imported language while updating the display name');
  for (const selection of [[], [edited.fileName]]) {
    assert((await store.load(['zh_CN.UTF-8'], selection)).lexicon.size === 2,
      'edited dictionaries must still load for their imported language');
    assert((await store.load(['ja_JP.UTF-8'], selection)).lexicon.size === 0,
      'an edited locale header must not activate a dictionary for a different language');
  }

  const chineseTokenizer = createTokenizer({
    store,
    languageNames: () => ['zh_CN.UTF-8', 'zh', 'C'],
  });
  assertEqual(
    (await chineseTokenizer.tokenize('注销 密钥')).map(token => token.text),
    ['注销', '密钥'],
    'display locale should activate the matching imported dictionary',
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
  const secondChinese = await store.importFile(importSource);
  const selectedTokenizer = createTokenizer({
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

  const systemTokenizer = createTokenizer({
    store,
    languageNames: () => ['en_US.UTF-8', 'en', 'C'],
  });
  assertEqual(
    (await systemTokenizer.tokenize('注销 密钥')).map(token => token.text),
    tokenizeText('注销 密钥').map(token => token.text),
    'a missing display-language dictionary should fall back to the system tokenizer',
  );
  const systemLimit = await systemTokenizer.tokenize('one two', {maximumTokens: 1})
    .then(() => null, error => error);
  assert(systemLimit?.code === 'word_limit_exceeded', 'System segmentation must enforce the word limit');

  GLib.file_set_contents(importSource.get_path(), [
    '# locale: ja',
    '# name: User Japanese dictionary',
    '秘密鍵 90',
    '画像編集 80',
  ].join('\n'));
  const imported = await store.importFile(importSource);
  assert(imported.locale === 'ja' && (await store.list()).length === 3,
    'import should use the dictionary-declared locale');
  const japaneseTokenizer = createTokenizer({
    store,
    languageNames: () => ['ja_JP.UTF-8', 'ja', 'C'],
  });
  assertEqual(
    (await japaneseTokenizer.tokenize('秘密鍵画像編集')).map(token => token.text),
    ['秘密鍵', '画像編集'],
    'an imported dictionary should be selected by the display locale',
  );

  GLib.file_set_contents(plainImportSource.get_path(), '# locale: ko\n비밀키 70\n이미지편집 60\n');
  const plainImported = await store.importFile(plainImportSource);
  assert(plainImported.locale === 'ko',
    'a dictionary only needs a locale header; its name may come from the filename');

  const languageStore = new DictionaryStore({rootPath: testRoot.get_child('declared-language').get_path()});
  for (const name of ['foo.txt', 'my-words.txt', 'ja.dict']) {
    const file = testRoot.get_child(name);
    for (const header of ['', '# locale: \n', '# locale: invalid-language-code!\n']) {
      GLib.file_set_contents(file.get_path(), `${header}注销密钥 90\n`);
      let rejected = false;
      try {
        await languageStore.importFile(file);
      } catch (error) {
        rejected = error.code === 'invalid_dictionary_locale';
      }
      assert(rejected && (await languageStore.list()).length === 0,
        `${name} without a valid locale header must fail without creating a dictionary`);
    }
  }

  // Replace only remote byte acquisition with an isolated local file. Exercise
  // refreshSource's real URL metadata, naming, persistence, and language rules.
  const networkSource = testRoot.get_child('network-response.txt');
  const networkUri = 'https://example.com/my-words.txt';
  const fromUri = Gio.File.new_for_uri;
  Gio.File.new_for_uri = uri => {
    assert(uri === networkUri, 'Only the controlled dictionary URL may be requested');
    return networkSource;
  };
  try {
    GLib.file_set_contents(networkSource.get_path(), '注销密钥 90\n');
    let rejected = false;
    try {
      await languageStore.refreshSource(networkUri);
    } catch (error) {
      rejected = error.code === 'invalid_dictionary_locale';
    }
    assert(rejected && (await languageStore.list()).length === 0,
      'A headerless network dictionary must fail without creating a dictionary');
    GLib.file_set_contents(networkSource.get_path(), '# locale: ja\n秘密鍵 90\n');
    const network = await languageStore.refreshSource(networkUri);
    assert(network.locale === 'ja' && network.fileName.startsWith('ja--')
        && network.source === networkUri
        && (await languageStore.load(['ja'], [network.fileName])).lexicon.size === 1,
      'A network dictionary must use its declared language');
    for (const header of ['', '# locale: \n', '# locale: invalid-language-code!\n']) {
      GLib.file_set_contents(networkSource.get_path(), `${header}注销密钥 90\n`);
      rejected = false;
      try {
        await languageStore.refreshSource(networkUri);
      } catch (error) {
        rejected = error.code === 'invalid_dictionary_locale';
      }
      const kept = await languageStore.list();
      assert(rejected && kept.length === 1 && kept[0].fileName === network.fileName
          && (await languageStore.load(['ja'], [network.fileName])).lexicon.segment('秘密鍵').join('|') === '秘密鍵',
        'A failed refresh must preserve the previously imported dictionary and its content');
    }
    GLib.file_set_contents(networkSource.get_path(), '# locale: zh\n注销密钥 90\n');
    const blockedTarget = languageStore.getFile(network.fileName.replace(/^ja--/u, 'zh--'));
    blockedTarget.make_directory(null);
    let writeError;
    try {
      await languageStore.refreshSource(networkUri);
    } catch (error) {
      writeError = error;
    }
    assert(writeError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.IS_DIRECTORY)
        && languageStore.getFile(network.fileName).query_exists(null)
        && (await languageStore.load(['ja'], [network.fileName])).lexicon.segment('秘密鍵').join('|') === '秘密鍵',
      'A failed replacement write must preserve the old-language dictionary and its original words');
    blockedTarget.delete(null);
    const declared = await languageStore.refreshSource(networkUri);
    const listed = await languageStore.list();
    assert(declared.locale === 'zh' && declared.fileName.startsWith('zh--')
        && !languageStore.getFile(network.fileName).query_exists(null)
        && listed.filter(dictionary => dictionary.source === networkUri).length === 1,
      'A changed network locale header must replace the old-language file');
  } finally {
    Gio.File.new_for_uri = fromUri;
  }

  await store.remove(secondChinese.fileName);
  await store.remove(imported.fileName);
  await store.remove(plainImported.fileName);
  assert((await store.list()).length === 1, 'imported dictionary removal');
  await store.remove(initial[0].fileName);
  const reopened = new DictionaryStore({rootPath: storeRoot.get_path()});
  assert((await reopened.list()).length === 0, 'a removed dictionary should not be restored on reopening');

  const largeSource = testRoot.get_child('large-zh.txt');
  GLib.file_set_contents(largeSource.get_path(), largeDictionary);
  await store.importFile(largeSource);
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

  const watchedStore = new DictionaryStore({rootPath: testRoot.get_child('watched').get_path()});
  const watchedFile = watchedStore.getFile('zh--editable.dict');
  await watchedStore.list();
  const together = '# locale: zh\n注销密钥 90\n';
  const apart = '# locale: ja\n注销 90\n密钥 90\n';
  GLib.file_set_contents(watchedFile.get_path(), together);
  let changes = 0;
  let stops = 0;
  let loads = 0;
  let heldLoad = null;
  const watch = watchedStore.watch.bind(watchedStore);
  watchedStore.watch = async (changed, cancellable) => {
    const stop = await watch(() => { changes++; changed(); }, cancellable);
    return () => { stops++; stop(); };
  };
  const load = watchedStore.load.bind(watchedStore);
  watchedStore.load = async (...args) => {
    loads++;
    const result = await load(...args);
    if (heldLoad) {
      const held = heldLoad;
      heldLoad = null;
      held.entered.resolve();
      await held.release.promise;
    }
    return result;
  };
  const watched = createTokenizer({store: watchedStore, languageNames: () => ['zh']});
  const words = async () => (await watched.tokenize('注销密钥', {
    dictionaryFiles: ['zh--editable.dict'],
  })).map(token => token.text);
  assertEqual(await words(), ['注销密钥'], 'the initial dictionary must populate the tokenizer cache');
  const cachedLoads = loads;
  for (let index = 0; index < 5; index++)
    await words();
  assert(loads === cachedLoads, 'unchanged tokenization must reuse its index without rescanning dictionaries');

  const saveInPlace = contents => {
    const stream = watchedFile.open_readwrite(null);
    try {
      stream.truncate(0, null);
      stream.get_output_stream().write_all(new TextEncoder().encode(contents), null);
    } finally { stream.close(null); }
  };
  let before = changes;
  saveInPlace(apart);
  await waitUntil(() => changes > before);
  assertEqual(await words(), ['注销', '密钥'],
    'saving an edited file must invalidate cached words without a settings revision or changing its imported locale');

  before = changes;
  const replacement = testRoot.get_child('editor-save.tmp');
  GLib.file_set_contents(replacement.get_path(), together);
  replacement.move(watchedFile, Gio.FileCopyFlags.OVERWRITE, null, null);
  await waitUntil(() => changes > before);
  assertEqual(await words(), ['注销密钥'], 'an atomic editor replacement must invalidate the old file index');

  before = changes;
  watchedFile.delete(null);
  await waitUntil(() => changes > before);
  assertEqual(await words(), tokenizeText('注销密钥').map(token => token.text),
    'deleting the dictionary must drop cached words and restore the normal empty-store fallback');

  before = changes;
  GLib.file_set_contents(watchedFile.get_path(), together);
  await waitUntil(() => changes > before);
  const held = {entered: deferred(), release: deferred()};
  heldLoad = held;
  const pendingWords = words();
  try {
    await held.entered.promise;
    before = changes;
    saveInPlace(apart);
    await waitUntil(() => changes > before);
    held.release.resolve();
    assertEqual(await pendingWords, ['注销', '密钥'],
      'a save during loading must retry instead of returning or caching the completed old index');
    assertEqual(await words(), ['注销', '密钥'], 'the edited index must remain current after the old load settles');
  } finally {
    held.release.resolve();
    await pendingWords;
  }
  watched.destroy();
  before = changes;
  saveInPlace(together);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(stops === 1 && changes === before, 'destroy must disconnect and cancel the directory monitor');
} finally {
  for (const tokenizer of tokenizers)
    tokenizer.destroy();
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
  const dictionaryLimit = await concurrent.tokenize('注销密钥', {revision: 1, maximumTokens: 1})
    .then(() => null, error => error);
  assert(dictionaryLimit?.code === 'word_limit_exceeded', 'Dictionary segmentation must enforce the word limit');
  assertEqual((await concurrent.tokenize('注销密钥', {revision: 1, maximumTokens: 2})).map(token => token.text),
    ['注销', '密钥'], 'Increasing the word limit must take effect without changing the dictionary');
  assert(requests.length === 2, 'Changing only the word limit must reuse the loaded dictionary');

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

print('PASS dictionary loading, file-change invalidation, caching, and cancellation');
