import {FocusGrid} from '../../src/ui/focus-grid.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const focused = [];
const revealed = [];
const actor = (name, center, options = {}) => ({
  name,
  center,
  mapped: options.mapped ?? true,
  visible: options.visible ?? true,
  can_focus: options.canFocus ?? true,
  reactive: options.reactive ?? true,
});
const search = actor('search', 80);
const screenshot = actor('screenshot', 280);
const firstContent = actor('first-content', 90);
const firstPin = actor('first-pin', 270);
const hiddenSync = actor('hidden-sync', 300, {visible: false});
const firstDelete = actor('first-delete', 330);
const secondContent = actor('second-content', 90);
const secondDelete = actor('second-delete', 330);
const copy = actor('copy', 330);
const grid = new FocusGrid({
  focus: target => focused.push(target.name),
  center: target => target.center,
  ensureVisible: target => revealed.push(target.name),
});

grid.setRows([
  [search, screenshot],
  [firstContent, firstPin, hiddenSync, firstDelete],
  [secondContent, secondDelete],
  [copy],
]);

assert(grid.contains(firstPin), 'grid should contain registered controls');
assert(grid.move(firstPin, 'right') === firstDelete,
  'horizontal navigation should skip ineligible controls');
assert(grid.move(firstPin, 'down') === secondDelete,
  'vertical navigation should choose the closest horizontal center');
assert(grid.move(secondContent, 'up') === firstContent,
  'upward navigation should use the previous eligible row');
assert(grid.move(secondDelete, 'down') === copy,
  'navigation should reach a single-control footer row');
assert(grid.move(copy, 'down') === null,
  'navigation should stop at the matrix boundary');
assert(focused.join(',') === 'first-delete,second-delete,first-content,copy',
  'focus callback received unexpected controls');
assert(revealed.join(',') === focused.join(','),
  'each focus move should reveal its target');

grid.clear();
assert(!grid.contains(search), 'clear should release the matrix');
