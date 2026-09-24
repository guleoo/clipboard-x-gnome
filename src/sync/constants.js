export const MAX_TRANSFER_STATES = 1024;

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
