export function diagnosticCode(error) {
  const name = error?.constructor?.name ?? 'Error';
  const code = Number.isInteger(error?.code)
    || (typeof error?.code === 'string' && error.code)
    ? error.code
    : 'unknown';
  return `${name}:${code}`;
}
