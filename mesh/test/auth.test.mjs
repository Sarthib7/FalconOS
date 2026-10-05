import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseSessionVerifier } from '../auth.mjs';

const projectUrl = 'https://project.supabase.co';
const userId = 'cf6c5a09-7d4f-45a3-9498-1fb2d6cd98a1';
const attackerId = '9f2c4a45-1758-4c85-8a48-c5bcacbdd800';
const tokenA = 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(500) + '.sig';
const tokenB = 'eyJhbGciOiJIUzI1NiJ9.' + 'b'.repeat(500) + '.sig';
const nowMs = 1_800_000_000_000;

function claims(overrides = {}) {
  return {
    iss: projectUrl + '/auth/v1', sub: userId, role: 'authenticated', aud: 'authenticated',
    exp: Math.floor(nowMs / 1000) + 3600, user_metadata: { sub: attackerId }, ...overrides,
  };
}
function verifierFor(response, options = {}) {
  const calls = [];
  const verifier = createSupabaseSessionVerifier({
    url: projectUrl, publishableKey: 'sb_publishable_test', clock: () => nowMs, ...options,
    createClientImpl: (url, key, config) => {
      assert.equal(url, projectUrl + '/');
      assert.equal(key, 'sb_publishable_test');
      assert.deepEqual(config.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
      return { auth: { getClaims: async token => { calls.push(token); return response(token); } } };
    },
  });
  return { verifier, calls };
}

test('V135: owner comes from verified Supabase sub and repeated token reuses verification', async () => {
  const { verifier, calls } = verifierFor(() => ({ data: { claims: claims() }, error: null }));
  assert.equal(await verifier(tokenA), userId);
  assert.equal(await verifier(tokenA), userId);
  assert.deepEqual(calls, [tokenA]);
});

test('V135: wrong issuer, role, expiry, or subject fail closed', async () => {
  const values = new Map([
    [tokenA, claims({ iss: 'https://attacker.example/auth/v1' })],
    [tokenB, claims({ sub: 'not-a-uuid' })],
  ]);
  const { verifier } = verifierFor(token => ({ data: { claims: values.get(token) ?? claims({ role: 'anon' }) }, error: null }));
  assert.equal(await verifier(tokenA), null);
  assert.equal(await verifier(tokenB), null);
  assert.equal(await verifier('eyJhbGciOiJIUzI1NiJ9.' + 'c'.repeat(500) + '.sig'), null);
  const expired = verifierFor(() => ({ data: { claims: claims({ exp: Math.floor(nowMs / 1000) }) }, error: null }));
  assert.equal(await expired.verifier(tokenA), null);
});

test('V135: Auth throttling and outages do not masquerade as invalid credentials', async () => {
  const limited = verifierFor(() => ({ data: null, error: { status: 429 } }));
  await assert.rejects(limited.verifier(tokenA), { code: 'SUPABASE_AUTH_RATE_LIMITED' });
  const offline = verifierFor(() => { throw new Error('network'); });
  await assert.rejects(offline.verifier(tokenA), { code: 'SUPABASE_AUTH_UNAVAILABLE' });
});

test('V135: unverified-token attempts are bounded before Auth lookup', async () => {
  const invalid = verifierFor(() => ({ data: null, error: { status: 401 } }), { verifyMax: 1, verifyWindowMs: 1000 });
  assert.equal(await invalid.verifier(tokenA), null);
  await assert.rejects(invalid.verifier(tokenB), { code: 'SUPABASE_AUTH_RATE_LIMITED' });
  assert.deepEqual(invalid.calls, [tokenA]);
});

test('V135: partial Supabase config is rejected; absent config leaves legacy routes available', () => {
  assert.throws(() => createSupabaseSessionVerifier({ url: projectUrl }), /must be set together/);
  assert.equal(createSupabaseSessionVerifier({}), null);
});
