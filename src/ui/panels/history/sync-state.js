// Local originals, not short-lived transfer records, determine received-item completion.
export function isComplete(item, transfer = null) {
  if (!item.remote)
    return transfer?.state === 'completed';
  return item.representations.length > 0
    && item.representations.every(value => value.bytes || value.path);
}

export function isPreviewPublished(item, transfer = null) {
  return !item.remote && transfer?.state === 'completed'
    && transfer.kind === 'publish'
    && item.representations.some(value => value.delivery === 'on-demand');
}
