import {bytesFromString, stringFromBytes} from '../../src/common/bytes.js';
import {filterEmptyHtml, trimRepresentations} from '../../src/clipboard/text.js';

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

for (const source of [
  '',
  ' \n\t',
  '<!-- clipboard marker -->',
  '<!-- first -->\n<!-- second -->',
  '<!-- unfinished comment',
  '<!DOCTYPE html><meta charset="utf-8">',
  '<!-- marker --><META content="a > b" name="generator"><link rel="stylesheet" href="style.css">',
]) {
  const filtered = filterEmptyHtml([{mimeType: 'text/html', bytes: bytesFromString(source)}]);
  assert(filtered.length === 0, 'HTML containing only comments, metadata or whitespace should be ignored');
}

for (const source of [
  '<b>内容</b>',
  '<!-- marker -->Hello<!-- marker -->',
  '<img src="image.png">',
  '<svg><path d="M0 0L1 1"/></svg>',
  '<div style="background-image: url(image.png)"></div>',
  '<custom-content></custom-content>',
  '<meta charset="utf-8"><p>Content</p>',
]) {
  const representation = {mimeType: 'text/html', bytes: bytesFromString(source)};
  const filtered = filterEmptyHtml([representation]);
  assert(filtered.length === 1 && filtered[0] === representation,
    'HTML with content or other elements should be preserved without rewriting');
}

const plain = {mimeType: 'text/plain;charset=utf-8', bytes: bytesFromString('Text')};
const image = {mimeType: 'image/png', bytes: bytesFromString('image fixture')};
const emptyHtml = {mimeType: 'text/html', bytes: bytesFromString('<!-- clipboard marker -->')};
const mixed = filterEmptyHtml([plain, emptyHtml, image]);
assert(mixed.length === 2 && mixed[0] === plain && mixed[1] === image,
  'discarding empty HTML must retain plain text and images from the same capture');
const whitespace = {mimeType: 'text/plain;charset=utf-8', bytes: bytesFromString(' \n\t')};
assert(filterEmptyHtml([whitespace])[0] === whitespace,
  'HTML filtering must not change the optional plain-text whitespace policy');
