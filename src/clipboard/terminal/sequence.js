const ASCII_DELAY_MILLISECONDS = 3;
const UNICODE_DELAY_MILLISECONDS = 20;

export function typingSequence(text) {
  const sequence = [];
  const normalized = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  for (const character of normalized)
    sequence.push(character);
  return sequence;
}

export function typingDelay(character) {
  return character.codePointAt(0) <= 0x7f
    ? ASCII_DELAY_MILLISECONDS
    : UNICODE_DELAY_MILLISECONDS;
}
