import { describe, it, expect, vi, afterEach } from 'vitest';
import { startSessionCleanup } from './session-cleanup.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('startSessionCleanup', () => {
  it('runs immediately and then on the interval, and stops when cancelled', () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();

    const stop = startSessionCleanup(cleanup, 1000);
    expect(cleanup).toHaveBeenCalledTimes(1); // immediate run

    vi.advanceTimersByTime(3000);
    expect(cleanup).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(5000);
    expect(cleanup).toHaveBeenCalledTimes(4); // no further runs after stop
  });
});
