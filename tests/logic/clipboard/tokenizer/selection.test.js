import * as Selection from '../../../../src/clipboard/tokenizer/dictionary/selection.js';
import {SYSTEM_DICTIONARY_ID} from '../../../../src/clipboard/tokenizer/dictionary/locale.js';

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const dictionaries = [
  {fileName: 'zh--team.dict', locale: 'zh'},
  {fileName: 'zh--personal.dict', locale: 'zh'},
  {fileName: 'ja--team.dict', locale: 'ja'},
];
const sorted = values => [...values].sort();

assertEqual(sorted(Selection.enabled([], dictionaries)),
  sorted([SYSTEM_DICTIONARY_ID, ...dictionaries.map(dictionary => dictionary.fileName)]),
  'the default selection must enable all languages and the system segmenter');

let configured = Selection.withEnabled([], dictionaries, 'zh--team.dict', false);
assertEqual(configured, sorted([SYSTEM_DICTIONARY_ID, 'zh--personal.dict', 'ja--team.dict']),
  'disabling a Chinese dictionary must retain Japanese and system selections');
configured = Selection.withEnabled(configured, dictionaries, 'ja--team.dict', false);
assertEqual(configured, sorted([SYSTEM_DICTIONARY_ID, 'zh--personal.dict']),
  'changing language and disabling a dictionary must retain earlier choices');
configured = Selection.withEnabled(configured, dictionaries, 'zh--team.dict', true);
assertEqual(configured, sorted([SYSTEM_DICTIONARY_ID, 'zh--personal.dict', 'zh--team.dict']),
  'enabling all dictionaries in one language must not re-enable another language');
configured = Selection.withEnabled(configured, dictionaries, 'ja--team.dict', true);
assertEqual(configured, [], 'enabling all sources globally should restore the default selection');

configured = Selection.withEnabled([], dictionaries, SYSTEM_DICTIONARY_ID, false);
assertEqual(configured, sorted(dictionaries.map(dictionary => dictionary.fileName)),
  'the system segmenter can be disabled while imported dictionaries remain enabled');
configured = Selection.withEnabled(configured, dictionaries, 'zh--team.dict', false);
assertEqual(configured, sorted(['zh--personal.dict', 'ja--team.dict']),
  'disabling a file must preserve the disabled system segmenter');

const original = [SYSTEM_DICTIONARY_ID, 'zh--personal.dict'];
Selection.withEnabled(original, dictionaries, 'ja--team.dict', true);
assertEqual(original, [SYSTEM_DICTIONARY_ID, 'zh--personal.dict'],
  'selection calculation must not mutate its caller configuration');

let rejected = false;
try {
  Selection.withEnabled([], [], SYSTEM_DICTIONARY_ID, false);
} catch {
  rejected = true;
}
if (!rejected)
  throw new Error('disabling the last source must not turn an empty selection back into all enabled');
