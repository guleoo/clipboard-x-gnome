import GLib from 'gi://GLib';

import {bytesFromString, sha256} from '../common/bytes.js';
import {dataPath, readJson, writeJson} from '../common/data-store.js';
import {isUuid} from '../common/uuid.js';
import {normalizeServerAddress} from './http/client.js';

const VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024;

// Progress belongs to a server/device pair, never to editable connection settings.
export class SyncProgressStore {
  constructor({directory = dataPath('sync-progress')} = {}) {
    this._directory = directory;
    this._saved = new Map();
    this._chain = Promise.resolve();
  }

  load(scope) {
    const destination = this._destination(scope);
    return this._serialize(async () => copy(await this._load(destination)));
  }

  save(scope, value) {
    const destination = this._destination(scope);
    const progress = validate(value);
    return this._serialize(async () => {
      const previous = await this._load(destination);
      const entries = Object.entries(progress.cursors);
      if (progress.workCursor !== previous.workCursor
          || entries.length !== Object.keys(previous.cursors).length
          || entries.some(([channel, cursor]) => previous.cursors[channel] !== cursor)) {
        await writeJson(destination.path, {version: VERSION, ...destination.identity, ...progress});
        this._saved.set(destination.path, progress);
      }
      return copy(progress);
    });
  }

  _destination({serverAddress, deviceId}) {
    if (!isUuid(deviceId))
      throw new Error('Synchronization progress requires a UUID device ID');
    const identity = {serverAddress: normalizeServerAddress(serverAddress), deviceId};
    const key = sha256(bytesFromString(JSON.stringify(identity)));
    return {identity, path: GLib.build_filenamev([this._directory, `${key}.json`])};
  }

  async _load({path, identity}) {
    if (!this._saved.has(path)) {
      const document = await readJson(path, MAX_FILE_BYTES);
      if (document && (document.version !== VERSION
          || document.serverAddress !== identity.serverAddress || document.deviceId !== identity.deviceId))
        throw new Error('Synchronization progress has an invalid destination or version');
      this._saved.set(path, validate(document ?? {}));
    }
    return this._saved.get(path);
  }

  _serialize(action) {
    const result = this._chain.then(action);
    this._chain = result.catch(() => {});
    return result;
  }
}

function copy(value) {
  return {...value, cursors: {...value.cursors}};
}

function validate(value) {
  const cursors = value.cursors ?? {};
  if (!cursors || typeof cursors !== 'object' || Array.isArray(cursors)
      || Object.keys(cursors).length > 100)
    throw new Error('Synchronization cursors are invalid');
  const result = {};
  for (const [channelId, cursor] of Object.entries(cursors)) {
    if (!isUuid(channelId))
      throw new Error('Synchronization cursor has an invalid channel ID');
    result[channelId] = validateCursor(cursor);
  }
  return {cursors: result, workCursor: validateCursor(value.workCursor ?? '')};
}

function validateCursor(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\r\n\0]/u.test(value))
    throw new Error('Synchronization cursor is invalid');
  return value;
}
