export const UUID = 'clipboard-x@guleo.github.io';
export const SETTINGS_SCHEMA = 'io.github.guleo.clipboard-x';
export const SYNC_INTERFACE = 'io.github.guleo.ClipboardX.Sync1';
export const SYNC_API_VERSION = 1;

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

export const TransferState = Object.freeze({
  QUEUED: 'queued',
  WAITING_FOR_SOURCE: 'waiting-for-source',
  TRANSFERRING: 'transferring',
  READY: 'ready',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  FAILED: 'failed',
});
