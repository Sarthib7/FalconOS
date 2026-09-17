import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWaitlist } from '../functions/api/waitlist.js';

function makeDb({ attempts = 0, changes = 1 } = {}) {
  const calls = [];
  let nextAttempts = attempts;
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      const rateLimitQuery = sql.includes('waitlist_rate_limits');
      return {
        bind(...values) {
          calls.push(values);
          return {
            first: async () => rateLimitQuery ? { attempts: ++nextAttempts } : null,
            run: async () => ({ meta: { changes } })
          };
        }
      };
    }
  };
}

const env = (options) => ({ WAITLIST_DB: makeDb(options), WAITLIST_IP_SALT: 'test-salt' });

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

test('waitlist counts repeated submissions even for one email', async () => {
  const testEnv = env();
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => handleWaitlist(request({ email: 'user@example.com' }), testEnv))
  );
  assert.deepEqual(responses.map(response => response.status), [201, 201, 201, 201, 201, 429]);
  assert.equal(testEnv.WAITLIST_DB.calls.filter(call => typeof call === 'string' && call.includes('waitlist_entries')).length, 5);
});

test('waitlist limits concurrent new emails with one atomic counter', async () => {
  const testEnv = env();
  const responses = await Promise.all(
    Array.from({ length: 6 }, (_, index) => handleWaitlist(request({ email: `user${index}@example.com` }), testEnv))
  );
  assert.equal(responses.filter(response => response.status === 201).length, 5);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
});

test('waitlist rate-limits when the atomic counter reaches the limit', async () => {
  const testEnv = env({ attempts: 5 });
  const response = await handleWaitlist(request({ email: 'user@example.com' }), testEnv);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'rate_limited' });
});

test('waitlist fails closed when production bindings are missing', async () => {
  const response = await handleWaitlist(request({ email: 'user@example.com' }), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'waitlist_unavailable' });
});
