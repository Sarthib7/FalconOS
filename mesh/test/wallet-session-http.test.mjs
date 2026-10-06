import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { createApi, parseTokenHashes } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createWalletAuth, deriveWalletOwnerId } from '../wallet-auth.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const at = '2026-09-27T12:00:00.000Z';
const token = 'test-only-falcon-mesh-alpha-token-00000000';
const digest = value => createHash('sha256').update(value).digest('hex');
const url = process.env.FALCON_MESH_TEST_DATABASE_URL;
const prefix = randomUUID().replaceAll('-', '');
const hashes = parseTokenHashes(JSON.stringify({ [digest(token)]: `http_${prefix}` }));
const wallet1 = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const wallet2 = 'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99';
const tx = Buffer.from('fixture-signed-intent').toString('base64');

function sessionToken() {
  return 'wsi1_' + randomBytes(32).toString('base64url');
}

async function insertSession(pool, wallet, { createdAt, expiresAt, revokedAt } = {}) {
  const credential = sessionToken();
  await pool.query(
    `INSERT INTO falcon_mesh.wallet_auth_sessions
       (token_hash, wallet_address, owner_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [digest(credential), wallet, deriveWalletOwnerId(wallet), createdAt ?? at, expiresAt ?? '2026-09-27T12:30:00.000Z', revokedAt ?? null],
  );
  return credential;
}
test('T72: wallet-session auth for owner-scoped endpoints', { skip: !url && 'Set FALCON_MESH_TEST_DATABASE_URL to the disposable database.' }, async t => {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  const store = createStore(pool);
  const walletAuth = createWalletAuth(pool, {
    allowedOrigins: new Set(['http://127.0.0.1:4182']),
    clock: () => Date.parse(at),
  });
  await store.ready();
  await walletAuth.ready();

  const server = createApi({
    store,
    walletAuth,
    tokenHashes: hashes,
    allowedOrigins: new Set(['http://127.0.0.1:4182']),
    now: () => at,
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });

  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { credential, input, origin } = {}) {
    const response = await fetch(base + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }

  let session1Token;
  let session2Token;

  await t.test('setup: create wallet sessions for two wallets', async () => {
    session1Token = await insertSession(pool, wallet1);
    session2Token = await insertSession(pool, wallet2);
  });

  await t.test('wallet-session can access graph endpoint', async () => {
    const response = await request('/v1/graph', { credential: session1Token });
    assert.equal(response.status, 200);
    assert.ok(response.data.graph);
    assert.ok(Array.isArray(response.data.graph.nodes));
  });

  await t.test('wallet-session can access connectors endpoint', async () => {
    const response = await request('/v1/connectors', { credential: session1Token });
    assert.equal(response.status, 200);
    assert.ok(response.data.connectors);
  });

  let revisions;
  await t.test('wallet-session can create sources', async () => {
    revisions = makeDemoDocuments(at, 'liquid').map(document => ({
      revisionId: randomUUID(),
      expectedRevisionId: null,
      content: JSON.stringify(document),
    }));
    const response = await request('/v1/sources', { credential: session1Token, input: { revisions } });
    assert.equal(response.status, 200);
    assert.equal(response.data.sources.length, 2);
  });

  let analysisId;
  await t.test('wallet-session can create analysis', async () => {
    const response = await request('/v1/analyses', {
      credential: session1Token,
      input: { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 },
    });
    assert.equal(response.status, 200);
    assert.ok(response.data.record.id);
    analysisId = response.data.record.id;
  });

  await t.test('wallet-session can list analyses', async () => {
    const response = await request('/v1/analyses', { credential: session1Token });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.data.records));
    assert.ok(response.data.records.length > 0);
  });

  await t.test('cross-owner isolation: wallet2 cannot see wallet1 data', async () => {
    const graph = await request('/v1/graph', { credential: session2Token });
    assert.equal(graph.status, 200);
    assert.equal(graph.data.graph.nodes.length, 0);

    const analyses = await request('/v1/analyses', { credential: session2Token });
    assert.equal(analyses.status, 200);
    assert.equal(analyses.data.records.length, 0);

    const source = await request(`/v1/sources/${revisions[0].revisionId}`, { credential: session2Token });
    assert.equal(source.status, 404);

    const analysis = await request(`/v1/analyses/${analysisId}`, { credential: session2Token });
    assert.equal(analysis.status, 404);
  });

  await t.test('legacy static token still works', async () => {
    const response = await request('/v1/graph', { credential: token });
    assert.equal(response.status, 200);
    assert.ok(response.data.graph);
  });

  await t.test('invalid wallet-session token is rejected', async () => {
    const response = await request('/v1/graph', { credential: 'wsi1_invalid_token_aaaaaaaaaaaaaaaaaaaaaaaaaa' });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
  });

  await t.test('missing authorization is rejected', async () => {
    const response = await request('/v1/graph');
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
  });

  await t.test('expired wallet-session is rejected while a live session still works', async () => {
    const expiredToken = await insertSession(pool, wallet1, { createdAt: '2026-09-27T11:00:00.000Z', expiresAt: '2026-09-27T11:30:00.000Z' });
    const expired = await request('/v1/graph', { credential: expiredToken });
    assert.equal(expired.status, 401);
    assert.equal(expired.data.error.code, 'UNAUTHORIZED');
    const live = await request('/v1/graph', { credential: session1Token });
    assert.equal(live.status, 200);
  });

  await t.test('revoked wallet-session is rejected while a live session still works', async () => {
    const revokedToken = await insertSession(pool, wallet1, { revokedAt: at });
    const revoked = await request('/v1/graph', { credential: revokedToken });
    assert.equal(revoked.status, 401);
    assert.equal(revoked.data.error.code, 'UNAUTHORIZED');
    const live = await request('/v1/graph', { credential: session1Token });
    assert.equal(live.status, 200);
  });
});

test('T72: lending prepare, submit, and receipt bind the session wallet', { skip: !url && 'Set FALCON_MESH_TEST_DATABASE_URL to the disposable database.' }, async t => {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  const store = createStore(pool);
  const walletAuth = createWalletAuth(pool, {
    allowedOrigins: new Set(['http://127.0.0.1:4182']),
    clock: () => Date.parse(at),
  });
  const matchId = randomUUID();
  const mismatchId = randomUUID();
  const calls = { prepare: 0, get: 0, submit: 0, receipt: 0 };
  const owner1 = deriveWalletOwnerId(wallet1);
  const lending = {
    async prepare() { calls.prepare += 1; return { id: matchId, request: { wallet: wallet1 } }; },
    async get(owner, id) {
      calls.get += 1;
      if (owner !== owner1) return null;
      if (id === matchId) return { record: { id, request: { wallet: wallet1 } }, events: [] };
      if (id === mismatchId) return { record: { id, request: { wallet: wallet2 } }, events: [] };
      return null;
    },
    async submit() { calls.submit += 1; return { id: 'submit-event' }; },
    async receipt() { calls.receipt += 1; return { id: 'receipt-event' }; },
  };

  await store.ready();
  await walletAuth.ready();

  const server = createApi({
    store,
    lending,
    walletAuth,
    tokenHashes: hashes,
    allowedOrigins: new Set(['http://127.0.0.1:4182']),
    now: () => at,
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });

  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { credential, input } = {}) {
    const response = await fetch(base + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }

  let session1Token;
  let session2Token;

  await t.test('setup: create wallet sessions', async () => {
    session1Token = await insertSession(pool, wallet1);
    session2Token = await insertSession(pool, wallet2);
  });

  await t.test('lending prepare succeeds when wallet matches session', async () => {
    calls.prepare = 0;
    const response = await request('/v1/lending/intents', {
      credential: session1Token,
      input: {
        requestId: randomUUID(),
        analysisId: randomUUID(),
        wallet: wallet1,
        action: 'supply',
        inputBaseUnits: '1000000',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.prepare, 1);
  });

  await t.test('lending prepare fails when wallet does not match session', async () => {
    calls.prepare = 0;
    const response = await request('/v1/lending/intents', {
      credential: session1Token,
      input: {
        requestId: randomUUID(),
        analysisId: randomUUID(),
        wallet: wallet2,
        action: 'supply',
        inputBaseUnits: '1000000',
      },
    });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
    assert.match(response.data.error.message, /wallet must match/i);
    assert.equal(calls.prepare, 0);
  });

  await t.test('lending prepare with static token allows any wallet', async () => {
    calls.prepare = 0;
    const response = await request('/v1/lending/intents', {
      credential: token,
      input: {
        requestId: randomUUID(),
        analysisId: randomUUID(),
        wallet: wallet2,
        action: 'supply',
        inputBaseUnits: '1000000',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.prepare, 1);
  });

  await t.test('submit and receipt reject stored wallet mismatch before mutation', async () => {
    calls.get = calls.submit = calls.receipt = 0;
    const submit = await request(`/v1/lending/intents/${mismatchId}/submit`, {
      credential: session1Token,
      input: { requestId: randomUUID(), transactionBase64: tx },
    });
    assert.equal(submit.status, 401);
    assert.equal(calls.submit, 0);
    const receipt = await request(`/v1/lending/intents/${mismatchId}/receipt`, {
      credential: session1Token,
      input: { requestId: randomUUID() },
    });
    assert.equal(receipt.status, 401);
    assert.equal(calls.receipt, 0);
  });

  await t.test('submit and receipt succeed when stored wallet matches session', async () => {
    calls.submit = calls.receipt = 0;
    const submit = await request(`/v1/lending/intents/${matchId}/submit`, {
      credential: session1Token,
      input: { requestId: randomUUID(), transactionBase64: tx },
    });
    assert.equal(submit.status, 200);
    assert.equal(calls.submit, 1);
    const receipt = await request(`/v1/lending/intents/${matchId}/receipt`, {
      credential: session1Token,
      input: { requestId: randomUUID() },
    });
    assert.equal(receipt.status, 200);
    assert.equal(calls.receipt, 1);
  });

  await t.test('cross-owner submit cannot mutate another wallet intent', async () => {
    calls.submit = 0;
    const response = await request(`/v1/lending/intents/${matchId}/submit`, {
      credential: session2Token,
      input: { requestId: randomUUID(), transactionBase64: tx },
    });
    assert.equal(response.status, 404);
    assert.equal(calls.submit, 0);
  });

  await t.test('expired and revoked sessions reject lending mutations', async () => {
    const expiredToken = await insertSession(pool, wallet1, { createdAt: '2026-09-27T11:00:00.000Z', expiresAt: '2026-09-27T11:30:00.000Z' });
    const revokedToken = await insertSession(pool, wallet1, { revokedAt: at });
    calls.submit = 0;
    const expired = await request(`/v1/lending/intents/${matchId}/submit`, {
      credential: expiredToken,
      input: { requestId: randomUUID(), transactionBase64: tx },
    });
    const revoked = await request(`/v1/lending/intents/${matchId}/submit`, {
      credential: revokedToken,
      input: { requestId: randomUUID(), transactionBase64: tx },
    });
    assert.equal(expired.status, 401);
    assert.equal(revoked.status, 401);
    assert.equal(calls.submit, 0);
  });
});
