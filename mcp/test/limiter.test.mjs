import assert from 'node:assert/strict';
import test from 'node:test';
import { createLimiter, sessionKey } from '../src/limiter.mjs';

function make(overrides = {}) {
  const time = { now: 1_000_000 };
  const limiter = createLimiter({ windowMs: 60_000, perSession: 3, perWallet: 2, global: 100, clock: () => time.now, ...overrides });
  return { time, limiter };
}

test('limiter allows the configured count then returns a retry hint', () => {
  const { time, limiter } = make();
  for (let i = 0; i < 3; i += 1) assert.equal(limiter('session', 'a').ok, true);
  time.now += 20_000;
  const verdict = limiter('session', 'a');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.retryAfterSeconds, 40);
  assert.equal(limiter('session', 'b').ok, true, 'another caller has its own bucket');
});

test('limiter uses the wallet limit for wallet keys and resets after the window', () => {
  const { time, limiter } = make();
  assert.equal(limiter('wallet', 'w').ok, true);
  assert.equal(limiter('wallet', 'w').ok, true);
  assert.equal(limiter('wallet', 'w').ok, false);
  time.now += 60_000;
  assert.equal(limiter('wallet', 'w').ok, true);
});

test('limiter enforces the global ceiling across callers and stores no keys for rejected calls', () => {
  const { limiter } = make({ perSession: 10, global: 4 });
  for (const key of ['a', 'b', 'c', 'd']) assert.equal(limiter('session', key).ok, true);
  assert.equal(limiter('session', 'e').ok, false);
  assert.equal(limiter('wallet', 'f').ok, false);
});

test('session keys are hashed, not the token', () => {
  const key = sessionKey('wsi1_secretsecretsecretsecret');
  assert.match(key, /^session:[a-f0-9]{64}$/);
  assert.equal(key.includes('secret'), false);
});
