// Optional observers must never change transfer results or interrupt cleanup.
export function stage(observer, name) {
  try {
    observer?.stage(name);
  } catch (_error) {
    // Diagnostics are best-effort, unlike progress/action callbacks.
  }
}
