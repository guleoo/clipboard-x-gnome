import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {HttpClient} from '../../src/sync/http/client.js';
import {HttpTransport} from '../../src/sync/http/transport.js';
import {STRESS_SYNC_LOAD} from './load-profile.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const SIZE = STRESS_SYNC_LOAD.largeObjectBytes;
const SHA256_OF_ZERO_OBJECT = '33a3a11d54de8ede604c243cedfde1ef4b534d5ea3279c9dd57df314045c23df';

function createSparseFile(path, size) {
  const output = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
  output.truncate(size, null);
  output.close(null);
}

function readRssBytes() {
  const [, contents] = GLib.file_get_contents('/proc/self/status');
  const text = new TextDecoder().decode(contents);
  const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(text);
  return match ? Number(match[1]) * 1024 : 0;
}

class FileSession {
  constructor(path) { this._path = path; }
  send_async() { return Promise.resolve(Gio.File.new_for_path(this._path).read(null)); }
  abort() {}
}

class StreamDownloadClient extends HttpClient {
  _message() {
    return {
      status_code: 200,
      request_headers: {append() {}, replace() {}},
      response_headers: {get_content_length: () => SIZE},
    };
  }
}

class StreamSink {
  constructor() { this.bytes = 0; this.progress = 0; }

  async upload(_path, {stream, size, onProgress}) {
    while (true) {
      const bytes = await stream.read_bytes_async(256 * 1024, GLib.PRIORITY_DEFAULT, null);
      if (bytes.get_size() === 0)
        break;
      this.bytes += bytes.get_size();
      this.progress++;
      onProgress?.(this.bytes, size);
    }
    return {};
  }
}

const directory = GLib.dir_make_tmp('clipboard-x-sync-stream-stress-XXXXXX');
const sourcePath = GLib.build_filenamev([directory, 'source.bin']);
const targetPath = GLib.build_filenamev([directory, 'target.bin']);
const source = Gio.File.new_for_path(sourcePath);
const target = Gio.File.new_for_path(targetPath);

try {
  createSparseFile(sourcePath, SIZE);

  const sink = new StreamSink();
  const transport = new HttpTransport({}, {client: sink});
  const uploadStarted = GLib.get_monotonic_time();
  await transport.uploadContent('upload', 'content', {
    path: sourcePath, size: SIZE, mimeType: 'application/octet-stream',
  }, () => {});
  const uploadSeconds = (GLib.get_monotonic_time() - uploadStarted) / 1_000_000;
  assert(sink.bytes === SIZE, 'stream upload must consume the exact 10x object size');
  assert(sink.progress > 100, 'stream upload must report progress for multiple chunks');
  assert(uploadSeconds < 60, `10x stream upload took too long: ${uploadSeconds.toFixed(2)}s`);

  const session = new FileSession(sourcePath);
  const client = new StreamDownloadClient({
    serverAddress: 'http://example.test', apiKey: 'key', deviceId: 'device', session,
  });
  const progress = [];
  let maximumEventLoopDelay = 0;
  let lastTick = GLib.get_monotonic_time();
  const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    const now = GLib.get_monotonic_time();
    maximumEventLoopDelay = Math.max(maximumEventLoopDelay, (now - lastTick) / 1000 - 10);
    lastTick = now;
    return GLib.SOURCE_CONTINUE;
  });
  const rssBefore = readRssBytes();
  const downloadStarted = GLib.get_monotonic_time();
  const result = await client.download('/content', targetPath, {
    maximumBytes: SIZE, expectedBytes: SIZE, expectedSha256: SHA256_OF_ZERO_OBJECT,
    onProgress: bytes => progress.push(bytes),
  });
  const downloadSeconds = (GLib.get_monotonic_time() - downloadStarted) / 1_000_000;
  GLib.Source.remove(timer);
  const rssAfter = readRssBytes();

  assert(result.size === SIZE && result.sha256 === SHA256_OF_ZERO_OBJECT,
    'stream download must verify the exact size and SHA-256 of the 10x object');
  assert(target.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size() === SIZE,
    'stream download must atomically create the complete target object');
  assert(progress.at(-1) === SIZE && progress.length > 100,
    'stream download progress must be exact and chunked');
  assert(rssAfter - rssBefore < 64 * 1024 * 1024,
    `streaming must not retain the full object in memory (RSS delta ${rssAfter - rssBefore} bytes)`);
  assert(maximumEventLoopDelay < 250,
    `streaming must keep the event loop responsive (max delay ${maximumEventLoopDelay.toFixed(1)}ms)`);
  assert(downloadSeconds < 60, `10x stream download took too long: ${downloadSeconds.toFixed(2)}s`);
} finally {
  try { target.delete(null); } catch (_error) {}
  try { source.delete(null); } catch (_error) {}
  Gio.File.new_for_path(directory).delete(null);
}
