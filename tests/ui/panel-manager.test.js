import {PanelManager} from '../../src/ui/panel-manager.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const events = [];
let historyOffset = 11;
const historyFocusGrid = {clear: () => events.push('clear-history-focus')};
const tokenizerFocusGrid = {clear: () => events.push('clear-tokenizer-focus')};
const manager = new PanelManager({
  defaultPanel: 'history',
  clearPanelTooltips: () => events.push('clear-tooltips'),
  onGeometry: geometry => events.push(`container:${geometry.width}x${geometry.height}`),
});
manager.register('history', {
  focusGrid: historyFocusGrid,
  captureView: () => ({offset: historyOffset}),
  restoreView: view => events.push(`restore-history:${view?.offset ?? 'none'}`),
  enter: () => events.push('enter-history'),
  leave: () => events.push('leave-history'),
  render: () => events.push('render-history'),
});
manager.register('tokenizer', {
  focusGrid: tokenizerFocusGrid,
  captureView: state => ({source: state.source}),
  restoreView: view => events.push(`restore-tokenizer:${view?.source ?? 'none'}`),
  enter: state => events.push(`enter-tokenizer:${state.source}`),
  leave: () => events.push('leave-tokenizer'),
  render: state => events.push(`render-tokenizer:${state.source}`),
  setGeometry: geometry => events.push(`geometry-tokenizer:${geometry.width}x${geometry.height}`),
});
manager.setGeometry(
  {width: 360, height: 300},
  {tokenizer: {width: 420, height: 280}},
);
assert(events.includes('geometry-tokenizer:420x280'),
  'panel geometry should merge per-panel overrides with defaults');

manager.show('history');
assert(manager.focusGrid === historyFocusGrid, 'active panel should expose its focus grid');
manager.show('tokenizer', {source: 'hello'});
assert(events.includes('container:420x280'),
  'switching panels should apply the resolved geometry to the shared container');
assert(manager.focusGrid === tokenizerFocusGrid, 'switching panels should switch focus grids');
assert(manager.is('tokenizer'), 'show should activate the requested panel');
assert(manager.state.source === 'hello', 'show should retain panel state');
assert(events.indexOf('clear-tooltips') < events.indexOf('leave-history'),
  'tooltips should be cleared before leaving a panel');
assert(events.indexOf('clear-history-focus') < events.indexOf('leave-history'),
  'focus grid should be cleared before leaving a panel');
assert(events.includes('restore-tokenizer:none'),
  'a panel without saved view state should receive an empty restoration');

historyOffset = 0;
manager.show('history');
assert(events.includes('restore-history:11'),
  'returning to a panel should restore the view state captured when leaving it');
manager.refresh();
assert(events.filter(event => event === 'restore-history:0').length === 1,
  'refreshing a panel should preserve its current view state');
manager.show('tokenizer', {source: 'hello'});

manager.close({preserve: true});
manager.hidden();
assert(manager.is('tokenizer'), 'preserved panels should survive closing');

manager.close({preserve: false});
manager.hidden();
assert(manager.is('history'), 'non-preserved panels should reset after the menu is hidden');

manager.show('tokenizer', {source: 'again'});
manager.close({preserve: false});
manager.preservePendingState();
manager.hidden();
assert(manager.is('tokenizer'), 'enabling preservation should cancel a pending reset');

manager.destroy();
assert(manager.currentName === null, 'destroy should release the current panel');
assert(events.includes('clear-history-focus') && events.includes('clear-tokenizer-focus'),
  'destroy should clear every panel focus grid');
