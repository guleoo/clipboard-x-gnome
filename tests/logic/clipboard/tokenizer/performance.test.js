import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {DictionaryStore} from '../../../../src/clipboard/tokenizer/dictionary/store.js';
import {Tokenizer} from '../../../../src/clipboard/tokenizer/tokenizer.js';
import {assert, pause, removeTree} from '../controller-fixture.js';

// DICT-09: optional bulk I/O/index/cache acceptance, without a file chooser or Shell.
const root = Gio.File.new_for_path(GLib.dir_make_tmp('cbx-dictionary-performance-XXXXXX'));
const first = '青铜机械海豚';
const second = '紫色量子汤圆';
const store = new DictionaryStore({rootPath: root.get_child('store').get_path()});
const tokenizer = new Tokenizer({store, languageNames: () => ['zh_CN.UTF-8', 'zh', 'C']});
let last = GLib.get_monotonic_time();
let maximumGap = 0;
let samples = 0;
const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
  const now = GLib.get_monotonic_time();
  maximumGap = Math.max(maximumGap, (now - last) / 1000);
  last = now;
  samples++;
  return GLib.SOURCE_CONTINUE;
});
try {
  const source = root.get_child('large.txt');
  const text = '# locale: zh_CN\n# name: Large Dictionary\n'
    + Array.from({length: 120000}, (_, index) => `性能词${String.fromCodePoint(0x4e00 + index % 2000)}${String.fromCodePoint(0x4e00 + Math.floor(index / 2000))} 10\n`).join('')
    + `${first} 1000000\n${second} 1000000\n`;
  source.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
  const started = GLib.get_monotonic_time();
  const entry = await store.importFile(source);
  assert(entry.entryCount === 120002 && (await store.list())[0].entryCount === 120002,
    'Actual import and stored metadata must retain all 120,002 dictionary entries');
  const importedAt = GLib.get_monotonic_time();
  const cold = await tokenizer.tokenize(first + second);
  assert(cold.some(token => token.text === first) && cold.some(token => token.text === second),
    'The cold production index must segment using the imported dictionary');
  const coldAt = GLib.get_monotonic_time();
  const warm = await tokenizer.tokenize(first + second);
  assert(JSON.stringify(warm) === JSON.stringify(cold), 'Cached segmentation must preserve exact tokens and offsets');
  const warmAt = GLib.get_monotonic_time();
  await pause(30);
  print(`DICT-09 entries=120002 importMs=${(importedAt - started) / 1000} coldMs=${(coldAt - importedAt) / 1000} warmMs=${(warmAt - coldAt) / 1000} maximumLoopGapMs=${maximumGap} samples=${samples}`);
  assert(samples > 0 && maximumGap < 1000,
    'Bulk import/indexing must keep the GJS main loop below the one-second responsiveness budget');
} finally {
  GLib.Source.remove(timer);
  tokenizer.destroy();
  removeTree(root);
}
