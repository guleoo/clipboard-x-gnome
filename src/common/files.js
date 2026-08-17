import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function loadFile(file, cancellable = null) {
  return new Promise((resolve, reject) => {
    file.load_contents_async(cancellable, (source, result) => {
      try {
        const [ok, contents] = source.load_contents_finish(result);
        if (!ok)
          throw new Error(`Unable to read ${source.get_uri()}`);
        resolve(new GLib.Bytes(contents));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function writeFile(file, bytes, cancellable = null) {
  return new Promise((resolve, reject) => {
    file.replace_contents_async(
      bytes.get_data(),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      cancellable,
      (source, result) => {
        try {
          const [ok] = source.replace_contents_finish(result);
          if (!ok)
            throw new Error(`Unable to write ${source.get_uri()}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
