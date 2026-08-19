import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|webp)$/iu;

export function resolveDirectory(value, homeDirectory = GLib.get_home_dir()) {
  const configured = value?.trim();
  if (!configured)
    throw new Error('The screenshot directory is empty');
  let path = configured;
  if (configured === '~')
    path = homeDirectory;
  else if (configured.startsWith('~/'))
    path = GLib.build_filenamev([homeDirectory, configured.slice(2)]);
  else if (configured.startsWith('~'))
    throw new Error('Only the current user home shortcut ~/ is supported');
  if (!GLib.path_is_absolute(path))
    throw new Error('The screenshot directory must be an absolute path');
  return GLib.canonicalize_filename(path, null);
}

export async function save(uri, configuredDirectory, cancellable = null) {
  const source = Gio.File.new_for_uri(uri);
  if (!source.is_native())
    throw new Error('Screenshot Portal returned a non-local URI');
  const directoryPath = resolveDirectory(configuredDirectory);
  if (GLib.mkdir_with_parents(directoryPath, 0o755) !== 0)
    throw new Error(`Unable to create screenshot directory: ${directoryPath}`);
  const directory = Gio.File.new_for_path(directoryPath);
  const extension = source.get_basename().match(IMAGE_EXTENSION_PATTERN)?.[0].toLowerCase() ?? '.png';
  const timestamp = GLib.DateTime.new_now_local().format('%Y-%m-%d_%H-%M-%S');
  const suffix = GLib.uuid_string_random().slice(0, 8);
  const target = directory.get_child(`Screenshot_${timestamp}_${suffix}${extension}`);
  await copy(source, target, cancellable);
  return target.get_uri();
}

function copy(source, target, cancellable) {
  return new Promise((resolve, reject) => {
    source.copy_async(
      target,
      Gio.FileCopyFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      null,
      (file, result) => {
        try {
          file.copy_finish(result);
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
