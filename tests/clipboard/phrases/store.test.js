import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MAX_PHRASE_LENGTH, PhraseStore} from '../../../src/clipboard/phrases/store.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

let limit = 200;
let newestFirst = true;
const settings = {
  get_int: key => {
    assert(key === 'saved-phrase-limit', 'store read an unexpected integer setting');
    return limit;
  },
  get_boolean: key => {
    assert(key === 'saved-phrase-newest-first', 'store read an unexpected boolean setting');
    return newestFirst;
  },
};
const directory = GLib.dir_make_tmp('clipboard-x-phrases-test-XXXXXX');
const path = GLib.build_filenamev([directory, 'quick-phrases.json']);
const store = new PhraseStore(settings, {path});

try {
  await store.ready;
  assert(!await store.add(' \n\t '), 'blank phrases should be rejected');
  assert(await store.add('  第一条语句  ') && store.all[0] === '第一条语句',
    'phrases should be trimmed before saving');
  await store.add('第二条语句');
  await store.add('第一条语句');
  assert(store.all.join(',') === '第一条语句,第二条语句',
    'adding an existing phrase should move it to the front without duplication');
  assert(await store.add('x'.repeat(MAX_PHRASE_LENGTH + 10))
      && [...store.all[0]].length === MAX_PHRASE_LENGTH,
    'phrases should respect the character limit');
  for (let index = 0; index < limit + 10; index++)
    await store.add(`phrase-${index}`);
  assert(store.all.length === limit,
    'the local phrase collection should respect its item limit');
  assert(await store.remove('phrase-199') && !store.all.includes('phrase-199'),
    'remove should delete a saved phrase');
  assert(!await store.remove('missing'), 'removing an unknown phrase should not report a change');

  newestFirst = false;
  await store.replace(['existing']);
  assert(await store.add('later') && store.all.join(',') === 'existing,later',
    'oldest-first mode should append newly added phrases');
  limit = 1;
  assert(await store.trim() && store.all.join(',') === 'later',
    'trim should immediately apply a reduced item limit');

  const restored = new PhraseStore(settings, {path});
  await restored.ready;
  assert(restored.all.join(',') === 'later',
    'quick phrases must be restored from the user data JSON file');
  const mode = Gio.File.new_for_path(path)
    .query_info(Gio.FILE_ATTRIBUTE_UNIX_MODE, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null)
    .get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE);
  assert((mode & 0o077) === 0, 'quick phrases file must not grant group or other access');
} finally {
  try {
    Gio.File.new_for_path(path).delete(null);
  } catch (_error) {
    // The test may fail before the file is created.
  }
  Gio.File.new_for_path(directory).delete(null);
}
