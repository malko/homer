/**
 * Runs a cleanup callback once immediately and then on a fixed interval.
 * Used to purge expired sessions, whose rows would otherwise accumulate
 * forever (they are only ever filtered out at read time).
 */
export const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startSessionCleanup(
  cleanup: () => void,
  intervalMs: number = SESSION_CLEANUP_INTERVAL_MS,
): () => void {
  cleanup();
  const timer = setInterval(cleanup, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
