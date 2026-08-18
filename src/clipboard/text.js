import {bytesFromString, stringFromBytes} from '../common/bytes.js';

export function trimRepresentations(representations) {
  return representations.flatMap(representation => {
    if (!representation.mimeType.startsWith('text/plain'))
      return [representation];
    const text = stringFromBytes(representation.bytes).trim();
    return text ? [{...representation, bytes: bytesFromString(text)}] : [];
  });
}
