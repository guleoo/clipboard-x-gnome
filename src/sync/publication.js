import {ABSOLUTE_ITEM_LIMIT_BYTES, ABSOLUTE_PREVIEW_LIMIT_BYTES, MAX_ITEM_REPRESENTATIONS} from '../clipboard/constants.js';
import {bytesFromString, sha256, truncateUtf8} from '../common/bytes.js';
import {delivery} from './policy.js';
import {item as remoteItem} from './protocol.js';

// A publication is immutable once its first request may have reached the server.
// This metadata is safe to store in the outbox: no payload, paths or credentials.
export function create(item, {settings, capabilities, deviceId}) {
  const contents = item.representations.filter(value => allowed(value.mimeType, settings, capabilities))
    .map(value => ({id: value.id, mimeType: value.mimeType, size: value.size,
      sha256: value.sha256, delivery: delivery(settings, value.mimeType, value.size)}));
  if (contents.length === 0 || contents.length > MAX_ITEM_REPRESENTATIONS)
    throw new Error('Synchronization policy rejects all representations or their count');
  const previews = [];
  const preview = item.preview;
  if (preview && contents.some(value => value.id === preview.derivedFrom)) {
    const image = !preview.text;
    const configured = settings.get_uint(image ? 'thumbnail-byte-limit' : 'text-preview-limit');
    const maximum = Math.min(configured, ABSOLUTE_PREVIEW_LIMIT_BYTES,
      capabilities.maxPreviewBytes || ABSOLUTE_PREVIEW_LIMIT_BYTES);
    if (preview.text) {
      const result = truncateUtf8(preview.text, maximum);
      const bytes = bytesFromString(result.text);
      const digest = sha256(bytes);
      previews.push({id: digest, contentId: preview.derivedFrom, mimeType: preview.mimeType,
        size: bytes.get_size(), sha256: digest, truncated: preview.truncated || result.truncated});
    } else if (preview.path && preview.size <= maximum) {
      previews.push({id: preview.sha256, contentId: preview.derivedFrom, mimeType: preview.mimeType,
        size: preview.size, sha256: preview.sha256, truncated: true});
    }
  }
  return validate({id: item.id, createdAt: item.createdAt, originDeviceId: deviceId, contents, previews});
}

export function validate(value, {itemId = value?.id, deviceId = value?.originDeviceId} = {}) {
  const parsed = remoteItem({...value, origin: {deviceId: value?.originDeviceId}}, itemId);
  if (parsed.originDeviceId !== deviceId)
    throw new Error('Publication has an invalid device identity');
  if (parsed.contents.reduce((sum, content) => sum + content.size, 0) > ABSOLUTE_ITEM_LIMIT_BYTES)
    throw new Error('Publication exceeds the absolute item size limit');
  return {id: parsed.id, createdAt: parsed.createdAt, originDeviceId: parsed.originDeviceId,
    contents: parsed.contents.map(({availability: _availability, ...content}) => content),
    previews: parsed.previews};
}

export function sources(item, manifest) {
  const result = new Map();
  for (const content of manifest.contents) {
    const local = item.representations.find(value => value.id === content.id);
    if (!local?.path || local.mimeType !== content.mimeType || local.size !== content.size
        || local.sha256 !== content.sha256)
      throw new Error('Persisted clipboard content no longer matches its publication');
    if (content.delivery === 'eager')
      result.set(`content:${content.id}`, {path: local.path, size: content.size, mimeType: content.mimeType});
  }
  for (const preview of manifest.previews) {
    const local = item.preview;
    let source;
    if (local?.text && preview.mimeType.startsWith('text/')) {
      const bytes = bytesFromString(truncateUtf8(local.text, preview.size).text);
      if (bytes.get_size() === preview.size && sha256(bytes) === preview.sha256)
        source = {bytes, size: preview.size, mimeType: preview.mimeType};
    } else if (local?.path && local.size === preview.size && local.sha256 === preview.sha256) {
      source = {path: local.path, size: preview.size, mimeType: preview.mimeType};
    }
    if (!source)
      throw new Error('Persisted clipboard preview no longer matches its publication');
    result.set(`preview:${preview.id}`, source);
  }
  return result;
}

function allowed(mimeType, settings, capabilities) {
  if (mimeType === 'text/html' && !settings.get_boolean('sync-html'))
    return false;
  if (mimeType.startsWith('text/') && mimeType !== 'text/html' && !settings.get_boolean('sync-text'))
    return false;
  if (mimeType.startsWith('image/') && !settings.get_boolean('sync-images'))
    return false;
  return capabilities.supportedMimeTypes.length === 0 || capabilities.supportedMimeTypes.includes(mimeType);
}
