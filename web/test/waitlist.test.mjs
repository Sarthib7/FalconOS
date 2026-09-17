import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWaitlist } from '../functions/api/waitlist.js';

function makeDb({ recentCount = 0, changes = 1 } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      return {
        bind(...values) {
          calls.push(values);
          return {
            first: async () => ({ count: recentCount }),
            run: async () => ({ meta: { changes } })
          };
        }
      };
    }
  };
}

const env = () => ({ WAITLIST_DB: makeDb(), WAITLIST_IP_SALT: 'test-salt' });

function request(body, headers = {}) {
  return new Request('https://falconos.markets/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('waitlist accepts and normalizes a valid email', async () => {
  const testEnv = env();
  const response = await handleWaitlist(request({ email: ' User@Example.COM ', source: 'landing' }), testEnv);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { status: 'registered' });
  assert.deepEqual(testEnv.WAITLIST_DB.calls[3][0], 'user@example.com');
});

test('waitlist rejects invalid email before database writes', async () => {
  const testEnv = env();
  const response = await handleWaitlist(request({ email: 'not-an-email' }), testEnv);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_email' });
  assert.equal(testEnv.WAITLIST_DB.calls.length, 0);
});

test('waitlist rate-limits repeated submissions from one client', async () => {
  const testEnv = { ...env(), WAITLIST_DB: makeDb({ recentCount: 5 }) };
  const response = await handleWaitlist(request({ email: 'user@example.com' }, { 'cf-connecting-ip': '203.0.113.4' }), testEnv);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'rate_limited' });
});

test('waitlist fails closed when production bindings are missing', async () => {
  const response = await handleWaitlist(request({ email: 'user@example.com' }), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'waitlist_unavailable' });
});
