export const SYNC_INTERFACE = 'io.github.guleo.ClipboardX.Sync1';
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
