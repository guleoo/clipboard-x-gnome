// Wire-format factories shared by client tests. Delays, abort behavior and
// counters stay in each scenario; these helpers only encode protocol facts.
export function transfer({id, itemId, deviceId, kind = 'publish', direction = 'upload',
  state = 'queued', totalBytes = 0, completedBytes = state === 'completed' ? totalBytes : 0}) {
  return {id, itemId, deviceId, kind, direction, state, totalBytes, completedBytes,
    peerDeviceIds: [], createdAt: 1, updatedAt: 2};
}

export function publication(manifest, {deviceId, uploadId, transferId, state = 'queued'}) {
  const previewIds = manifest.previews.map(value => value.id);
  const contentIds = manifest.contents.filter(value => value.delivery === 'eager').map(value => value.id);
  const totalBytes = [...manifest.previews,
    ...manifest.contents.filter(value => value.delivery === 'eager')].reduce((sum, value) => sum + value.size, 0);
  return {itemId: manifest.id, uploadId, previewIds, contentIds,
    transfer: transfer({id: transferId, itemId: manifest.id, deviceId, totalBytes, state})};
}

// Server publications are immutable even when the POST response was lost.
export class Publications {
  constructor() { this._manifests = new Map(); }

  accept(channelId, manifest) {
    const document = JSON.stringify({channelId, originDeviceId: manifest.originDeviceId,
      contents: [...manifest.contents].sort(byId), previews: [...manifest.previews].sort(byId)});
    const previous = this._manifests.get(manifest.id);
    if (previous && previous !== document)
      throw Object.assign(new Error('ItemId already exists with a different manifest'),
        {code: 'item_conflict', status: 409});
    this._manifests.set(manifest.id, document);
  }
}

function byId(left, right) { return left.id.localeCompare(right.id); }
