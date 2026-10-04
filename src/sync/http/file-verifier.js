import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncError} from '../errors.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const OUTPUT_LIMIT_BYTES = 128;

Gio._promisify(Gio.Subprocess.prototype, 'wait_async', 'wait_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

export function dependency() {
  const program = GLib.find_program_in_path('sha256sum');
  if (!program)
    throw new SyncError('file_verifier_unavailable', 'sha256sum was not found in PATH');
  return program;
}

export async function check(cancellable = null) {
  const digest = await run(dependency(), null, cancellable);
  if (digest !== EMPTY_SHA256)
    throw new SyncError('file_verification_failed', 'sha256sum failed the empty-input check');
}

export function file(path, {program = dependency(), cancellable = null} = {}) {
  return run(program, path, cancellable);
}

async function run(program, path, cancellable) {
  cancellable?.set_error_if_cancelled();
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
  });
  launcher.setenv('LC_ALL', 'C', true);
  // No shell, filename arguments or implementation-specific command options.
  // The child reads the file through its native stdin, in bounded chunks.
  if (path !== null)
    launcher.set_stdin_file_path(path);
  let process;
  try {
    process = launcher.spawnv([program]);
  } catch (error) {
    throw new SyncError('file_verifier_unavailable', 'Could not start sha256sum', {cause: error});
  } finally {
    launcher.close();
  }
  const signal = cancellable?.connect(() => process.force_exit());
  const stdout = process.get_stdout_pipe();
  let succeeded = false;
  try {
    cancellable?.set_error_if_cancelled();
    let text = '';
    let size = 0;
    while (true) {
      const bytes = await stdout.read_bytes_async(OUTPUT_LIMIT_BYTES, GLib.PRIORITY_DEFAULT, cancellable);
      if (bytes.get_size() === 0)
        break;
      size += bytes.get_size();
      if (size > OUTPUT_LIMIT_BYTES)
        throw new SyncError('file_verification_failed', 'sha256sum output exceeded its limit');
      text += new TextDecoder().decode(bytes.get_data());
    }
    await process.wait_async(cancellable);
    cancellable?.set_error_if_cancelled();
    const match = /^([a-f0-9]{64})[ \t]+\*?-\r?\n?$/.exec(text);
    if (!process.get_successful() || !match)
      throw new SyncError('file_verification_failed', 'sha256sum returned an invalid digest or exit status');
    succeeded = true;
    return match[1];
  } catch (error) {
    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) || error instanceof SyncError)
      throw error;
    throw new SyncError('file_verification_failed', 'Could not read the sha256sum result', {cause: error});
  } finally {
    if (signal)
      cancellable.disconnect(signal);
    if (!succeeded)
      process.force_exit();
    // Cancelling pipe reads/waits alone does not terminate a child process.
    await process.wait_async(null);
    stdout.close(null);
  }
}
