import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {bytesFromString, stringFromBytes} from '../../common/bytes.js';

const JSON_LIMIT_BYTES = 4 * 1024 * 1024;
const ERROR_LIMIT_BYTES = 64 * 1024;
const STREAM_CHUNK_BYTES = 256 * 1024;

Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');

export class HttpError extends Error {
  constructor(message, {status = 0, code = 'network_error', requestId = '', details = {}} = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export class HttpClient {
  constructor({serverAddress, apiKey, deviceId, session = null, cancellable = null}) {
    this.root = normalizeServerAddress(serverAddress);
    this._apiKey = String(apiKey ?? '');
    this._deviceId = String(deviceId ?? '');
    this._session = session ?? new Soup.Session({timeout: 30});
    this._cancellable = cancellable;
  }

  async request(method, path, {query = null, json = undefined, maximumBytes = JSON_LIMIT_BYTES, cancellable = null} = {}) {
    const message = this._message(method, path, query);
    if (json !== undefined) {
      message.set_request_body_from_bytes(
        'application/json',
        bytesFromString(JSON.stringify(json)),
      );
    }
    const input = await this._send(message, cancellable);
    try {
      const bytes = await readAll(
        input,
        this._successful(message) ? maximumBytes : ERROR_LIMIT_BYTES,
        cancellable ?? this._cancellable,
      );
      this._throwResponseError(message, bytes);
      if (bytes.get_size() === 0)
        return null;
      try {
        return JSON.parse(stringFromBytes(bytes));
      } catch (_error) {
        throw new HttpError('Synchronization server returned invalid JSON', {
          status: message.status_code,
          code: 'invalid_response',
        });
      }
    } finally {
      input.close(null);
    }
  }

  async upload(path, {stream, size, mimeType, query = null, onProgress = null, cancellable = null}) {
    const message = this._message('PUT', path, query);
    message.set_request_body(mimeType, stream, size);
    let completedBytes = 0;
    const signal = message.connect('wrote-body-data', (_message, count) => {
      completedBytes += Number(count);
      onProgress?.(Math.min(completedBytes, size), size);
    });
    try {
      const input = await this._send(message, cancellable);
      try {
        const bytes = await readAll(
          input,
          this._successful(message) ? JSON_LIMIT_BYTES : ERROR_LIMIT_BYTES,
          cancellable ?? this._cancellable,
        );
        this._throwResponseError(message, bytes);
        onProgress?.(size, size);
        if (bytes.get_size() === 0)
          return null;
        try {
          return JSON.parse(stringFromBytes(bytes));
        } catch (_error) {
          throw new HttpError('Synchronization server returned invalid JSON', {
            status: message.status_code,
            code: 'invalid_response',
          });
        }
      } finally {
        input.close(null);
      }
    } finally {
      message.disconnect(signal);
    }
  }

  async bytes(path, {maximumBytes, mimeType = '*/*', query = null, cancellable = null}) {
    const activeCancellable = cancellable ?? this._cancellable;
    const message = this._message('GET', path, query);
    message.request_headers.replace('Accept', mimeType);
    const input = await this._send(message, activeCancellable);
    try {
      const bytes = await readAll(
        input,
        this._successful(message) ? maximumBytes : ERROR_LIMIT_BYTES,
        activeCancellable,
      );
      this._throwResponseError(message, bytes);
      return bytes;
    } finally {
      input.close(null);
    }
  }

  async download(path, targetPath, {
    maximumBytes,
    expectedBytes,
    expectedSha256,
    mimeType = 'application/octet-stream',
    query = null,
    onProgress = null,
    cancellable = null,
  }) {
    const activeCancellable = cancellable ?? this._cancellable;
    const message = this._message('GET', path, query);
    message.request_headers.append('Accept', mimeType);
    const input = await this._send(message, activeCancellable);
    if (!this._successful(message)) {
      try {
        const bytes = await readAll(input, ERROR_LIMIT_BYTES, activeCancellable);
        this._throwResponseError(message, bytes);
      } finally {
        input.close(null);
      }
    }

    const declaredBytes = message.response_headers.get_content_length();
    if (declaredBytes > maximumBytes || (expectedBytes >= 0 && declaredBytes >= 0 && declaredBytes !== expectedBytes)) {
      input.close(null);
      throw new HttpError('Synchronization content size exceeds its declared limit', {
        status: message.status_code,
        code: 'invalid_content_size',
      });
    }

    const directory = GLib.path_get_dirname(targetPath);
    GLib.mkdir_with_parents(directory, 0o700);
    const temporaryPath = `${targetPath}.${GLib.uuid_string_random()}.part`;
    const temporary = Gio.File.new_for_path(temporaryPath);
    const output = temporary.replace(null, false, Gio.FileCreateFlags.PRIVATE, activeCancellable);
    const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
    let completedBytes = 0;
    try {
      while (true) {
        const bytes = await input.read_bytes_async(STREAM_CHUNK_BYTES, GLib.PRIORITY_DEFAULT, activeCancellable);
        if (bytes.get_size() === 0)
          break;
        completedBytes += bytes.get_size();
        if (completedBytes > maximumBytes || (expectedBytes >= 0 && completedBytes > expectedBytes))
          throw new HttpError('Synchronization content exceeds its declared limit', {code: 'too_large'});
        checksum.update(bytes.get_data());
        await writeBytes(output, bytes, activeCancellable);
        onProgress?.(completedBytes, expectedBytes >= 0 ? expectedBytes : declaredBytes);
      }
      output.close(activeCancellable);
      input.close(activeCancellable);
      if (expectedBytes >= 0 && completedBytes !== expectedBytes)
        throw new HttpError('Synchronization content size does not match its manifest', {code: 'size_mismatch'});
      const actualSha256 = checksum.get_string();
      if (expectedSha256 && actualSha256 !== expectedSha256)
        throw new HttpError('Synchronization content hash does not match its manifest', {code: 'hash_mismatch'});
      temporary.move(
        Gio.File.new_for_path(targetPath),
        Gio.FileCopyFlags.OVERWRITE,
        activeCancellable,
        null,
      );
      onProgress?.(completedBytes, expectedBytes >= 0 ? expectedBytes : completedBytes);
      return {path: targetPath, size: completedBytes, sha256: actualSha256};
    } catch (error) {
      try {
        output.close(null);
      } catch (_closeError) {
        // The output may already be closed after a complete download.
      }
      try {
        input.close(null);
      } catch (_closeError) {
        // The response may already be closed after a complete download.
      }
      try {
        temporary.delete(null);
      } catch (_deleteError) {
        // A failed transfer may not have created its temporary file.
      }
      throw error;
    }
  }

  abort() {
    this._session.abort();
  }

  async _send(message, cancellable) {
    try {
      return await this._session.send_async(
        message,
        GLib.PRIORITY_DEFAULT,
        cancellable ?? this._cancellable,
      );
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        throw error;
      throw new HttpError(error.message, {code: 'server_unavailable'});
    }
  }

  _message(method, path, query) {
    if (typeof path !== 'string' || !path.startsWith('/'))
      throw new TypeError('Synchronization API path must be absolute');
    const message = Soup.Message.new(method, this._url(path, query));
    if (!message)
      throw new HttpError('Synchronization server URL is invalid', {code: 'invalid_server_address'});
    message.request_headers.append('Accept', 'application/json');
    message.request_headers.append('Authorization', `Bearer ${this._apiKey}`);
    message.request_headers.append('X-Clipboard-X-Device-Id', this._deviceId);
    return message;
  }

  _url(path, query) {
    const entries = Object.entries(query ?? {})
      .filter(([_name, value]) => value !== undefined && value !== null && value !== '')
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    return `${this.root}${path}${entries.length > 0 ? `?${entries.join('&')}` : ''}`;
  }

  _successful(message) {
    return message.status_code >= 200 && message.status_code < 300;
  }

  _throwResponseError(message, bytes) {
    if (this._successful(message))
      return;
    let document = null;
    try {
      document = bytes.get_size() > 0 ? JSON.parse(stringFromBytes(bytes)) : null;
    } catch (_error) {
      // Non-JSON proxy errors are represented by the HTTP status below.
    }
    const value = document?.error ?? {};
    throw new HttpError(
      typeof value.message === 'string' && value.message
        ? value.message
        : `Synchronization server returned HTTP ${message.status_code}`,
      {
        status: message.status_code,
        code: typeof value.code === 'string' ? value.code : 'http_error',
        requestId: typeof value.requestId === 'string' ? value.requestId : '',
        details: value.details && typeof value.details === 'object' ? value.details : {},
      },
    );
  }
}

export function normalizeServerAddress(value) {
  let address = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(address))
    address = `http://${address}`;
  let uri;
  try {
    uri = GLib.Uri.parse(address, GLib.UriFlags.NONE);
  } catch (_error) {
    throw new HttpError('Synchronization server address is invalid', {code: 'invalid_server_address'});
  }
  if (!['http', 'https'].includes(uri.get_scheme()) || !uri.get_host()
      || uri.get_userinfo() || uri.get_fragment() || uri.get_query())
    throw new HttpError('Synchronization server address is invalid', {code: 'invalid_server_address'});
  return address.replace(/\/+$/u, '');
}

async function readAll(stream, maximumBytes, cancellable) {
  const chunks = [];
  let total = 0;
  while (true) {
    const bytes = await stream.read_bytes_async(STREAM_CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable);
    if (bytes.get_size() === 0)
      break;
    total += bytes.get_size();
    if (total > maximumBytes)
      throw new HttpError('Synchronization server response is too large', {code: 'response_too_large'});
    chunks.push(bytes.get_data());
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new GLib.Bytes(output);
}

async function writeBytes(stream, bytes, cancellable) {
  let offset = 0;
  while (offset < bytes.get_size()) {
    const remaining = GLib.Bytes.new_from_bytes(bytes, offset, bytes.get_size() - offset);
    const written = await stream.write_bytes_async(
      remaining,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );
    if (!Number.isSafeInteger(written) || written <= 0)
      throw new HttpError('Synchronization download could not be written', {code: 'write_failed'});
    offset += written;
  }
}
