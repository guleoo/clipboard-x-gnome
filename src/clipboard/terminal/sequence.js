const TIMING = Object.freeze({
  standard: {ascii: 3, unicode: 20, settle: 75},
  slow: {ascii: 15, unicode: 50, settle: 150},
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

export function typingDelay(character, speed = 'standard') {
  const timing = typingTiming(speed);
  return character.codePointAt(0) <= 0x7f
    ? timing.ascii
    : timing.unicode;
}
