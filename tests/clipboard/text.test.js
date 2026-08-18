import {bytesFromString, stringFromBytes} from '../../src/common/bytes.js';
import {trimRepresentations} from '../../src/clipboard/text.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const html = {mimeType: 'text/html', bytes: bytesFromString(' <b>内容</b> ')};
const results = trimRepresentations([
  {
    mimeType: 'text/plain;charset=utf-8',
    bytes: bytesFromString('\t\u00a0\u3000中文  English\n第二行 \t'),
  },
  html,
]);

assert(results.length === 2, 'trimming should retain non-plain-text representations');
assert(stringFromBytes(results[0].bytes) === '中文  English\n第二行',
  'trimming should remove Unicode edge whitespace and preserve internal whitespace');
assert(results[1] === html,
  'trimming should not rewrite HTML or other non-plain-text representations');
assert(trimRepresentations([{
  mimeType: 'text/plain;charset=utf-8',
  bytes: bytesFromString(' \n\t\u3000'),
}]).length === 0, 'plain text containing only whitespace should be discarded');
