export const ABSOLUTE_ITEM_LIMIT_BYTES = 256 * 1024 * 1024;
export const ABSOLUTE_PREVIEW_LIMIT_BYTES = 1024 * 1024;
export const MAX_ITEM_REPRESENTATIONS = 16;

export const ClipboardMimeTypes = Object.freeze([
  'text/plain;charset=utf-8',
  'UTF8_STRING',
  'text/plain',
  'STRING',
  'text/html',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

export const SensitiveClipboardMimeTypes = Object.freeze([
  'application/x-keepass2',
  'x-kde-passwordManagerHint',
]);
