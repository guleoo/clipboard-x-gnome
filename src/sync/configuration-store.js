import {dataPath, readJson, writeJson} from '../common/data-store.js';
import {isUuid} from '../common/uuid.js';
import {apiKey, serverAddress} from './configuration.js';

const CONNECTION_FILE_VERSION = 1;
const PROGRESS_FILE_VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024;

export function syncConfigurationPath() {
  return dataPath('sync.json');
}

export function syncProgressPath() {
  return dataPath('sync-state.json');
}

export class SyncConfigurationStore {
  constructor({path = syncConfigurationPath(), progressPath = syncProgressPath()} = {}) {
    this.path = path;
    this.progressPath = progressPath;
    this.exists = false;
    this._configuration = emptyConfiguration();
  }

  get current() {
    return {...this._configuration, cursors: {...this._configuration.cursors}};
  }

  async load() {
    const [connectionDocument, progressDocument] = await Promise.all([
      readJson(this.path, MAX_FILE_BYTES),
      readJson(this.progressPath, MAX_FILE_BYTES),
    ]);
    if (connectionDocument !== null && connectionDocument.version !== CONNECTION_FILE_VERSION)
      throw new Error('Synchronization configuration file has an invalid structure');
    if (progressDocument !== null && progressDocument.version !== PROGRESS_FILE_VERSION)
      throw new Error('Synchronization progress file has an invalid structure');
    this.exists = connectionDocument !== null;
    this._configuration = {
      ...validateConnection(connectionDocument ?? {}),
      ...validateProgress(progressDocument ?? {}),
    };
    return this.current;
  }

  save(value) {
    return this.saveConnection(value);
  }

  async saveConnection(value) {
    const connection = validateConnection(value);
    await writeJson(
      this.path,
      {version: CONNECTION_FILE_VERSION, ...connection},
      {restrictAccess: false},
    );
    this._configuration = {...this._configuration, ...connection};
    this.exists = true;
    return this.current;
  }

  async saveProgress(value) {
    const progress = validateProgress(value);
    const previous = this._configuration;
    const cursors = Object.entries(progress.cursors);
    if (progress.workCursor === previous.workCursor
        && cursors.length === Object.keys(previous.cursors).length
        && cursors.every(([channelId, cursor]) => previous.cursors[channelId] === cursor))
      return this.current;
    await writeJson(
      this.progressPath,
      {version: PROGRESS_FILE_VERSION, ...progress},
    );
    this._configuration = {...this._configuration, ...progress};
    return this.current;
  }
}

function validateConnection(value) {
  const address = String(value.serverAddress ?? '').trim();
  const key = apiKey(value.apiKey ?? '', {allowEmpty: true});
  const activeChannelId = String(value.activeChannelId ?? '').trim();
  if (address)
    serverAddress(address);
  if (activeChannelId && !isUuid(activeChannelId))
    throw new Error('Synchronization channel ID is invalid');
  return {serverAddress: address, apiKey: key, activeChannelId};
}

function validateProgress(value) {
  return {
    cursors: validateCursors(value.cursors ?? {}),
    workCursor: validateCursor(value.workCursor ?? ''),
  };
}

function emptyConfiguration() {
  return {
    serverAddress: '',
    apiKey: '',
    activeChannelId: '',
    cursors: {},
    workCursor: '',
  };
}

function validateCursors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length > 100)
    throw new Error('Synchronization cursors are invalid');
  const result = {};
  for (const [channelId, cursor] of Object.entries(value)) {
    if (!isUuid(channelId))
      throw new Error('Synchronization cursor has an invalid channel ID');
    result[channelId] = validateCursor(cursor);
  }
  return result;
}

function validateCursor(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\r\n\0]/u.test(value))
    throw new Error('Synchronization cursor is invalid');
  return value;
}
