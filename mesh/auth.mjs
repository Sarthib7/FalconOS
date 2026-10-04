import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_TOKEN = /^[A-Za-z0-9._~-]{32,4096}$/;
const CACHE_LIMIT = 2048;
const DEFAULT_VERIFY_MAX = 30;
const DEFAULT_VERIFY_WINDOW_MS = 300000;

function codedError(code, retryAfter) {
  const error = new Error(code);
  error.code = code;
  if (Number.isInteger(retryAfter)) error.retryAfter = retryAfter;
  return error;
}

export function createSupabaseSessionVerifier({
  url, publishableKey, createClientImpl = createClient, verifyMax = DEFAULT_VERIFY_MAX,
  verifyWindowMs = DEFAULT_VERIFY_WINDOW_MS, clock = () => Date.now(),
} = {}) {
  if (!url && !publishableKey) return null;
  if (typeof url !== 'string' || !url || typeof publishableKey !== 'string' || !publishableKey) {
    throw new Error('FALCON_SUPABASE_URL and FALCON_SUPABASE_PUBLISHABLE_KEY must be set together.');
  }
  if (!Number.isSafeInteger(verifyMax) || verifyMax < 1 || !Number.isSafeInteger(verifyWindowMs) || verifyWindowMs < 1) {
    throw new Error('Supabase verification limits must be positive integers.');
  }
  const projectUrl = new URL(url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(projectUrl.hostname);
  if (projectUrl.protocol !== 'https:' && !(projectUrl.protocol === 'http:' && loopback)) {
    throw new Error('FALCON_SUPABASE_URL must use HTTPS outside loopback development.');
  }
  const issuer = `${projectUrl.origin}/auth/v1`;
  const client = createClientImpl(projectUrl.toString(), publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const verified = new Map();
  let windowStart = clock();
  let attempts = 0;

  return async token => {
    if (typeof token !== 'string' || !ACCESS_TOKEN.test(token)) return null;
    const now = clock();
    const digest = createHash('sha256').update(token).digest('hex');
    const cached = verified.get(digest);
    if (cached && cached.expiresAt > now) {
      verified.delete(digest); verified.set(digest, cached);
      return cached.userId;
    }
    if (cached) verified.delete(digest);

    if (now - windowStart >= verifyWindowMs) { windowStart = now; attempts = 0; }
    if (attempts >= verifyMax) throw codedError('SUPABASE_AUTH_RATE_LIMITED', Math.max(1, Math.ceil((windowStart + verifyWindowMs - now) / 1000)));
    attempts += 1;

    let result;
    try { result = await client.auth.getClaims(token); }
    catch { throw codedError('SUPABASE_AUTH_UNAVAILABLE'); }
    if (result?.error) {
      if (result.error.status === 429) throw codedError('SUPABASE_AUTH_RATE_LIMITED', 60);
      if (result.error.name === 'AuthRetryableFetchError' || result.error.status >= 500) throw codedError('SUPABASE_AUTH_UNAVAILABLE');
      return null;
    }
    const claims = result?.data?.claims;
    const userId = claims?.sub;
    const expiry = claims?.exp;
    const nowSeconds = Math.floor(now / 1000);
    const audience = claims?.aud;
    const authenticatedAudience = audience === 'authenticated' || (Array.isArray(audience) && audience.includes('authenticated'));
    const expiresAt = expiry * 1000;
    if (claims?.iss !== issuer || claims?.role !== 'authenticated' || !authenticatedAudience
      || typeof userId !== 'string' || !USER_ID.test(userId) || !Number.isSafeInteger(expiry)
      || !Number.isSafeInteger(expiresAt) || expiry <= nowSeconds
      || (Number.isSafeInteger(claims.nbf) && claims.nbf > nowSeconds)) return null;

    if (verified.size >= CACHE_LIMIT) verified.delete(verified.keys().next().value);
    verified.set(digest, { userId, expiresAt });
    return userId;
  };
}
