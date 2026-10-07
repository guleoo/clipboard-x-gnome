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
  const started = GLib.get_monotonic_time();
  let lastTick = started;
  let stage = 'operation';
  const stages = [{name: stage, milliseconds: 0}];
  const stalls = [];
  const probe = {
    stage(name) {
      stage = name;
      stages.push({name, milliseconds: (GLib.get_monotonic_time() - started) / 1000});
    },
  };
  const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    const now = GLib.get_monotonic_time();
    const extraMilliseconds = (now - lastTick) / 1000 - 10;
    maximumDelay = Math.max(maximumDelay, extraMilliseconds);
    // This is a wall-clock gap, not proof that JavaScript blocked the process.
    // Keep both boundaries so stage transitions inside a gap remain visible.
    if (extraMilliseconds >= 50) {
      stalls.push({
        fromMilliseconds: (lastTick - started) / 1000,
        toMilliseconds: (now - started) / 1000,
        extraMilliseconds,
        observedStage: stage,
      });
    }
    lastTick = now;
    ticks++;
    return GLib.SOURCE_CONTINUE;
  });
  try {
    const result = await operation(probe);
    const seconds = (GLib.get_monotonic_time() - started) / 1_000_000;
    probe.stage('completed');
    // Let an overdue timer observe a blocking tail before removing the probe.
    const completedTicks = ticks;
    while (ticks <= completedTicks)
      await delay(10);
    return {result, seconds, ticks, maximumDelay, stages, stalls};
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
