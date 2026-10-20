import {bytesFromString, stringFromBytes} from '../common/bytes.js';

export function filterEmptyHtml(representations) {
  return representations.filter(representation => {
    if (representation.mimeType !== 'text/html')
      return true;
    // Reject only definite emptiness. Other elements may carry images or visual
    // content even without text, so keep their original bytes unchanged.
    const content = stringFromBytes(representation.bytes);
    const ignored = /\s+|<!--[\s\S]*?(?:-->|$)|<!doctype\b(?:[^>"']|"[^"]*"|'[^']*')*>|<(?:meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/iyu;
    let offset = 0;
    while (offset < content.length) {
      ignored.lastIndex = offset;
      if (!ignored.test(content))
        return true;
      offset = ignored.lastIndex;
    }
    return false;
  });
}

export function trimRepresentations(representations) {
  return representations.flatMap(representation => {
    if (!representation.mimeType.startsWith('text/plain'))
      return [representation];
    const text = stringFromBytes(representation.bytes).trim();
    return text ? [{...representation, bytes: bytesFromString(text)}] : [];
  });
}
