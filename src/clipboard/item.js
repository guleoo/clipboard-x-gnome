import GLib from 'gi://GLib';

import {bytesFromString, sha256, stringFromBytes, truncateUtf8} from '../common/bytes.js';
import {DEFAULT_ICON_COLOR} from '../sync/icon-color.js';

export class ClipboardItem {
  constructor({
    id = GLib.uuid_string_random(),
    createdAt = Date.now(),
    originDeviceId = '',
    originDeviceTag = '',
    originDeviceIconKind = 'other',
    originDeviceIconColor = {light: DEFAULT_ICON_COLOR},
    representations = [],
    preview = null,
    favorite = false,
    remote = false,
    availability = 'ready',
    sensitive = false,
  } = {}) {
    this.id = id;
    this.createdAt = createdAt;
    this.originDeviceId = originDeviceId;
    this.originDeviceTag = originDeviceTag;
    this.originDeviceIconKind = originDeviceIconKind;
    this.originDeviceIconColor = originDeviceIconColor;
    this.representations = representations;
    this.preview = preview;
    this.favorite = favorite;
    this.remote = remote;
    this.availability = availability;
    this.sensitive = sensitive;
  }

  static fromBytes(mimeType, bytes, options = {}) {
    return ClipboardItem.fromRepresentations([{mimeType, bytes}], options);
  }

  static fromRepresentations(values, options = {}) {
    const seen = new Set();
    const representations = [];
    for (const {mimeType, bytes} of values) {
      const normalizedMimeType = normalizeMimeType(mimeType);
      const digest = sha256(bytes);
      const key = `${normalizedMimeType}\0${digest}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      representations.push({
        id: digest,
        mimeType: normalizedMimeType,
        size: bytes.get_size(),
        sha256: digest,
        bytes,
        path: null,
        delivery: 'eager',
      });
    }

    representations.sort((left, right) => representationRank(left) - representationRank(right));
    if (representations.length === 0)
      throw new Error('Clipboard item requires at least one representation');

    const previewSource = representations.find(value => value.mimeType.startsWith('text/plain'))
      ?? representations.find(value => value.mimeType === 'text/html')
      ?? representations[0];
    let preview;
    if (previewSource.mimeType.startsWith('text/')) {
      const sourceText = previewSource.mimeType === 'text/html'
        ? htmlToText(stringFromBytes(previewSource.bytes))
        : stringFromBytes(previewSource.bytes);
      const result = truncateUtf8(sourceText, options.textPreviewLimit ?? 4096);
      preview = {
        mimeType: 'text/plain;charset=utf-8',
        text: result.text,
        truncated: result.truncated || previewSource.mimeType === 'text/html',
        derivedFrom: previewSource.id,
      };
    } else {
      preview = {
        mimeType: previewSource.mimeType,
        path: null,
        truncated: false,
        derivedFrom: previewSource.id,
      };
    }

    return new ClipboardItem({...options, representations, preview});
  }

  static fromText(text, options = {}) {
    return ClipboardItem.fromBytes(
      'text/plain;charset=utf-8',
      bytesFromString(text),
      options,
    );
  }

  get primary() {
    return this.representations[0] ?? null;
  }

  get isText() {
    return this.primary?.mimeType.startsWith('text/') ?? false;
  }

  get isImage() {
    return this.primary?.mimeType.startsWith('image/') ?? false;
  }

  get text() {
    if (!this.isText)
      return '';
    const representation = this.representations.find(value => value.mimeType.startsWith('text/plain'))
      ?? this.representations.find(value => value.mimeType === 'text/html');
    if (!representation?.bytes)
      return this.preview?.text ?? '';
    const text = stringFromBytes(representation.bytes);
    return representation.mimeType === 'text/html' ? htmlToText(text) : text;
  }

  equals(other) {
    return this.primary?.sha256 && this.primary.sha256 === other?.primary?.sha256;
  }

  toJSON() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      originDeviceId: this.originDeviceId,
      originDeviceTag: this.originDeviceTag,
      originDeviceIconKind: this.originDeviceIconKind,
      originDeviceIconColor: this.originDeviceIconColor,
      representations: this.representations.map(({bytes: _bytes, ...representation}) => representation),
      preview: this.preview,
      favorite: this.favorite,
      remote: this.remote,
      availability: this.availability,
      sensitive: this.sensitive,
    };
  }

  static fromJSON(value) {
    const availability = value.remote && ['waiting-for-source', 'waiting-for-peer'].includes(value.availability)
      ? 'failed'
      : value.availability;
    return new ClipboardItem({originDeviceIconKind: 'other', ...value, availability});
  }
}

export function normalizeMimeType(mimeType) {
  if (mimeType === 'UTF8_STRING' || mimeType === 'STRING' || mimeType === 'text/plain')
    return 'text/plain;charset=utf-8';
  if (mimeType === 'image/jpg')
    return 'image/jpeg';
  return mimeType;
}

function representationRank(representation) {
  if (representation.mimeType.startsWith('image/'))
    return 0;
  if (representation.mimeType.startsWith('text/plain'))
    return 1;
  if (representation.mimeType === 'text/html')
    return 2;
  return 3;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim();
}
