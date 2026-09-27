import assert from 'node:assert/strict';
import test from 'node:test';
import { registerEmail, registrationMessage } from '../landing/waitlist.mjs';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('V105: signup sends the bounded landing request and accepts only explicit registration', async () => {
  const calls = [];
  const result = await registerEmail('  reader@example.com  ', { fetchImpl: async (...args) => { calls.push(args); return response(201, { status: 'registered', emailStatus: 'not_configured' }); } });
  assert.equal(calls[0][0], '/api/waitlist');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { email: 'reader@example.com', source: 'landing' });
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(result.status, 'registered');
  assert.equal(registrationMessage(result), 'Your address is registered.');
});

test('V105: provider acceptance is distinct from sending or delivery', () => {
  assert.equal(registrationMessage({ status: 'registered', emailStatus: 'accepted' }), 'Your address is registered. Confirmation email accepted for delivery.');
  assert.equal(registrationMessage({ status: 'already_registered', emailStatus: 'not_configured' }), 'Your address is already registered.');
  for (const emailStatus of ['pending', 'unknown', 'failed']) assert.match(registrationMessage({ status: 'registered', emailStatus }), /email is not confirmed/);
  for (const emailStatus of ['not_configured', 'sent', 'delivered', undefined]) assert.doesNotMatch(registrationMessage({ status: 'registered', emailStatus }), /email.*(?:sent|delivered|inbox)/i);
});

test('V105: signup rejects HTTP errors and unknown success bodies', async () => {
  for (const status of [400, 429, 503]) {
    await assert.rejects(registerEmail('reader@example.com', { fetchImpl: async () => response(status, { error: 'Registration is unavailable.' }) }), /Registration is unavailable/);
  }
  for (const body of [null, {}, { status: 'pending' }, { emailStatus: 'accepted' }]) {
    await assert.rejects(registerEmail('reader@example.com', { fetchImpl: async () => response(200, body) }), /did not confirm registration/);
  }
  await assert.rejects(registerEmail('reader@example.com', { fetchImpl: async () => { throw new Error('offline'); } }), /service did not respond/);
  await assert.rejects(registerEmail('reader@example.com', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } }) }), /did not confirm registration/);
});

test('V105: invalid email never reaches the API', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return response(200, { status: 'registered' }); };
  for (const value of ['', null, 'reader', 'name@example', 'a b@example.com', 'x'.repeat(250) + '@example.com']) await assert.rejects(registerEmail(value, { fetchImpl }), /valid email/);
  assert.equal(requests, 0);
});
