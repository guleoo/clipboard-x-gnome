// Range selection shared by held-pointer and Shift+arrow word selection.
// Positions index `order`, the token indexes in their on-screen order.

export function beginRange(selected, order, anchorPosition) {
  return {
    anchorPosition,
    baseSelected: new Set(selected),
    // Starting on a selected word deselects the range; otherwise it selects.
    targetSelected: !selected.has(order[anchorPosition]),
  };
}

export function rangeSelection(range, order, targetPosition) {
  const selected = new Set(range.baseSelected);
  const start = Math.min(range.anchorPosition, targetPosition);
  const end = Math.max(range.anchorPosition, targetPosition);
  for (let position = start; position <= end; position++) {
    if (range.targetSelected)
      selected.add(order[position]);
    else
      selected.delete(order[position]);
  }
  return selected;
}
