export function diagnosticCode(error) {
  const name = error?.constructor?.name ?? 'Error';
  const code = Number.isInteger(error?.code) ? error.code : 'unknown';
  return `${name}:${code}`;
}
