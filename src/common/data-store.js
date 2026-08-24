import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {bytesFromString, stringFromBytes} from './bytes.js';
import {loadFile, writeFile} from './files.js';

const FILE_ATTRIBUTES = [
  Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
  Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
  Gio.FILE_ATTRIBUTE_STANDARD_IS_SYMLINK,
].join(',');

export function dataPath(filename) {
  return GLib.build_filenamev([GLib.get_user_data_dir(), 'clipboard-x', filename]);
}

export async function readJson(path, maximumBytes, cancellable = null) {
  const file = Gio.File.new_for_path(path);
  let info;
  try {
    info = await queryInfo(file, cancellable);
  } catch (error) {
    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
      return null;
    throw error;
  }
  if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_is_symlink())
    throw new Error('Clipboard X data file is not a regular file');
  if (info.get_size() > maximumBytes)
    throw new Error(`Clipboard X data file exceeds ${maximumBytes} bytes`);
  return JSON.parse(stringFromBytes(await loadFile(file, cancellable)));
}

export async function writeJson(path, value, {
  cancellable = null,
  restrictAccess = true,
} = {}) {
  const directoryPath = GLib.path_get_dirname(path);
  ensureDirectory(directoryPath, restrictAccess);
  const file = Gio.File.new_for_path(path);
  try {
    const info = await queryInfo(file, cancellable);
    if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_is_symlink())
      throw new Error('Clipboard X data file is not a regular file');
  } catch (error) {
    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
      throw error;
  }
  await writeFile(file, bytesFromString(`${JSON.stringify(value, null, 2)}\n`), cancellable);
  if (restrictAccess) {
    file.set_attribute_uint32(
      Gio.FILE_ATTRIBUTE_UNIX_MODE,
      0o600,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      cancellable,
    );
  }
}

function ensureDirectory(path, restrictAccess) {
  GLib.mkdir_with_parents(path, restrictAccess ? 0o700 : 0o755);
  if (restrictAccess) {
    Gio.File.new_for_path(path).set_attribute_uint32(
      Gio.FILE_ATTRIBUTE_UNIX_MODE,
      0o700,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
  }
}

function queryInfo(file, cancellable) {
  return new Promise((resolve, reject) => {
    file.query_info_async(
      FILE_ATTRIBUTES,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          resolve(source.query_info_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
