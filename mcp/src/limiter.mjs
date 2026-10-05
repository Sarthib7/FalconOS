import { createHash } from 'node:crypto';

export const sessionKey = session => `session:${createHash('sha256').update(session).digest('hex')}`;

// Fixed-window limiter held in this process only. Each instance counts on its own.
// Keys are bounded by the global ceiling: a rejected call never inserts a key.
export function createLimiter({ windowMs, perSession, perWallet, global, clock = Date.now }) {
  let windowStart = clock();
  let globalCount = 0;
  const counts = new Map();
  return function check(kind, key) {
    const limit = kind === 'wallet' ? perWallet : perSession;
    const now = clock();
    if (now - windowStart >= windowMs) { windowStart = now; globalCount = 0; counts.clear(); }
    const id = `${kind}:${key}`;
    const next = (counts.get(id) || 0) + 1;
    if (next > limit || globalCount + 1 > global) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
    }
    counts.set(id, next);
    globalCount += 1;
    return { ok: true };
  };
}
