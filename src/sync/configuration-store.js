import {dataPath, readJson, writeJson} from '../common/data-store.js';
import {isUuid} from '../common/uuid.js';
import {apiKey, serverAddress} from './configuration.js';

const CONNECTION_FILE_VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024;

export function syncConfigurationPath() {
  return dataPath('sync.json');
}

export class SyncConfigurationStore {
  constructor({path = syncConfigurationPath()} = {}) {
    this.path = path;
    this.exists = false;
    this._configuration = emptyConfiguration();
  }

  get current() {
    return {...this._configuration};
  }

  async load() {
    const connectionDocument = await readJson(this.path, MAX_FILE_BYTES);
    if (connectionDocument !== null && connectionDocument.version !== CONNECTION_FILE_VERSION)
      throw new Error('Synchronization configuration file has an invalid structure');
    this.exists = connectionDocument !== null;
    this._configuration = validateConnection(connectionDocument ?? {});
    return this.current;
  }

  async saveConnection(value) {
    const connection = validateConnection(value);
    await writeJson(
      this.path,
      {version: CONNECTION_FILE_VERSION, ...connection},
      {restrictAccess: false},
    );
    this._configuration = connection;
    this.exists = true;
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

function emptyConfiguration() {
  return {
    serverAddress: '',
    apiKey: '',
    activeChannelId: '',
  };
}
