import Gio from 'gi://Gio';

import {HttpClient} from './client.js';
import {routes} from './routes.js';

export class HttpTransport {
  constructor(configuration, {deviceId, cancellable = null, client = null} = {}) {
    this._client = client ?? new HttpClient({
      serverAddress: configuration.serverAddress,
      apiKey: configuration.apiKey,
      deviceId,
      cancellable,
    });
  }

  status() {
    return this._client.request('GET', routes.status());
  }

  device() {
    return this._client.request('GET', routes.device());
  }

  updateProfile(profile) {
    return this._client.request('PUT', routes.deviceProfile(), {json: profile});
  }

  channels() {
    return this._client.request('GET', routes.channels());
  }

  changes(channelId, cursor, limit = 200) {
    return this._client.request('GET', routes.changes(channelId), {
      query: {cursor, limit},
    });
  }

  createItem(channelId, manifest) {
    return this._client.request('POST', routes.items(channelId), {json: manifest});
  }

  item(channelId, itemId) {
    return this._client.request('GET', routes.item(channelId, itemId));
  }

  preview(channelId, itemId, previewId, maximumBytes, mimeType, cancellable = null) {
    return this._client.bytes(routes.preview(channelId, itemId, previewId), {
      maximumBytes,
      mimeType,
      cancellable,
    });
  }

  requestContent(channelId, itemId, contentId) {
    return this._client.request('POST', routes.contentRequests(channelId, itemId, contentId), {
      json: {},
    });
  }

  transfer(transferId) {
    return this._client.request('GET', routes.transfer(transferId));
  }

  transfers() {
    return this._client.request('GET', routes.transfers());
  }

  cancel(transferId) {
    return this._client.request('DELETE', routes.transfer(transferId));
  }

  work(cursor, limit = 100) {
    return this._client.request('GET', routes.work(), {query: {cursor, limit}});
  }

  acceptWork(workId) {
    return this._client.request('POST', routes.acceptWork(workId), {json: {}});
  }

  rejectWork(workId, code, message = '') {
    return this._client.request('POST', routes.rejectWork(workId), {
      json: {code, message},
    });
  }

  completeUpload(uploadId) {
    return this._client.request('POST', routes.completeUpload(uploadId), {json: {}});
  }

  uploadPreview(uploadId, previewId, source, onProgress, cancellable = null) {
    return this._upload(routes.uploadPreview(uploadId, previewId), source, onProgress, cancellable);
  }

  uploadContent(uploadId, contentId, source, onProgress, cancellable = null) {
    return this._upload(routes.uploadContent(uploadId, contentId), source, onProgress, cancellable);
  }

  downloadContent(channelId, itemId, contentId, targetPath, options) {
    return this._client.download(
      routes.content(channelId, itemId, contentId),
      targetPath,
      options,
    );
  }

  abort() {
    this._client.abort();
  }

  async _upload(path, source, onProgress, cancellable) {
    const stream = source.bytes
      ? Gio.MemoryInputStream.new_from_bytes(source.bytes)
      : Gio.File.new_for_path(source.path).read(cancellable);
    try {
      return await this._client.upload(path, {
        stream,
        size: source.size,
        mimeType: source.mimeType,
        onProgress,
        cancellable,
      });
    } finally {
      stream.close(null);
    }
  }
}
