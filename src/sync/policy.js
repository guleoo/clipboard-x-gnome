export function delivery(settings, mimeType, size) {
  const threshold = mimeType.startsWith('image/')
    ? settings.get_uint('image-full-threshold')
    : settings.get_uint('text-full-threshold');
  return size <= threshold ? 'eager' : 'on-demand';
}
