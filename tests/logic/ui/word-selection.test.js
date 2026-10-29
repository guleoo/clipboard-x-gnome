import {beginRange, rangeSelection} from '../../../src/ui/panels/tokenizer/selection.js';
import {loadWords} from '../../../src/ui/panels/tokenizer/request.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const list = selection => [...selection].sort((left, right) => left - right).join(',');

// Token indexes are not positions: punctuation and spaces may be skipped.
const order = [0, 2, 4, 6, 8];

// SELECT-01/02: a held range follows the pointer, including backtracking.
{
  const range = beginRange(new Set(), order, 0);
  assert(list(rangeSelection(range, order, 0)) === '0', 'Pressing selects the anchor word');
  assert(list(rangeSelection(range, order, 2)) === '0,2,4', 'Holding A to C selects ABC');
  assert(list(rangeSelection(range, order, 1)) === '0,2', 'Backtracking to B keeps only AB');
}

// SELECT-03: reverse ranges are symmetric and keep words outside the range.
{
  const range = beginRange(new Set([8]), order, 3);
  assert(list(rangeSelection(range, order, 1)) === '2,4,6,8', 'Reverse range selects back to its target');
  assert(list(rangeSelection(range, order, 3)) === '6,8', 'Returning to the anchor restores the outside selection');
}

// SELECT-02/04: starting on a selected word deselects the range, as with Shift+arrows.
{
  const selected = new Set([0, 2, 4, 6]);
  const range = beginRange(selected, order, 1);
  assert(!range.targetSelected, 'A selected anchor starts a deselecting range');
  assert(list(rangeSelection(range, order, 2)) === '0,6', 'Deselecting range clears only its own words');
  assert(list(selected) === '0,2,4,6', 'Computing a range must not mutate the base selection');
  assert(list(rangeSelection(range, order, 4)) === '0', 'Extending to the last word clears through the end');
}

function fakePanel({open = true} = {}) {
  const panel = {
    serial: 0,
    open,
    shown: null,
    errors: [],
    refreshed: 0,
    resets: 0,
    gates: {},
    nextRequest: () => ++panel.serial,
    latestRequest: () => panel.serial,
    isOpen: () => panel.open,
    shownState: () => panel.shown,
    validate: item => {
      if (item.text.length > 20)
        throw Object.assign(new RangeError('too long'), {code: 'text_limit_exceeded'});
    },
    showLoading: item => {
      // Like the real panel manager, switching panels invalidates earlier requests.
      panel.serial++;
      panel.shown = {item, loading: true, tokens: []};
      return panel.shown;
    },
    waitForPaint: () => Promise.resolve(),
    readItem: () => Promise.resolve(),
    createState: (item, source) => {
      const result = {loading: false, tokens: source.split(' ')};
      if (!panel.gates[item.text])
        return Promise.resolve(result);
      return new Promise(resolve => { panel.gates[item.text] = () => resolve(result); });
    },
    refresh: () => panel.refreshed++,
    reset: () => panel.resets++,
    reportError: error => panel.errors.push(error),
    // Switching to another panel bumps the request serial, as _showPanelChrome does.
    switchAway: () => { panel.serial++; panel.shown = null; },
  };
  return panel;
}

const text = value => ({isText: true, text: value, primary: {size: value.length}});

// A completed request fills the loading state that is still shown.
{
  const panel = fakePanel();
  await loadWords(text('alpha beta'), panel);
  assert(panel.shown.loading === false && panel.shown.tokens.join() === 'alpha,beta' && panel.refreshed === 1,
    'The current request must populate its own loading state');
}

// Non-text entries never open the word panel.
{
  const panel = fakePanel();
  await loadWords({isText: false, text: ''}, panel);
  assert(panel.shown === null && panel.errors.length === 0, 'Images must not open word selection');
}

// WORD-08: late results after closing, switching panels or disabling must not apply.
for (const exit of ['close', 'phrases', 'disable', 'reopen']) {
  const panel = fakePanel();
  panel.gates['late result'] = true;
  const pending = loadWords(text('late result'), panel);
  const loading = panel.shown;
  await tick();
  assert(typeof panel.gates['late result'] === 'function', 'The real word result is pending');
  if (exit === 'close' || exit === 'disable')
    panel.open = false;
  else if (exit === 'reopen')
    panel.serial++; // A preserved panel reopens with the same loading state, but as a new showing.
  else
    panel.switchAway();
  panel.gates['late result']();
  await pending;
  assert(loading.loading && loading.tokens.length === 0 && panel.refreshed === 0,
    `${exit}: a late result must not populate the abandoned loading state`);
}

// WORD-08-newer: the older result cannot replace a newer entry's words.
{
  const panel = fakePanel();
  panel.gates['older entry'] = true;
  const older = loadWords(text('older entry'), panel);
  await tick();
  await loadWords(text('newer entry'), panel);
  const newer = panel.shown;
  assert(newer.tokens.join() === 'newer,entry', 'The newer request completes while the older one is pending');
  panel.gates['older entry']();
  await older;
  assert(panel.shown === newer && newer.tokens.join() === 'newer,entry' && panel.refreshed === 1,
    'Completing the older request must leave the newer words untouched');
}

// Errors are reported only for the current request and reset its loading panel.
{
  const panel = fakePanel();
  await loadWords(text('this text is far too long for the panel'), panel);
  assert(panel.errors.length === 1 && panel.errors[0].code === 'text_limit_exceeded' && panel.shown === null,
    'Rejected input reports before showing a loading panel');
  const failing = fakePanel();
  failing.createState = () => Promise.reject(new Error('tokenizer failed'));
  await loadWords(text('fails later'), failing);
  assert(failing.errors.length === 1 && failing.resets === 1, 'A current failure resets the shown loading state');
  const stale = fakePanel();
  stale.createState = () => { stale.open = false; return Promise.reject(new Error('late failure')); };
  await loadWords(text('stale failure'), stale);
  assert(stale.errors.length === 0 && stale.resets === 0, 'A stale failure must stay silent');
}
