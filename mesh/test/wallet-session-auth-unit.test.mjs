import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApi, parseTokenHashes } from '../http.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const token = 'test-only-mesh-token-0000000000000000';
const hashes = parseTokenHashes(JSON.stringify({ [digest(token)]: 'test_owner' }));

test('T72: wallet-session auth is checked for owner-scoped endpoints', async t => {
  let getSessionCalls = [];
  const mockWalletAuth = {
    async ready() {},
    async getSession(token) {
      getSessionCalls.push(token);
      if (token === 'wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
        return {
          walletAddress: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
          ownerId: 'w_test_owner_id',
          expiresAt: '2026-09-27T12:30:00.000Z',
        };
      }
      return null;
    }
  };

  const mockStore = {
    async ready() {},
    async getGraph() { return { nodes: [], edges: [], sources: [], revision: 'test-rev' }; },
    async captureSource() { return { revisionId: '11111111-1111-4111-8111-111111111111' }; },
    async listAnalyses() { return []; },
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
    const response = await fetch(`${base}/v1/graph`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal(getSessionCalls.length, 0, 'getSession should not be called for static tokens');
  });

  await t.test('valid wsi1 token triggers wallet-session auth', async () => {
    getSessionCalls = [];
    const response = await fetch(`${base}/v1/graph`, {
      headers: { Authorization: 'Bearer wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(response.status, 200);
    assert.equal(getSessionCalls.length, 1);
    assert.equal(getSessionCalls[0], 'wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  await t.test('invalid wsi1 token is rejected', async () => {
    getSessionCalls = [];
    const response = await fetch(`${base}/v1/graph`, {
      headers: { Authorization: 'Bearer wsi1_invalid_token_bbbbbbbbbbbbbbbbbbbbbbbbb' },
    });
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.error.code, 'UNAUTHORIZED');
    assert.equal(getSessionCalls.length, 1);
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

  await t.test('captures and analyses accept wallet-session auth', async () => {
    getSessionCalls = [];
    const capture = await fetch(`${base}/v1/captures`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: '12345678-1234-1234-1234-123456789012',
        connectorId: 'kamino',
        expectedRevisionId: null,
      }),
    });
    assert.equal(capture.status, 200);
    const analyses = await fetch(`${base}/v1/analyses`, {
      headers: { Authorization: 'Bearer wsi1_valid_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert.equal(analyses.status, 200);
    assert.equal(getSessionCalls.length, 2);
  });
});

test('T72: lending prepare wallet validation with wallet-session', async t => {
  const mockWalletAuth = {
    async ready() {},
    async getSession(token) {
      if (token === 'wsi1_wallet1_token_aaaaaaaaaaaaaaaaaaaaaaaaaa') {
        return {
          walletAddress: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
          ownerId: 'w_owner1',
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
      // Owner can be either 'w_owner1' (wallet-session) or 'test_owner' (static token)
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
        action: 'supply',
        inputBaseUnits: '1000000',
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.record);
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
        action: 'supply',
        inputBaseUnits: '1000000',
      }),
    });
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.equal(data.error.code, 'UNAUTHORIZED');
    assert.match(data.error.message, /wallet must match/i);
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
        action: 'supply',
        inputBaseUnits: '1000000',
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.record);
  });
});

test('T72: lending submit and receipt bind session wallet before mutation', async t => {
  const wallet1 = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
  const wallet2 = 'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99';
  const session1 = 'wsi1_wallet1_token_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  const session2 = 'wsi1_wallet2_token_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  const expired = 'wsi1_expired_token_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  const revoked = 'wsi1_revoked_token_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  const matchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const mismatchId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const tx = Buffer.from('fixture-signed-intent').toString('base64');
  const calls = { get: 0, submit: 0, receipt: 0 };

  const mockWalletAuth = {
    async ready() {},
    async getSession(token) {
      if (token === session1) return { walletAddress: wallet1, ownerId: 'w_owner1', expiresAt: '2026-09-27T12:30:00.000Z' };
      if (token === session2) return { walletAddress: wallet2, ownerId: 'w_owner2', expiresAt: '2026-09-27T12:30:00.000Z' };
      return null;
    },
  };
  const mockLending = {
    async get(owner, id) {
      calls.get += 1;
      if (owner !== 'w_owner1') return null;
      if (id === matchId) return { record: { id, request: { wallet: wallet1 } }, events: [] };
      if (id === mismatchId) return { record: { id, request: { wallet: wallet2 } }, events: [] };
      return null;
    },
    async submit() { calls.submit += 1; return { id: 'submit-event' }; },
    async receipt() { calls.receipt += 1; return { id: 'receipt-event' }; },
  };
  const server = createApi({
    store: { async ready() {} },
    walletAuth: mockWalletAuth,
    lending: mockLending,
    tokenHashes: hashes,
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, { credential, input }) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  await t.test('submit succeeds when stored intent wallet matches session', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${matchId}/submit`, {
      credential: session1,
      input: { requestId: '12345678-1234-1234-1234-123456789012', transactionBase64: tx },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.get, 1);
    assert.equal(calls.submit, 1);
  });

  await t.test('submit rejects stored wallet mismatch before mutation', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${mismatchId}/submit`, {
      credential: session1,
      input: { requestId: '12345678-1234-1234-1234-123456789013', transactionBase64: tx },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
    assert.equal(calls.get, 1);
    assert.equal(calls.submit, 0);
  });

  await t.test('receipt rejects stored wallet mismatch before mutation', async () => {
    calls.get = calls.receipt = 0;
    const response = await post(`/v1/lending/intents/${mismatchId}/receipt`, {
      credential: session1,
      input: { requestId: '12345678-1234-1234-1234-123456789014' },
    });
    assert.equal(response.status, 401);
    assert.equal(calls.get, 1);
    assert.equal(calls.receipt, 0);
  });

  await t.test('receipt succeeds when stored intent wallet matches session', async () => {
    calls.get = calls.receipt = 0;
    const response = await post(`/v1/lending/intents/${matchId}/receipt`, {
      credential: session1,
      input: { requestId: '12345678-1234-1234-1234-123456789015' },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.receipt, 1);
  });

  await t.test('cross-owner submit cannot mutate another wallet intent', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${matchId}/submit`, {
      credential: session2,
      input: { requestId: '12345678-1234-1234-1234-123456789016', transactionBase64: tx },
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
    assert.equal(calls.submit, 0);
  });

  await t.test('expired session is rejected before submit lookup', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${matchId}/submit`, {
      credential: expired,
      input: { requestId: '12345678-1234-1234-1234-123456789017', transactionBase64: tx },
    });
    assert.equal(response.status, 401);
    assert.equal(calls.get, 0);
    assert.equal(calls.submit, 0);
  });

  await t.test('revoked session is rejected before submit lookup', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${matchId}/submit`, {
      credential: revoked,
      input: { requestId: '12345678-1234-1234-1234-123456789018', transactionBase64: tx },
    });
    assert.equal(response.status, 401);
    assert.equal(calls.get, 0);
    assert.equal(calls.submit, 0);
  });

  await t.test('missing authorization is rejected before submit', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${matchId}/submit`, {
      input: { requestId: '12345678-1234-1234-1234-123456789019', transactionBase64: tx },
    });
    assert.equal(response.status, 401);
    assert.equal(calls.get, 0);
    assert.equal(calls.submit, 0);
  });

  await t.test('session login is not a transaction: submit still requires signed bytes', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${matchId}/submit`, {
      credential: session1,
      input: { requestId: '12345678-1234-1234-1234-123456789020' },
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_INPUT');
    assert.equal(calls.get, 0);
    assert.equal(calls.submit, 0);
  });

  await t.test('legacy static token still submits without session wallet bind', async () => {
    calls.get = calls.submit = 0;
    const response = await post(`/v1/lending/intents/${matchId}/submit`, {
      credential: token,
      input: { requestId: '12345678-1234-1234-1234-123456789021', transactionBase64: tx },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.get, 0);
    assert.equal(calls.submit, 1);
  });
});

test('T72: yield JWT path is unchanged and does not authorize mesh or lending', async t => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${'e'.repeat(500)}.sig`;
  const user = '123e4567-e89b-42d3-a456-426614174000';
  let jwtCalls = 0;
  let lendingCalls = 0;
  const server = createApi({
    store: { async ready() {}, async getGraph() { return { nodes: [] }; } },
    lending: { async prepare() { lendingCalls += 1; return { id: 'intent' }; } },
    yieldService: { async getOpportunities() { return { status: 'NO_DATA', opportunities: [] }; } },
    tokenHashes: hashes,
    verifySupabaseToken: async value => {
      jwtCalls += 1;
      return value === jwt ? user : null;
    },
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('Supabase JWT still authorizes yield', async () => {
    jwtCalls = 0;
    const response = await fetch(`${base}/v1/yield/opportunities`, { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(response.status, 200);
    assert.equal(jwtCalls, 1);
  });

  await t.test('Supabase JWT does not authorize graph', async () => {
    const response = await fetch(`${base}/v1/graph`, { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(response.status, 401);
  });

  await t.test('Supabase JWT does not authorize lending', async () => {
    lendingCalls = 0;
    const response = await fetch(`${base}/v1/lending/intents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: '12345678-1234-1234-1234-123456789022',
        analysisId: '87654321-4321-4321-4321-210987654321',
        wallet: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
        action: 'supply',
        inputBaseUnits: '1000000',
      }),
    });
    assert.equal(response.status, 401);
    assert.equal(lendingCalls, 0);
  });

  await t.test('legacy static token still authorizes yield without JWT verify', async () => {
    jwtCalls = 0;
    const response = await fetch(`${base}/v1/yield/opportunities`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.equal(jwtCalls, 0);
  });
});

