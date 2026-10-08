import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {HttpClient} from '../../src/sync/http/client.js';
import {HttpTransport} from '../../src/sync/http/transport.js';
import {HttpFixture} from './integration/fixture.js';
import {assertProgress, measure} from './integration/measure.js';
import {STRESS_SYNC_LOAD} from './load-profile.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const SIZE = STRESS_SYNC_LOAD.largeObjectBytes;
const directory = GLib.dir_make_tmp('clipboard-x-sync-stream-stress-XXXXXX');
const sourcePath = GLib.build_filenamev([directory, 'source.bin']);
const targetPath = GLib.build_filenamev([directory, 'target.bin']);
const source = Gio.File.new_for_path(sourcePath);
const target = Gio.File.new_for_path(targetPath);
const fixture = new HttpFixture();
const measurements = [];
let client;

function readOptional(path) {
  try {
    const [, bytes] = GLib.file_get_contents(path);
    return new TextDecoder().decode(bytes).trim();
  } catch (_error) {
    return null;
  }
}

function scheduler() {
  const fields = readOptional('/proc/self/schedstat')?.split(/\s+/u).map(Number);
  return fields?.length === 3 ? {cpuNanoseconds: fields[0], waitNanoseconds: fields[1]} : null;
}

function throttling() {
  // The common cgroup-v2 container view. It covers the whole cgroup, not just GJS.
  const text = readOptional('/sys/fs/cgroup/cpu.stat');
  return text === null ? null : Object.fromEntries(text.split('\n').map(line => {
    const [name, value] = line.split(/\s+/u);
    return [name, Number(value)];
  }));
}

function difference(after, before) {
  if (!after || !before)
    return null;
  return Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
}

function createSource() {
  const data = Uint8Array.from({length: 64 * 1024}, (_, index) => (index * 31 + (index >>> 8)) % 256);
  const bytes = new GLib.Bytes(data);
  const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
  const output = source.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
  try {
    for (let written = 0; written < SIZE; written += data.length) {
      assert(output.write_bytes(bytes, null) === data.length, 'fixture writes must be complete');
      checksum.update(data);
    }
  } finally { output.close(null); }
  return checksum.get_string();
}

async function runMeasured(name, operation) {
  const [, contents] = GLib.file_get_contents('/proc/self/stat');
  const pid = Number(new TextDecoder().decode(contents).split(' ')[0]);
  await client.request('POST', '/metrics/start', {json: {pid}});
  let metrics;
  let memory;
  let schedulerAfter;
  let throttleAfter;
  const schedulerBefore = scheduler();
  const throttleBefore = throttling();
  try {
    metrics = await measure(operation);
  } finally {
    schedulerAfter = scheduler();
    throttleAfter = throttling();
    memory = await client.request('POST', '/metrics/stop', {json: {}});
  }
  const peakGrowth = memory.peak - memory.baseline;
  print(JSON.stringify({phase: name, seconds: metrics.seconds,
    mebibytesPerSecond: SIZE / 1024 / 1024 / metrics.seconds,
    ticks: metrics.ticks, maximumDelayMilliseconds: metrics.maximumDelay,
    peakRssGrowthBytes: peakGrowth, rssSamples: memory.samples,
    scheduler: difference(schedulerAfter, schedulerBefore),
    cgroup: difference(throttleAfter, throttleBefore),
    stages: metrics.stages, stalls: metrics.stalls}));
  assert(memory.samples >= 2, `${name}: independent RSS sampler must actually run`);
  assert(memory.baseline > 0 && memory.peak >= memory.baseline,
    `${name}: RSS measurements must be present and valid`);
  measurements.push({name, peakGrowth, ...metrics});
  return metrics.result;
}

try {
  const filesystem = Gio.File.new_for_path(directory)
    .query_filesystem_info('filesystem::type', null).get_attribute_string('filesystem::type');
  print(JSON.stringify({phase: 'environment', gjs: System.version,
    glib: `${GLib.MAJOR_VERSION}.${GLib.MINOR_VERSION}.${GLib.MICRO_VERSION}`,
    kernel: readOptional('/proc/sys/kernel/osrelease'), filesystem,
    mallocPerturb: GLib.getenv('MALLOC_PERTURB_'),
    cgroup: readOptional('/proc/self/cgroup')}));
  const address = await fixture.start();
  const digest = createSource();
  client = new HttpClient({serverAddress: address, apiKey: 'stress-key', deviceId: 'stress-device'});
  const transport = new HttpTransport({}, {client});
  const uploadProgress = [];
  const response = await runMeasured('upload', () => transport.uploadContent('upload', 'content', {
    path: sourcePath, size: SIZE, mimeType: 'application/octet-stream',
  }, (bytes, total) => uploadProgress.push({bytes, total})));
  assert(response.size === SIZE && response.sha256 === digest,
    'the HTTP peer must receive and hash the exact uploaded bytes');
  assertProgress(uploadProgress, SIZE);

  target.replace_contents('previous target', null, false, Gio.FileCreateFlags.PRIVATE, null);
  const downloadProgress = [];
  let checkedAtomicity = false;
  const options = {maximumBytes: SIZE, expectedBytes: SIZE, expectedSha256: digest, useSha256sum: true};
  const result = await runMeasured('download', diagnostics => client.download('/content', targetPath, {
    ...options,
    diagnostics,
    onProgress: (bytes, total) => {
      downloadProgress.push({bytes, total});
      if (!checkedAtomicity && bytes > 0 && bytes < SIZE) {
        const [, previous] = target.load_contents(null);
        assert(new TextDecoder().decode(previous) === 'previous target',
          'an incomplete download must not replace the existing target');
        checkedAtomicity = true;
      }
    },
  }));
  assert(checkedAtomicity && result.size === SIZE && result.sha256 === digest,
    'download must verify the complete streamed object before replacing the target');
  assertProgress(downloadProgress, SIZE);
  for (const name of ['request', 'response', 'prepare-file', 'splice', 'close-streams',
    'start-verifier', 'read-verifier', 'wait-verifier', 'replace-target', 'cleanup', 'completed']) {
    assert(measurements.at(-1).stages.some(stage => stage.name === name),
      `native download diagnostics must include ${name}`);
  }
  // Independently hash the persisted file, not just the response stream.
  const verifier = Gio.Subprocess.new(['sha256sum', targetPath], Gio.SubprocessFlags.STDOUT_PIPE);
  const hashOutput = new Gio.DataInputStream({base_stream: verifier.get_stdout_pipe()});
  const [hashLine] = await hashOutput.read_line_async(GLib.PRIORITY_DEFAULT, null);
  await verifier.wait_check_async(null);
  assert(hashLine.split(' ')[0] === digest, 'persisted bytes must match the source digest');

  for (const {name, peakGrowth, ticks, maximumDelay, seconds} of measurements) {
    assert(peakGrowth < 64 * 1024 * 1024, `${name}: peak RSS growth exceeds 64 MiB (${peakGrowth})`);
    assert(ticks >= 2 && maximumDelay < 250, `${name}: main-loop delay exceeds 250ms (${maximumDelay})`);
    assert(seconds < 30, `${name}: loopback transfer exceeds 30s`);
  }
} finally {
  client?.abort();
  try { await fixture.close(); } finally {
    try { target.delete(null); } catch (_error) {}
    try { source.delete(null); } catch (_error) {}
    Gio.File.new_for_path(directory).delete(null);
  }
}
