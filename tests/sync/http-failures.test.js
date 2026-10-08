import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {HttpClient} from '../../src/sync/http/client.js';
import {HttpFixture} from './integration/fixture.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const size = 2 * 1024 * 1024;
const bytes = new GLib.Bytes(Uint8Array.from({length: size}, (_, index) => (index * 31) % 256));
const digest = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
const directory = GLib.dir_make_tmp('cbx-http-failures-XXXXXX');
const targetPath = GLib.build_filenamev([directory, 'target.bin']);
const target = Gio.File.new_for_path(targetPath);
const fixture = new HttpFixture();
const fakeVerifier = Gio.File.new_for_path(`${directory}/sha256sum`);
const childPid = Gio.File.new_for_path(`${directory}/child.pid`);
let client;

function assertPreservedTarget() {
  const [, previous] = target.load_contents(null);
  assert(new TextDecoder().decode(previous) === 'previous target', 'failure must preserve the previous target');
  const entries = Gio.File.new_for_path(directory).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
  try {
    let info;
    while ((info = entries.next_file(null)))
      assert(!info.get_name().endsWith('.part'), 'failure must remove temporary files');
  } finally { entries.close(null); }
}

async function upload(path, options = {}) {
  const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
  try {
    return await client.upload(path, {stream, size, mimeType: 'application/octet-stream', ...options});
  } finally { stream.close(null); }
}

