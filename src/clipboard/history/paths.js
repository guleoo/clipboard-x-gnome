import GLib from 'gi://GLib';

import {UUID} from '../../entry/constants.js';
import {isUuid} from '../../common/uuid.js';

export function rootPath() {
  return GLib.build_filenamev([GLib.get_user_data_dir(), 'clipboard-x', 'history']);
}

export function legacyRootPath() {
  return GLib.build_filenamev([GLib.get_user_cache_dir(), UUID]);
}

export function devicePaths(deviceId, root = rootPath()) {
  if (!isUuid(deviceId))
    throw new Error('History device ID must be a UUID v4');
  const directory = GLib.build_filenamev([root, deviceId]);
  return Object.freeze({
    directory,
    index: GLib.build_filenamev([directory, 'history.json']),
    objects: GLib.build_filenamev([directory, 'objects']),
    previews: GLib.build_filenamev([directory, 'previews']),
  });
}
