import { logger } from './logger';

/**
 * Sliding-window event rate limiter, one bucket per key (socket id).
 * Buckets are pruned when a socket disconnects via `clear()`.
 */
export function createRateLimiter(maxEvents: number, windowMs: number) {
  const buckets = new Map<string, number[]>();

  return {
    /** Returns true when the event is within budget; false when it should be dropped. */
    allow(key: string): boolean {
      const now = Date.now();
      let timestamps = buckets.get(key);
      if (!timestamps) {
        timestamps = [];
        buckets.set(key, timestamps);
      }
      // Drop timestamps that fell out of the window
      while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
        timestamps.shift();
      }
      if (timestamps.length >= maxEvents) {
        logger.warn('Rate limit exceeded, dropping event', { key, maxEvents, windowMs });
        return false;
      }
      timestamps.push(now);
      return true;
    },

    clear(key: string): void {
      buckets.delete(key);
    },
  };
}
