import {isUuid} from '../common/uuid.js';

const MAX_SERVER_ADDRESS_LENGTH = 2048;
const MAX_API_KEY_LENGTH = 4096;
const MAX_CHANNEL_NAME_LENGTH = 256;
const CONTROL_CHARACTERS = /[\0\r\n]/u;

export function serverAddress(value) {
  const address = String(value ?? '').trim();
  if (!address || address.length > MAX_SERVER_ADDRESS_LENGTH || CONTROL_CHARACTERS.test(address))
    throw new Error('Synchronization server address is invalid');
  return address;
}

export function configuration(rawValue) {
  const value = rawValue ?? {};
  const configuredAddress = String(value['server-address'] ?? '').trim();
  const activeChannelId = String(value['active-channel-id'] ?? '').trim();
  const activeChannelName = text(value['active-channel-name'] ?? '', MAX_CHANNEL_NAME_LENGTH);
  if ((configuredAddress && serverAddress(configuredAddress) !== configuredAddress)
      || typeof value['api-key-configured'] !== 'boolean'
      || (activeChannelId && !isUuid(activeChannelId)))
    throw new Error('Synchronization Service returned invalid connection configuration');
  return {
    serverAddress: configuredAddress,
    apiKeyConfigured: value['api-key-configured'],
    activeChannelId,
    activeChannelName,
  };
}

export function configurationChanges(value) {
  const changes = {};
  if (Object.hasOwn(value, 'serverAddress'))
    changes['server-address'] = serverAddress(value.serverAddress);
  if (Object.hasOwn(value, 'apiKey')) {
    const apiKey = String(value.apiKey ?? '').trim();
    if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH || CONTROL_CHARACTERS.test(apiKey))
      throw new Error('Synchronization API key is invalid');
    changes['api-key'] = apiKey;
  }
  if (Object.hasOwn(value, 'clearApiKey')) {
    if (typeof value.clearApiKey !== 'boolean')
      throw new Error('Synchronization API key clear flag is invalid');
    changes['clear-api-key'] = value.clearApiKey;
  }
  if (Object.hasOwn(value, 'activeChannelId')) {
    const channelId = String(value.activeChannelId ?? '').trim();
    if (channelId && !isUuid(channelId))
      throw new Error('Synchronization channel ID is invalid');
    changes['active-channel-id'] = channelId;
  }
  if (Object.keys(changes).length === 0)
    throw new Error('Synchronization configuration update is empty');
  return changes;
}

export function channel(rawValue) {
  const value = rawValue ?? {};
  const id = String(value.id ?? '').trim();
  const name = text(value.name ?? '', MAX_CHANNEL_NAME_LENGTH);
  if (!isUuid(id) || !name || typeof value.active !== 'boolean')
    throw new Error('Synchronization Service returned invalid channel metadata');
  return {id, name, active: value.active};
}

export function connectionResult(rawValue) {
  const value = rawValue ?? {};
  const state = text(value.state ?? '', 32);
  const latencyMs = Number(value['latency-ms']);
  if (!['online', 'offline', 'error'].includes(state)
      || !Number.isSafeInteger(latencyMs) || latencyMs < 0)
    throw new Error('Synchronization Service returned invalid connection test result');
  return {
    state,
    latencyMs,
    serverVersion: text(value['server-version'] ?? '', 128),
    message: text(value.message ?? '', 512),
  };
}

function text(value, maximumLength) {
  if (typeof value !== 'string')
    throw new Error('Synchronization Service returned a non-string configuration value');
  if (CONTROL_CHARACTERS.test(value))
    throw new Error('Synchronization Service returned invalid configuration text');
  return value.slice(0, maximumLength);
}