try {
  const address = await fixture.start();
  client = new HttpClient({serverAddress: address, apiKey: 'stress-key', deviceId: 'stress-device'});
  await upload('/content');
  const options = {maximumBytes: size, expectedBytes: size, expectedSha256: digest};
  const observedStages = [];
  const observerResult = await client.download('/content', targetPath, {
    ...options, useSha256sum: true,
    diagnostics: {stage(name) {
      observedStages.push(name);
      throw new Error('deliberately broken optional observer');
    }},
  });
  assert(observerResult.sha256 === digest && observedStages.includes('cleanup')
      && observedStages.includes('close-verifier'),
    'observer errors must not change a verified download or bypass cleanup');
  for (const useSha256sum of [false, true]) {
    for (const [path, expectedCode] of [['/drop', null], ['/corrupt', 'hash_mismatch'], ['/content', 'cancelled']]) {
      target.replace_contents('previous target', null, false, Gio.FileCreateFlags.PRIVATE, null);
      const cancellable = new Gio.Cancellable();
      let error;
      try {
        await client.download(path, targetPath, {...options, useSha256sum, cancellable,
          diagnostics: {stage() { throw new Error('broken failure observer'); }},
          onProgress: count => {
            if (expectedCode === 'cancelled' && count >= 256 * 1024)
              cancellable.cancel();
          },
        });
      } catch (caught) { error = caught; }
      assert(error, `${path}: injected failure must reject the download`);
      if (expectedCode === 'cancelled')
        assert(error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED), 'cancellation must remain recognizable');
      else if (expectedCode)
        assert(error.code === expectedCode, 'corruption must fail checksum verification');
      assertPreservedTarget();
      const recovered = await client.download('/content', targetPath, {...options, useSha256sum});
      assert(recovered.sha256 === digest, 'retry after each download failure must succeed');
    }
  }
  for (const [path, expectedCode] of [['/no-length', 'invalid_response'], ['/chunked', 'invalid_response'],
    ['/compressed', 'invalid_response'], ['/oversized', 'invalid_content_size']]) {
    target.replace_contents('previous target', null, false, Gio.FileCreateFlags.PRIVATE, null);
    let error;
    try { await client.download(path, targetPath, {...options, useSha256sum: true}); }
    catch (caught) { error = caught; }
    assert(error?.code === expectedCode, `${path}: unsafe framing must reject before native streaming`);
    assertPreservedTarget();
  }
  // A dishonest HTTP/1 peer cannot make native splice consume bytes past Content-Length.
  const prefixSize = 64 * 1024;
  const prefixDigest = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256,
    GLib.Bytes.new_from_bytes(bytes, 0, prefixSize));
  const bounded = await client.download('/excess', targetPath, {
    maximumBytes: prefixSize, expectedBytes: prefixSize, expectedSha256: prefixDigest, useSha256sum: true,
  });
  assert(bounded.size === prefixSize && target.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)
    .get_size() === prefixSize, 'HTTP/1 framing must bound the persisted file even if the peer sends excess bytes');
  client.abort();
  client = new HttpClient({serverAddress: address, apiKey: 'stress-key', deviceId: 'stress-device'});
  await upload('/content');
  // Cancellation after transfer, before hashing, must not replace the old target.
  target.replace_contents('previous target', null, false, Gio.FileCreateFlags.PRIVATE, null);
  const verificationCancellation = new Gio.Cancellable();
  let verificationError;
  try {
    await client.download('/content', targetPath, {...options, useSha256sum: true,
      cancellable: verificationCancellation, onVerifying: () => verificationCancellation.cancel()});
  } catch (error) { verificationError = error; }
  assert(verificationError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
    'cancelling the verification phase must reject the transfer');
  assertPreservedTarget();
  let abortError;
  try {
    await client.download('/content', targetPath, {...options, useSha256sum: true,
      onVerifying: () => client.abort()});
  } catch (error) { abortError = error; }
  assert(abortError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
    'client abort must stop verification even without a caller-supplied cancellable');
  assert(client._fileDownloads.size === 0, 'completed or cancelled operations must release their abort metadata');
  assertPreservedTarget();
  const oldPath = GLib.getenv('PATH');
  GLib.setenv('PATH', directory, true);
  let dependencyError;
  try { await client.download('/content', targetPath, {...options, useSha256sum: true}); }
  catch (error) { dependencyError = error; }
  finally { GLib.setenv('PATH', oldPath, true); }
  assert(dependencyError?.code === 'file_verifier_unavailable', 'a removed dependency must fail, never bypass verification');
  assertPreservedTarget();
  for (const [body, code] of [['exit 9', 'file_verification_failed'],
    [`printf '%s  -\\n' '${'0'.repeat(64)}'`, 'hash_mismatch']]) {
    fakeVerifier.replace_contents(`#!/bin/sh\n${body}\n`, null, false, Gio.FileCreateFlags.PRIVATE, null);
    fakeVerifier.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
    GLib.setenv('PATH', directory, true);
    let error;
    try { await client.download('/content', targetPath, {...options, useSha256sum: true}); }
    catch (caught) { error = caught; }
    finally { GLib.setenv('PATH', oldPath, true); }
    assert(error?.code === code, 'verifier failure must reject the entire download');
    assertPreservedTarget();
  }
  fakeVerifier.replace_contents(`#!/bin/sh\nprintf '%s\\n' "$$" > '${childPid.get_path()}'\nwhile :; do :; done\n`,
    null, false, Gio.FileCreateFlags.PRIVATE, null);
  fakeVerifier.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
  const hashCancellation = new Gio.Cancellable();
  let verifierPid = null;
  const hashTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
    if (!childPid.query_exists(null)) return GLib.SOURCE_CONTINUE;
    const [, bytes] = childPid.load_contents(null);
    const publishedPid = new TextDecoder().decode(bytes);
    // File creation precedes writing; the newline marks a complete PID.
    if (!/^[1-9][0-9]*\n$/.test(publishedPid)) return GLib.SOURCE_CONTINUE;
    verifierPid = publishedPid.slice(0, -1);
    hashCancellation.cancel();
    return GLib.SOURCE_REMOVE;
  });
  GLib.setenv('PATH', directory, true);
  let hashError;
  try {
    await client.download('/content', targetPath, {...options, useSha256sum: true, cancellable: hashCancellation});
  } catch (error) { hashError = error; }
  finally {
    GLib.setenv('PATH', oldPath, true);
    if (!hashCancellation.is_cancelled()) GLib.Source.remove(hashTimer);
  }
  assert(hashError?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED), 'hashing in progress must be cancellable');
  assert(verifierPid !== null, 'hashing must only be cancelled after a complete PID is published');
  assert(!Gio.File.new_for_path(`/proc/${verifierPid}`).query_exists(null),
    'download cancellation must reap the verifier before cleaning its temporary file');
  assertPreservedTarget();
  let rejected;
  try { await upload('/reject'); } catch (error) { rejected = error; }
  assert(rejected?.status === 503 && rejected.code === 'temporarily_unavailable',
    'a fully sent upload must still reject a server failure');
  const cancellable = new Gio.Cancellable();
  let cancelled;
  try {
    await upload('/content', {cancellable, onProgress: count => {
      if (count >= 256 * 1024)
        cancellable.cancel();
    }});
  } catch (error) { cancelled = error; }
  assert(cancelled?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
    'real HTTP uploads must honor cancellation');
  const recovered = await upload('/content');
  assert(recovered.size === size && recovered.sha256 === digest, 'upload retry must send all source bytes');
  const empty = Gio.MemoryInputStream.new();
  try { await client.upload('/content', {stream: empty, size: 0, mimeType: 'application/octet-stream'}); }
  finally { empty.close(null); }
  const emptyResult = await client.download('/content', targetPath, {
    maximumBytes: 0, expectedBytes: 0,
    expectedSha256: GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, new GLib.Bytes([])),
    useSha256sum: true,
  });
  assert(emptyResult.size === 0, 'an explicitly framed zero-length file must be accepted');
} finally {
  client?.abort();
  try { await fixture.close(); } finally {
    try { target.delete(null); } catch (_error) {}
    try { fakeVerifier.delete(null); } catch (_error) {}
    try { childPid.delete(null); } catch (_error) {}
    Gio.File.new_for_path(directory).delete(null);
  }
}
