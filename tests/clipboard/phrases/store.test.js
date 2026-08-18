import {MAX_PHRASE_LENGTH, PhraseStore} from '../../../src/clipboard/phrases/store.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

let values = [];
let limit = 200;
let newestFirst = true;
const settings = {
  get_strv: key => {
    assert(key === 'saved-phrases', 'store read an unexpected settings key');
    return [...values];
  },
  set_strv: (key, next) => {
    assert(key === 'saved-phrases', 'store wrote an unexpected settings key');
    values = [...next];
  },
  get_int: key => {
    assert(key === 'saved-phrase-limit', 'store read an unexpected integer setting');
    return limit;
  },
  get_boolean: key => {
    assert(key === 'saved-phrase-newest-first', 'store read an unexpected boolean setting');
    return newestFirst;
  },
};
const store = new PhraseStore(settings);

assert(!store.add(' \n\t '), 'blank phrases should be rejected');
assert(store.add('  第一条语句  ') && store.all[0] === '第一条语句',
  'phrases should be trimmed before saving');
store.add('第二条语句');
store.add('第一条语句');
assert(store.all.join(',') === '第一条语句,第二条语句',
  'adding an existing phrase should move it to the front without duplication');
assert(store.add('x'.repeat(MAX_PHRASE_LENGTH + 10))
    && [...store.all[0]].length === MAX_PHRASE_LENGTH,
  'phrases should respect the character limit');
for (let index = 0; index < limit + 10; index++)
  store.add(`phrase-${index}`);
assert(store.all.length === limit,
  'the local phrase collection should respect its item limit');
assert(store.remove('phrase-199') && !store.all.includes('phrase-199'),
  'remove should delete a saved phrase');
assert(!store.remove('missing'), 'removing an unknown phrase should not report a change');

newestFirst = false;
values = ['existing'];
assert(store.add('later') && store.all.join(',') === 'existing,later',
  'oldest-first mode should append newly added phrases');
limit = 1;
assert(store.trim() && store.all.join(',') === 'later',
  'trim should immediately apply a reduced item limit');
