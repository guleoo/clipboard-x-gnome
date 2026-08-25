import {isUuid} from '../common/uuid.js';

export const DEFAULT_LEASE_SECONDS = 15;
export const MINIMUM_LEASE_SECONDS = 5;
export const MAXIMUM_LEASE_SECONDS = 300;

export function leaseMilliseconds(configuredSeconds) {
  const configured = Number(configuredSeconds);
  const seconds = Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_LEASE_SECONDS;
  return Math.min(
    MAXIMUM_LEASE_SECONDS,
    Math.max(MINIMUM_LEASE_SECONDS, seconds),
  ) * 1000;
}

export function heartbeatMilliseconds(leaseMs) {
  if (!Number.isSafeInteger(leaseMs)
      || leaseMs < MINIMUM_LEASE_SECONDS * 1000
      || leaseMs > MAXIMUM_LEASE_SECONDS * 1000)
    throw new Error('Synchronization Service returned an invalid lease duration');
  return Math.max(1000, Math.floor(leaseMs / 3));
}

export function validate(value) {
  const id = value?.['session-id'];
  const leaseMs = Number(value?.['lease-ms']);
  const expiresAt = Number(value?.['expires-at']);
  if (!isUuid(id)
      || !Number.isSafeInteger(leaseMs)
      || leaseMs < MINIMUM_LEASE_SECONDS * 1000
      || leaseMs > MAXIMUM_LEASE_SECONDS * 1000
      || !Number.isSafeInteger(expiresAt)
      || expiresAt <= 0)
    throw new Error('Synchronization Service returned an invalid client session');
  return {id, leaseMs, expiresAt};
}
