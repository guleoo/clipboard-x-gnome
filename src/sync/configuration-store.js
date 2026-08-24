import {dataPath, readJson, writeJson} from '../common/data-store.js';
import {isUuid} from '../common/uuid.js';
import {apiKey, serverAddress} from './configuration.js';

const FILE_VERSION = 1;
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
    const document = await readJson(this.path, MAX_FILE_BYTES);
    if (document === null) {
      this.exists = false;
      this._configuration = emptyConfiguration();
      return this.current;
    }
    if (!document || document.version !== FILE_VERSION)
      throw new Error('Synchronization configuration file has an invalid structure');
    this._configuration = validate(document);
    this.exists = true;
    return this.current;
  }

  async save(value) {
    const configuration = validate(value);
    await writeJson(
      this.path,
      {version: FILE_VERSION, ...configuration},
      {restrictAccess: false},
    );
    this._configuration = configuration;
    this.exists = true;
    return this.current;
  }
}

function validate(value) {
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
  return {serverAddress: '', apiKey: '', activeChannelId: ''};
}
