import GLib from 'gi://GLib';

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
