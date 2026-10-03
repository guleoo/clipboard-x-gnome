import GLib from 'gi://GLib';

export function delay(milliseconds) {
  return new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
}

export async function measure(operation) {
  let ticks = 0;
  let maximumDelay = 0;
  let lastTick = GLib.get_monotonic_time();
  const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    const now = GLib.get_monotonic_time();
    maximumDelay = Math.max(maximumDelay, (now - lastTick) / 1000 - 10);
    lastTick = now;
    ticks++;
    return GLib.SOURCE_CONTINUE;
  });
  const started = GLib.get_monotonic_time();
  try {
    const result = await operation();
    const seconds = (GLib.get_monotonic_time() - started) / 1_000_000;
    // Let an overdue timer observe a blocking tail before removing the probe.
    const completedTicks = ticks;
    while (ticks <= completedTicks)
      await delay(10);
    return {result, seconds, ticks, maximumDelay};
  } finally {
    GLib.Source.remove(timer);
  }
}

export function assertProgress(values, size) {
  if (values.length < 2 || values.at(-1).bytes !== size
      || !values.some(value => value.bytes > 0 && value.bytes < size))
    throw new Error('progress must include intermediate bytes and the exact final byte count');
  let previous = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value.bytes) || value.bytes < previous
        || value.bytes > size || value.total !== size)
      throw new Error('progress must be monotonic and use the declared byte total');
    previous = value.bytes;
  }
}
