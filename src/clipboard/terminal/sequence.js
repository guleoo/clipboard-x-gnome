import {InputError} from './errors.js';

const TIMING = Object.freeze({
  standard: {ascii: 4, unicode: 30, settle: 75},
  medium: {ascii: 6, unicode: 40, settle: 75},
  slow: {ascii: 8, unicode: 50, settle: 75},
});

export function typingTiming(speed = 'standard') {
  return TIMING[speed] ?? TIMING.standard;
}

export function typingSequence(text) {
  const sequence = [];
  const normalized = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  for (const character of normalized)
    sequence.push(character);
  return sequence;
}

// Unicode iteration keeps surrogate pairs intact. Validate the entire text
// before yielding: a later NUL must not truncate a partially submitted task.
export function* textChunks(text) {
  const normalized = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  for (const character of normalized) {
    const code = character.codePointAt(0);
    if (code === 0 || code >= 0xd800 && code <= 0xdfff)
      throw new InputError('invalid_text');
  }
  let chunk = '';
  let count = 0;
  let bytes = 0;
  for (const character of normalized) {
    const code = character.codePointAt(0);
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (count === 256 || bytes + size > 1024) {
      yield chunk;
      chunk = '';
      count = 0;
      bytes = 0;
    }
    chunk += character;
    count++;
    bytes += size;
  }
  if (chunk)
    yield chunk;
}

export function typingDelay(character, speed = 'standard') {
  const timing = typingTiming(speed);
  return character.codePointAt(0) <= 0x7f
    ? timing.ascii
    : timing.unicode;
}
