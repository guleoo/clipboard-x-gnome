import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncError} from '../errors.js';
import {file as verifyFile} from './file-verifier.js';

Gio._promisify(Gio.OutputStream.prototype, 'splice_async', 'splice_finish');
Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');

// The caller must provide a bounded, uncompressed Content-Length response stream.
export async function download(input, targetPath, {
  size, expectedSha256, program, cancellable, onProgress, onVerifying,
}) {
  let temporary = null;
  let output = null;
  let timer = 0;
  let pendingQuery = null;
  let progressError = null;
  let reportedBytes = 0;
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(targetPath), 0o700);
    temporary = Gio.File.new_for_path(`${targetPath}.${GLib.uuid_string_random()}.part`);
    output = temporary.create(Gio.FileCreateFlags.PRIVATE, cancellable);
    if (onProgress) {
      timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        if (!pendingQuery) {
          pendingQuery = temporary.query_info_async('standard::size', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable).then(info => {
            const count = info.get_size();
            if (count > size)
              throw new SyncError('too_large', 'Native download exceeded Content-Length');
            reportedBytes = Math.max(reportedBytes, count);
            onProgress(reportedBytes, size);
          }).catch(error => { progressError = error; }).finally(() => { pendingQuery = null; });
        }
        return GLib.SOURCE_CONTINUE;
      });
    }
    let completedBytes;
    try {
      completedBytes = await output.splice_async(input, Gio.OutputStreamSpliceFlags.NONE,
        GLib.PRIORITY_DEFAULT, cancellable);
    } finally {
      if (timer) {
        GLib.Source.remove(timer);
        timer = 0;
      }
      await pendingQuery;
    }
    if (progressError)
      throw progressError;
    await output.close_async(GLib.PRIORITY_DEFAULT, cancellable);
    await input.close_async(GLib.PRIORITY_DEFAULT, cancellable);
    if (completedBytes !== size)
      throw new SyncError('size_mismatch', 'Native download did not match Content-Length');
    onProgress?.(completedBytes, size);
    onVerifying?.();
    const actualSha256 = await verifyFile(temporary.get_path(), {program, cancellable});
    if (expectedSha256 && actualSha256 !== expectedSha256)
      throw new SyncError('hash_mismatch', 'Downloaded file did not match its manifest digest');
    cancellable?.set_error_if_cancelled();
    temporary.move(Gio.File.new_for_path(targetPath), Gio.FileCopyFlags.OVERWRITE, cancellable, null);
    return {path: targetPath, size: completedBytes, sha256: actualSha256};
  } finally {
    if (timer)
      GLib.Source.remove(timer);
    await pendingQuery;
    for (const stream of [output, input]) {
      if (stream && !stream.is_closed()) {
        try { await stream.close_async(GLib.PRIORITY_DEFAULT, null); } catch (_error) { /* Preserve transfer error. */ }
      }
    }
    if (temporary) {
      try { temporary.delete(null); } catch (_error) { /* Moved successfully or not created. */ }
    }
  }
}
