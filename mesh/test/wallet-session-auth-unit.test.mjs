import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApi, parseTokenHashes } from '../http.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const token = 'test-only-mesh-token-0000000000000000';
const hashes = parseTokenHashes(JSON.stringify({ [digest(token)]: 'test_owner' }));

test('T72: wallet-session auth is checked for owner-scoped endpoints', async t => {
  let getSessionCalls = [];
  let graphOwners = [];
  const mockWalletAuth = {
    async ready() {},
    async getSession(token) {
      getSessionCalls.push(token);
      if (token === 'wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
        return {
          walletAddress: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
          ownerId: `wallet_${'a'.repeat(56)}`,
          expiresAt: '2026-09-27T12:30:00.000Z',
        };
      }
      return null;
    }
  };

  const mockStore = {
    async ready() {},
    async getGraph(owner) { graphOwners.push(owner); return { nodes: [], edges: [], sources: [], revision: 'test-rev' }; },
  };

  const server = createApi({
    store: mockStore,
    walletAuth: mockWalletAuth,
    tokenHashes: hashes,
    allowedOrigins: new Set(['http://127.0.0.1:4182']),
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('static mesh token bypasses wallet-session auth', async () => {
    getSessionCalls = [];
    graphOwners = [];
    const response = await fetch(`${base}/v1/graph`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal(getSessionCalls.length, 0, 'getSession should not be called for static tokens');
    assert.deepEqual(graphOwners, ['test_owner']);
  });

  await t.test('valid wsi1 token triggers wallet-session auth', async () => {
    getSessionCalls = [];
    graphOwners = [];
    const response = await fetch(`${base}/v1/graph`, {
      headers: { Authorization: 'Bearer wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(response.status, 200);
    assert.equal(getSessionCalls.length, 1);
    assert.equal(getSessionCalls[0], 'wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.deepEqual(graphOwners, [`wallet_${'a'.repeat(56)}`], 'owner comes from the verified session only');
  });

  await t.test('invalid wsi1 token is rejected', async () => {
    getSessionCalls = [];
    graphOwners = [];
    const response = await fetch(`${base}/v1/graph`, {
      headers: { Authorization: 'Bearer wsi1_invalid_token_bbbbbbbbbbbbbbbbbbbbbbbbb' },
    });
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.error.code, 'UNAUTHORIZED');
    assert.equal(getSessionCalls.length, 1);
    assert.deepEqual(graphOwners, [], 'no store access for a rejected session');
  });

  await t.test('connectors endpoint accepts wallet-session auth', async () => {
    getSessionCalls = [];
    const response = await fetch(`${base}/v1/connectors`, {
      headers: { Authorization: 'Bearer wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(response.status, 200);
    assert.equal(getSessionCalls.length, 1);
  });

  await t.test('wallet-session auth not called for health endpoints', async () => {
    getSessionCalls = [];
    await fetch(`${base}/healthz`);
    await fetch(`${base}/readyz`);
    assert.equal(getSessionCalls.length, 0, 'Health endpoints should not trigger session auth');
  });

  await t.test('missing authorization header is rejected', async () => {
    const response = await fetch(`${base}/v1/graph`);
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.error.code, 'UNAUTHORIZED');
  });
});

test('T72: lending prepare wallet validation with wallet-session', async t => {
  const prepareCalls = [];
  const mockWalletAuth = {
    async ready() {},
    async getSession(token) {
      if (token === 'wsi1_wallet1_token_aaaaaaaaaaaaaaaaaaaaaaaaaa') {
        return {
          walletAddress: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
          ownerId: `wallet_${'b'.repeat(56)}`,
          expiresAt: '2026-09-27T12:30:00.000Z',
        };
      }
      return null;
    }
  };

  const mockStore = {
    async ready() {},
    async getGraph() { return { nodes: [], edges: [], sources: [], revision: 'test-rev' }; },
  };

  const mockLending = {
    async prepare(owner, input) {
      prepareCalls.push({ owner, input });
      // Owner is `wallet_...` for a wallet session and `test_owner` for the static token.
      return {
        id: 'test-intent-id',
        requestId: input.requestId,
        analysisId: input.analysisId,
        createdAt: '2026-09-27T12:00:00.000Z',
        request: input,
        intent: {},
      };
    },
  };

  const server = createApi({
    store: mockStore,
    walletAuth: mockWalletAuth,
    lending: mockLending,
    tokenHashes: hashes,
    allowedOrigins: new Set(['http://127.0.0.1:4182']),
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('lending prepare succeeds when wallet matches session', async () => {
    const response = await fetch(`${base}/v1/lending/intents`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wsi1_wallet1_token_aaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: '12345678-1234-1234-1234-123456789012',
        analysisId: '87654321-4321-4321-4321-210987654321',
        wallet: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
        action: 'redeem',
        inputBaseUnits: '1000000',
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.record);
    assert.equal(prepareCalls.length, 1);
    assert.equal(prepareCalls[0].owner, `wallet_${'b'.repeat(56)}`, 'owner is the verified session owner');
  });

  await t.test('lending prepare fails when wallet does not match session', async () => {
    const response = await fetch(`${base}/v1/lending/intents`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wsi1_wallet1_token_aaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: '12345678-1234-1234-1234-123456789013',
        analysisId: '87654321-4321-4321-4321-210987654321',
        wallet: 'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99', // Different wallet
        action: 'redeem',
        inputBaseUnits: '1000000',
      }),
    });
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.error.code, 'UNAUTHORIZED');
    assert.match(data.error.message, /wallet must match/i);
    assert.equal(prepareCalls.length, 1, 'prepare must not run for a foreign wallet');
  });

  await t.test('lending prepare rejects a caller-supplied owner field and never reaches prepare', async () => {
    const response = await fetch(`${base}/v1/lending/intents`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wsi1_wallet1_token_aaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: '12345678-1234-1234-1234-123456789015',
        analysisId: '87654321-4321-4321-4321-210987654321',
        wallet: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
        action: 'redeem',
        inputBaseUnits: '1000000',
        ownerId: 'test_owner',
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(prepareCalls.length, 1);
  });

  await t.test('lending prepare with static token allows any wallet', async () => {
    const response = await fetch(`${base}/v1/lending/intents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: '12345678-1234-1234-1234-123456789014',
        analysisId: '87654321-4321-4321-4321-210987654321',
        wallet: 'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99',
        action: 'redeem',
        inputBaseUnits: '1000000',
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.record);
    assert.equal(prepareCalls.length, 2);
    assert.equal(prepareCalls[1].owner, 'test_owner');
  });
});
