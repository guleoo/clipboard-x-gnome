export function effectiveCapabilities(settings, capabilities) {
  const absoluteItemLimit = 256 * 1024 * 1024;
  const absolutePreviewLimit = 1024 * 1024;
  const configuredItemLimit = Math.min(
    settings.get_int('capture-size-limit-mib') * 1024 * 1024,
    absoluteItemLimit,
  );
  const configuredPreviewLimit = Math.min(
    Math.max(settings.get_uint('text-preview-limit'), settings.get_uint('thumbnail-byte-limit')),
    absolutePreviewLimit,
  );
  const serviceItemLimit = Number(capabilities.MaxItemBytes) || 0;
  const servicePreviewLimit = Number(capabilities.MaxPreviewBytes) || 0;
  const localMimeTypes = [
    settings.get_boolean('sync-text') ? 'text/plain;charset=utf-8' : null,
    settings.get_boolean('sync-html') ? 'text/html' : null,
    settings.get_boolean('sync-images') ? 'image/*' : null,
  ].filter(Boolean);
  const advertised = Array.isArray(capabilities.SupportedMimeTypes)
    ? capabilities.SupportedMimeTypes
    : [];
  const mimeTypes = advertised.length === 0
    ? localMimeTypes
    : advertised.filter(mimeType => localMimeTypes.some(allowed =>
      allowed === mimeType || (allowed === 'image/*' && mimeType.startsWith('image/'))));
  return {
    itemBytes: serviceItemLimit > 0 ? Math.min(serviceItemLimit, configuredItemLimit) : configuredItemLimit,
    previewBytes: servicePreviewLimit > 0
      ? Math.min(servicePreviewLimit, configuredPreviewLimit)
      : configuredPreviewLimit,
    mimeTypes,
  };
}

export function delivery(settings, mimeType, size) {
  const threshold = mimeType.startsWith('image/')
    ? settings.get_uint('image-full-threshold')
    : settings.get_uint('text-full-threshold');
  return size <= threshold ? 'eager' : 'on-demand';
}
