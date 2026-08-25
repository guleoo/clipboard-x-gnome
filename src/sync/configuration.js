import {isUuid} from '../common/uuid.js';
import {normalizeServerAddress} from './http/client.js';

const MAX_SERVER_ADDRESS_LENGTH = 2048;
const MAX_API_KEY_LENGTH = 4096;
const MAX_CHANNEL_NAME_LENGTH = 256;
const CONTROL_CHARACTERS = /[\0\r\n]/u;

export function serverAddress(value) {
  const address = String(value ?? '').trim();
  if (!address || address.length > MAX_SERVER_ADDRESS_LENGTH || CONTROL_CHARACTERS.test(address))
    throw new Error('Synchronization server address is invalid');
  normalizeServerAddress(address);
  return address;
}

export function apiKey(value, {allowEmpty = false} = {}) {
  const key = String(value ?? '').trim();
  if ((!allowEmpty && !key) || key.length > MAX_API_KEY_LENGTH || CONTROL_CHARACTERS.test(key))
    throw new Error('Synchronization API key is invalid');
  return key;
}

export function configuration(rawValue, activeChannelName = '') {
  const value = rawValue ?? {};
  const configuredAddress = String(value.serverAddress ?? '').trim();
  const activeChannelId = String(value.activeChannelId ?? '').trim();
  if ((configuredAddress && serverAddress(configuredAddress) !== configuredAddress)
      || (activeChannelId && !isUuid(activeChannelId)))
    throw new Error('Synchronization configuration is invalid');
  return {
    serverAddress: configuredAddress,
    apiKeyConfigured: Boolean(value.apiKey),
    activeChannelId,
    activeChannelName: text(activeChannelName, MAX_CHANNEL_NAME_LENGTH),
  };
}

function text(value, maximumLength) {
  if (typeof value !== 'string')
    throw new Error('Synchronization server returned a non-string configuration value');
  if (CONTROL_CHARACTERS.test(value))
    throw new Error('Synchronization server returned invalid configuration text');
  return value.slice(0, maximumLength);
}
