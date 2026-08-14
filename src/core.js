import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {DEVICE_ICON_KINDS} from './constants.js';

export function ensureDeviceIdentity(settings) {
  let deviceId = settings.get_string('device-id').trim();
  if (!isUuid(deviceId)) {
    deviceId = GLib.uuid_string_random();
    settings.set_string('device-id', deviceId);
  }

  let deviceTag = settings.get_string('device-tag').trim();
  if (!deviceTag) {
    deviceTag = GLib.get_host_name() || 'GNOME';
    settings.set_string('device-tag', deviceTag);
  }

  let deviceIconKind = String(settings.get_string('device-icon-kind') ?? '').trim();
  if (!DEVICE_ICON_KINDS.includes(deviceIconKind)) {
    deviceIconKind = 'desktop';
    settings.set_string('device-icon-kind', deviceIconKind);
  }

  return {deviceId, deviceTag, deviceIconKind};
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sha256(bytes) {
  return GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
}

export function bytesFromString(text) {
  return new GLib.Bytes(new TextEncoder().encode(text));
}

export function stringFromBytes(bytes) {
  return new TextDecoder().decode(bytes.get_data());
}

export function truncateUtf8(text, byteLimit) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= byteLimit)
    return {text, truncated: false};

  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  const parts = [];
  let length = 0;
  for (const {segment} of segmenter.segment(text)) {
    const size = encoder.encode(segment).length;
    if (length + size > byteLimit)
      break;
    parts.push(segment);
    length += size;
  }

  return {text: parts.join(''), truncated: true};
}

export function variantDictionary(values) {
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (value instanceof GLib.Variant) {
      result[key] = value;
    } else if (typeof value === 'string') {
      result[key] = new GLib.Variant('s', value);
    } else if (typeof value === 'boolean') {
      result[key] = new GLib.Variant('b', value);
    } else if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      result[key] = new GLib.Variant('t', value);
    } else {
      throw new TypeError(`Unsupported D-Bus metadata value for ${key}`);
    }
  }
  return result;
}

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

export function diagnosticCode(error) {
  const name = error?.constructor?.name ?? 'Error';
  const code = Number.isInteger(error?.code) ? error.code : 'unknown';
  return `${name}:${code}`;
}
