import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {check, dependency, file} from '../../src/sync/http/file-verifier.js';
import {message} from '../../src/sync/errors.js';

function assert(value, text) {
  if (!value) throw new Error(text);
}

async function rejects(operation, code) {
  let error;
  try { await operation(); } catch (caught) { error = caught; }
  assert(error && (code === 'cancelled'
    ? error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) : error.code === code),
  `expected ${code}, got ${error?.message ?? 'success'}`);
}

const directory = GLib.dir_make_tmp('cbx-file-verifier-XXXXXX');
const input = Gio.File.new_for_path(`${directory}/中文 space\ninput`);
const program = Gio.File.new_for_path(`${directory}/verifier`);
const pidFile = Gio.File.new_for_path(`${directory}/child.pid`);
const originalPath = GLib.getenv('PATH');

function fakeProgram(body) {
  program.replace_contents(`#!/bin/sh\n${body}\n`, null, false, Gio.FileCreateFlags.PRIVATE, null);
  program.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
}

try {
  await check();
  const content = new TextEncoder().encode('中文\nBinary\u0000content');
  input.replace_contents(content, null, false, Gio.FileCreateFlags.PRIVATE, null);
  const digest = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, new GLib.Bytes(content));
  assert(await file(input.get_path()) === digest, 'native stdin must support binary data and unusual filenames');

  GLib.setenv('PATH', directory, true);
  await rejects(() => check(), 'file_verifier_unavailable');
  assert(message({code: 'file_verifier_unavailable'}, text => `translated:${text}`).startsWith('translated:Install'),
    'missing dependency must have a localized installation hint');
  GLib.setenv('PATH', originalPath, true);

  for (const body of ['exit 7', 'printf invalid', 'exit 0', 'kill -TERM $$',
    `printf '%s  -\\n' '${'0'.repeat(64)}'; exit 7`,
    "printf '%0200d' 0"]) {
    fakeProgram(body);
    await rejects(() => file(input.get_path(), {program: program.get_path()}), 'file_verification_failed');
  }
  fakeProgram('exit 0');
  program.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
  await rejects(() => file(input.get_path(), {program: program.get_path()}), 'file_verifier_unavailable');

  // A cancellable read/wait must also terminate and reap the child before rejecting.
  fakeProgram(`printf '%s' "$$" > '${pidFile.get_path()}'\nwhile :; do :; done`);
  const cancellable = new Gio.Cancellable();
  const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
    if (!pidFile.query_exists(null)) return GLib.SOURCE_CONTINUE;
    cancellable.cancel();
    return GLib.SOURCE_REMOVE;
  });
  try {
    await rejects(() => file(input.get_path(), {program: program.get_path(), cancellable}), 'cancelled');
  } catch (error) {
    if (!cancellable.is_cancelled()) GLib.Source.remove(timer);
    throw error;
  }
  const [, pid] = pidFile.load_contents(null);
  assert(!Gio.File.new_for_path(`/proc/${new TextDecoder().decode(pid)}`).query_exists(null),
    'cancelled verifier must not leave a live child or zombie process');

  const alreadyCancelled = new Gio.Cancellable();
  alreadyCancelled.cancel();
  await rejects(() => file(input.get_path(), {cancellable: alreadyCancelled}), 'cancelled');
  assert(GLib.path_is_absolute(dependency()), 'dependency lookup must resolve the executable path');
} finally {
  GLib.setenv('PATH', originalPath, true);
  for (const entry of [input, program, pidFile]) {
    try { entry.delete(null); } catch (_error) { /* Not every test creates every fixture. */ }
  }
  Gio.File.new_for_path(directory).delete(null);
}
