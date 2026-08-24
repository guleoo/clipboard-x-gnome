export const SYNC_INTERFACE = 'io.github.guleo.ClipboardX.Sync1';
export const SYNC_BUS_NAME = 'io.github.guleo.ClipboardX.SyncService';
export const SYNC_OBJECT_PATH = '/io/github/guleo/ClipboardX/Sync';
export const SYNC_API_VERSION = 1;

export const TransferState = Object.freeze({
  QUEUED: 'queued',
  WAITING_FOR_PEER: 'waiting-for-peer',
  TRANSFERRING: 'transferring',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});
