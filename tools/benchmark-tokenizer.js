#!/usr/bin/env gjs

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {DictionaryStore} from '../src/clipboard/tokenizer/dictionary/store.js';
import {Tokenizer} from '../src/clipboard/tokenizer/tokenizer.js';

const DEFAULT_ITERATIONS = 2000;
const LANGUAGE_NAMES = ['zh_CN.UTF-8', 'zh', 'C'];
const SENTENCES = [
  '注销密钥之后重新打开剪切板同步设置。',
  '剪切板分词工具需要保留中文标点、URL 和邮箱地址。',
  'Clipboard X supports lazy loading for large images and long text snapshots.',
  '请检查设备同步状态，并确认图片编辑器命令可以正常启动。',
  'https://github.com/guleoo/clipboard-x-gnome/issues/123 联系 dev@example.com。',
  '截图完成后可以使用系统默认图片编辑器继续处理。',
];

function usage() {
  print(`用法：
  gjs -m tools/benchmark-tokenizer.js <完整词库路径> [迭代次数]

示例：
  curl --fail --location \\
    https://raw.githubusercontent.com/yanyiwu/cppjieba/master/dict/jieba.dict.utf8 \\
    --output /tmp/jieba.dict.utf8
  gjs -m tools/benchmark-tokenizer.js /tmp/jieba.dict.utf8 2000

完整词库必须是 UTF-8 文本，每行包含“词语 可选词频”。`);
}

function now() {
  return GLib.get_monotonic_time();
}

function elapsedMilliseconds(started) {
  return (now() - started) / 1000;
}

function readRssKiB() {
  try {
    const [ok, contents] = GLib.file_get_contents('/proc/self/status');
    if (!ok)
      return null;
    const text = new TextDecoder().decode(contents);
    const match = text.match(/^VmRSS:\s+(\d+)\s+kB$/mu);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch (error) {
    return null;
  }
}

function removeTree(file) {
  if (!file.query_exists(null))
    return;
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null)
      === Gio.FileType.DIRECTORY) {
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

function fileSize(file) {
  return file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)
    .get_size();
}

function runCase(mode, fullPath, iterations) {
  const temporaryRoot = Gio.File.new_for_path(GLib.dir_make_tmp(
    `clipboard-x-tokenizer-${mode}-XXXXXX`,
  ));
  const storeRoot = temporaryRoot.get_child('dictionaries');
  const seedPath = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .resolve_relative_path('../src/clipboard/tokenizer/dictionary/seeds/zh--cppjieba-core.dict')
    .get_path();
  const source = Gio.File.new_for_path(fullPath);
  if (!source.query_exists(null))
    throw new Error(`找不到完整词库：${fullPath}`);

  try {
    const store = new DictionaryStore({
      rootPath: storeRoot.get_path(),
      seedPaths: mode === 'compact' ? [seedPath] : [],
    });
    let dictionaryFile;
    if (mode === 'full') {
      store.ensureSeeds();
      dictionaryFile = storeRoot.get_child('zh--full.dict');
      source.copy(dictionaryFile, Gio.FileCopyFlags.NONE, null, null);
    }

    const dictionary = mode === 'compact'
      ? Gio.File.new_for_path(seedPath)
      : dictionaryFile;
    const entries = store.list()[0]?.entryCount ?? 0;
    const bytes = fileSize(dictionary);
    const tokenizer = new Tokenizer({store, languageNames: () => LANGUAGE_NAMES});
    const firstText = SENTENCES[0];
    const rssBefore = readRssKiB();
    const firstStarted = now();
    const firstTokens = tokenizer.tokenize(firstText);
    const firstLoadMilliseconds = elapsedMilliseconds(firstStarted);
    const rssAfterLoad = readRssKiB();

    let tokenCount = firstTokens.length;
    const cachedStarted = now();
    for (let index = 0; index < iterations; index++) {
      const tokens = tokenizer.tokenize(SENTENCES[index % SENTENCES.length]);
      tokenCount += tokens.length;
    }
    const cachedMilliseconds = elapsedMilliseconds(cachedStarted);
    const cachedCallsPerSecond = iterations / (cachedMilliseconds / 1000);
    return {
      mode,
      bytes,
      entries,
      firstLoadMilliseconds,
      cachedMilliseconds,
      cachedAverageMicroseconds: cachedMilliseconds * 1000 / iterations,
      cachedCallsPerSecond,
      tokenCount,
      rssBeforeKiB: rssBefore,
      rssAfterLoadKiB: rssAfterLoad,
      rssDeltaKiB: rssBefore !== null && rssAfterLoad !== null
        ? rssAfterLoad - rssBefore
        : null,
    };
  } finally {
    removeTree(temporaryRoot);
  }
}

function decode(bytes) {
  return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
}

function runChild(mode, fullPath, iterations) {
  print(JSON.stringify(runCase(mode, fullPath, iterations)));
}

function spawnCase(mode, fullPath, iterations) {
  const scriptPath = Gio.File.new_for_uri(import.meta.url).get_path();
  const [ok, stdout, stderr, status] = GLib.spawn_sync(
    null,
    ['gjs', '-m', scriptPath,
      '--child', mode, fullPath, String(iterations)],
    null,
    GLib.SpawnFlags.SEARCH_PATH,
    null,
  );
  if (!ok || status !== 0) {
    throw new Error(decode(stderr) || `${mode} benchmark exited with status ${status}`);
  }
  return JSON.parse(decode(stdout));
}

if (ARGV[0] === '--child') {
  runChild(ARGV[1], ARGV[2], Number.parseInt(ARGV[3], 10));
} else {
  if (!ARGV[0] || ARGV[0] === '--help' || ARGV[0] === '-h') {
    usage();
    if (!ARGV[0] || ARGV[0] === '--help' || ARGV[0] === '-h')
      imports.system.exit(ARGV[0] ? 0 : 2);
  }
  const fullPath = Gio.File.new_for_commandline_arg(ARGV[0]).get_path();
  const iterations = Number.parseInt(ARGV[1] ?? String(DEFAULT_ITERATIONS), 10);
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new Error('迭代次数必须是大于 0 的整数');
  const compact = spawnCase('compact', fullPath, iterations);
  const full = spawnCase('full', fullPath, iterations);
  print('Clipboard X tokenizer benchmark');
  print(`输入：${fullPath}`);
  print(`迭代次数：${iterations}`);
  print('');
  print('模式                 词条数       文件大小       首次加载(ms)   缓存平均(us)   缓存调用/秒   RSS增量(KiB)');
  for (const result of [compact, full]) {
    print(`${result.mode.padEnd(20)} ${String(result.entries).padStart(8)} `
      + `${(result.bytes / 1024).toFixed(1).padStart(12)} `
      + `${result.firstLoadMilliseconds.toFixed(2).padStart(15)} `
      + `${result.cachedAverageMicroseconds.toFixed(2).padStart(14)} `
      + `${result.cachedCallsPerSecond.toFixed(1).padStart(13)} `
      + `${String(result.rssDeltaKiB ?? 'n/a').padStart(13)}`);
  }
  print('');
  print(`完整/精简：文件 ${(full.bytes / compact.bytes).toFixed(2)}x，词条 ${(full.entries / compact.entries).toFixed(2)}x，`
    + `首次加载 ${(full.firstLoadMilliseconds / compact.firstLoadMilliseconds).toFixed(2)}x，`
    + `缓存平均耗时 ${(full.cachedAverageMicroseconds / compact.cachedAverageMicroseconds).toFixed(2)}x`);
}
