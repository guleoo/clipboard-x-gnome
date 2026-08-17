import {PanelManager} from '../../src/ui/panel-manager.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const events = [];
const manager = new PanelManager({
  defaultPanel: 'history',
  clearPanelTooltips: () => events.push('clear-tooltips'),
});
manager.register('history', {
  enter: () => events.push('enter-history'),
  leave: () => events.push('leave-history'),
  render: () => events.push('render-history'),
});
manager.register('tokenizer', {
  enter: state => events.push(`enter-tokenizer:${state.source}`),
  leave: () => events.push('leave-tokenizer'),
  render: state => events.push(`render-tokenizer:${state.source}`),
});

manager.show('history');
manager.show('tokenizer', {source: 'hello'});
assert(manager.is('tokenizer'), 'show should activate the requested panel');
assert(manager.state.source === 'hello', 'show should retain panel state');
assert(events.indexOf('clear-tooltips') < events.indexOf('leave-history'),
  'tooltips should be cleared before leaving a panel');

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
