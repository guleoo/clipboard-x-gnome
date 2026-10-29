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

export function typingDelay(character, speed = 'standard') {
  const timing = typingTiming(speed);
  return character.codePointAt(0) <= 0x7f
    ? timing.ascii
    : timing.unicode;
}
