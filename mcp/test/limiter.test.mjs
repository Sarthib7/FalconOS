import assert from 'node:assert/strict';
import test from 'node:test';
import { createLimiter, tokenKey } from '../src/limiter.mjs';

function make(overrides = {}) {
  const time = { now: 1_000_000 };
  const limiter = createLimiter({ windowMs: 60_000, perToken: 3, global: 100, clock: () => time.now, ...overrides });
  return { time, limiter };
}

test('token limiter allows the configured count then returns a retry hint', () => {
  const { time, limiter } = make();
  for (let i = 0; i < 3; i += 1) assert.equal(limiter(tokenKey('token-a')).ok, true);
  time.now += 20_000;
  const verdict = limiter(tokenKey('token-a'));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.retryAfterSeconds, 40);
  assert.equal(limiter(tokenKey('token-b')).ok, true, 'another token has its own bucket');
});

test('token limiter resets after the window', () => {
  const { time, limiter } = make();
  for (let i = 0; i < 3; i += 1) assert.equal(limiter(tokenKey('token-a')).ok, true);
  assert.equal(limiter(tokenKey('token-a')).ok, false);
  time.now += 60_000;
  assert.equal(limiter(tokenKey('token-a')).ok, true);
});

test('limiter enforces the global ceiling across tokens', () => {
  const { limiter } = make({ perToken: 10, global: 4 });
  for (const token of ['a', 'b', 'c', 'd']) assert.equal(limiter(tokenKey(token)).ok, true);
  assert.equal(limiter(tokenKey('e')).ok, false);
});

test('token keys are hashed, not the access token', () => {
  const key = tokenKey('fao1_secretsecretsecretsecret');
  assert.match(key, /^token:[a-f0-9]{64}$/);
  assert.equal(key.includes('secret'), false);
});
