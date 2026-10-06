import { createHash } from 'node:crypto';

export const tokenKey = token => `token:${createHash('sha256').update(token).digest('hex')}`;

// Fixed-window limiter held in this process only. Each instance counts on its own.
// Keys are bounded by the global ceiling; rejected calls never add a key.
export function createLimiter({ windowMs, perToken, global, clock = Date.now }) {
  let windowStart = clock();
  let globalCount = 0;
  const counts = new Map();
  return function check(key) {
    const now = clock();
    if (now - windowStart >= windowMs) { windowStart = now; globalCount = 0; counts.clear(); }
    const next = (counts.get(key) || 0) + 1;
    if (next > perToken || globalCount + 1 > global) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
    }
    counts.set(key, next);
    globalCount += 1;
    return { ok: true };
  };
}
