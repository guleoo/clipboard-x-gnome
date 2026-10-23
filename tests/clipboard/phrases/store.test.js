import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MAX_PHRASE_LENGTH, PhraseStore} from '../../../src/clipboard/phrases/store.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function rejection(promise, message) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

function contents(path) {
  const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
  return new TextDecoder().decode(bytes);
}

let limit = 3;
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
const directory = GLib.dir_make_tmp('clipboard-x-gnome-phrases-test-XXXXXX');
const path = GLib.build_filenamev([directory, 'quick-phrases.json']);
const invalidPath = GLib.build_filenamev([directory, 'invalid-quick-phrases.json']);
const recoveryPath = GLib.build_filenamev([directory, 'recovery-quick-phrases.json']);
const backupPath = GLib.build_filenamev([directory, 'preserved-quick-phrases.json']);
const capacityPath = GLib.build_filenamev([directory, 'capacity-quick-phrases.json']);
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
  for (let index = 0; index < limit + 1; index++)
    await store.add(`phrase-${index}`);
  assert(store.all.length === limit,
    'the local phrase collection should respect its item limit');
  assert(await store.remove('phrase-3') && !store.all.includes('phrase-3'),
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

  for (const document of ['{invalid JSON', JSON.stringify({version: 2, phrases: ['preserved']})]) {
    GLib.file_set_contents(invalidPath, document);
    const invalid = new PhraseStore(settings, {path: invalidPath});
    const loadError = await rejection(invalid.ready, 'an invalid phrases file must reject initialization');
    const mutations = [
      ['add', () => invalid.add('new phrase')],
      ['remove', () => invalid.remove('preserved')],
      ['trim', () => invalid.trim()],
      ['replace', () => invalid.replace(['replacement'])],
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const [name, mutate] of mutations) {
        const error = await rejection(mutate(), `${name} must reject after initialization fails`);
        assert(error === loadError && invalid.all.length === 0,
          `${name} must preserve the initialization error without mutating unloaded phrases`);
        assert(contents(invalidPath) === document,
          `${name} must not overwrite the original file after initialization fails`);
      }
    }
  }

  limit = 3;
  newestFirst = true;
  const recovery = new PhraseStore(settings, {path: recoveryPath});
  await recovery.ready;
  await recovery.replace(['preserved']);
  const saved = contents(recoveryPath);
  const recoveryFile = Gio.File.new_for_path(recoveryPath);
  recoveryFile.move(Gio.File.new_for_path(backupPath), Gio.FileCopyFlags.NONE, null, null);
  recoveryFile.make_directory(null);
  await Promise.all([
    rejection(recovery.add('failed addition'), 'adding phrases must reject a failed write'),
    rejection(recovery.remove('preserved'), 'removing phrases must reject a failed write'),
    rejection(recovery.replace(['failed replacement']), 'replacing phrases must reject a failed write'),
  ]);
  assert(recovery.all.join(',') === 'preserved' && contents(backupPath) === saved,
    'failed writes must preserve committed phrases in memory and on disk');
  recoveryFile.delete(null);
  Gio.File.new_for_path(backupPath).move(recoveryFile, Gio.FileCopyFlags.NONE, null, null);
  assert(await recovery.add('recovered') && recovery.all.join(',') === 'recovered,preserved',
    'a successful mutation must continue after ordinary write failures without using failed changes');
  const recovered = new PhraseStore(settings, {path: recoveryPath});
  await recovered.ready;
  assert(recovered.all.join(',') === 'recovered,preserved',
    'recovered mutations must persist only successfully committed phrases');

  // One full-capacity round trip, not repeated appends: controls exercise JSON's
  // six-byte escaping while the prefix also checks non-BMP code-point counting.
  limit = 1000;
  const phrases = Array.from({length: limit}, (_value, index) => {
    const prefix = `${index}字🧩`;
    return prefix + '\u0000'.repeat(MAX_PHRASE_LENGTH - [...prefix].length);
  });
  const capacity = new PhraseStore(settings, {path: capacityPath});
  await capacity.ready;
  await capacity.replace(phrases);
  assert(capacity.all.length === limit && capacity.all.every(value => [...value].length === MAX_PHRASE_LENGTH),
    'the full configured phrase count and per-phrase code-point capacity must remain available');
  assert(Gio.File.new_for_path(capacityPath).query_info(Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
    Gio.FileQueryInfoFlags.NONE, null).get_size() > 8 * 1024 * 1024,
    'the capacity fixture must exceed the previous JSON file limit');
  const reopenedCapacity = new PhraseStore(settings, {path: capacityPath});
  await reopenedCapacity.ready;
  assert(reopenedCapacity.all.every((value, index) => value === phrases[index])
      && reopenedCapacity.all.length === phrases.length,
    'all maximum-length escaped and Unicode phrases must survive a real file reload');
  assert(await reopenedCapacity.remove(phrases[0]), 'a large reloaded phrase collection must remain editable');
  const afterRemoval = new PhraseStore(settings, {path: capacityPath});
  await afterRemoval.ready;
  assert(afterRemoval.all.length === phrases.length - 1
      && afterRemoval.all.every((value, index) => value === phrases[index + 1]),
    'deleting from a collection above 8 MiB must persist without losing the remaining phrases');
} finally {
  for (const target of [path, invalidPath, recoveryPath, backupPath, capacityPath]) {
    try {
      Gio.File.new_for_path(target).delete(null);
    } catch (_error) {
      // The test may fail before the file is created.
    }
  }
  Gio.File.new_for_path(directory).delete(null);
}
