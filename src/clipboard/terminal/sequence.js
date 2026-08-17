export function typingSequence(text) {
  const sequence = [];
  const normalized = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  for (const character of normalized)
    sequence.push(character);
  return sequence;
}
