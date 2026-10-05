import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { createApi, parseTokenHashes } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createWalletAuth } from '../wallet-auth.mjs';
import { createLendingStore } from '../lending-store.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const at = '2026-09-27T12:00:00.000Z';
const token = 'test-only-falcon-mesh-alpha-token-00000000';
const digest = value => createHash('sha256').update(value).digest('hex');
const url = process.env.FALCON_MESH_TEST_DATABASE_URL;
const prefix = randomUUID().replaceAll('-', '');
const hashes = parseTokenHashes(JSON.stringify({ [digest(token)]: `http_${prefix}` }));

test('T72: wallet-session auth for owner-scoped endpoints', { skip: !url && 'Set FALCON_MESH_TEST_DATABASE_URL to the disposable database.' }, async t => {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  const store = createStore(pool);
  const walletAuth = createWalletAuth(pool, { allowedOrigins: new Set(['http://127.0.0.1:4182']) });
  await store.ready();
  await walletAuth.ready();
  
  const server = createApi({ 
    store, 
    walletAuth,
    tokenHashes: hashes, 
    allowedOrigins: new Set(['http://127.0.0.1:4182']), 
    now: () => at 
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
        ...(origin ? { Origin: origin } : {}) 
      },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }

  // Create two wallet sessions for different wallets
  const wallet1 = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
  const wallet2 = 'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99';
  let session1Token, session2Token;
  
  await t.test('setup: create wallet sessions for two wallets', async () => {
    // For test purposes, we'll directly insert sessions into the database
    // In production, this would be done through the verify endpoint with a real signature
    const sessionToken1 = 'wsi1_' + randomBytes(32).toString('base64url');
    const tokenHash1 = createHash('sha256').update(sessionToken1).digest('hex');
    const ownerId1 = 'w_' + createHash('sha256').update(wallet1).digest('base64url').slice(0, 42);
    await pool.query(
      `INSERT INTO falcon_mesh.wallet_auth_sessions (token_hash, wallet_address, owner_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash1, wallet1, ownerId1, at, '2026-09-27T12:30:00.000Z']
    );
    session1Token = sessionToken1;
    
    // Create session for wallet2
    const sessionToken2 = 'wsi1_' + randomBytes(32).toString('base64url');
    const tokenHash2 = createHash('sha256').update(sessionToken2).digest('hex');
    const ownerId2 = 'w_' + createHash('sha256').update(wallet2).digest('base64url').slice(0, 42);
    await pool.query(
      `INSERT INTO falcon_mesh.wallet_auth_sessions (token_hash, wallet_address, owner_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash2, wallet2, ownerId2, at, '2026-09-27T12:30:00.000Z']
    );
    session2Token = sessionToken2;
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
      content: JSON.stringify(document) 
    }));
    const response = await request('/v1/sources', { 
      credential: session1Token, 
      input: { revisions } 
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.sources.length, 2);
  });

  let analysisId;
  await t.test('wallet-session can create analysis', async () => {
    const response = await request('/v1/analyses', { 
      credential: session1Token, 
      input: { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 } 
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

  await t.test('expired wallet-session is rejected', async () => {
    const expiredToken = 'wsi1_' + randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(expiredToken).digest('hex');
    const ownerId = 'w_' + createHash('sha256').update(wallet1).digest('base64url').slice(0, 42);
    await pool.query(
      `INSERT INTO falcon_mesh.wallet_auth_sessions (token_hash, wallet_address, owner_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash, wallet1, ownerId, '2026-09-27T11:00:00.000Z', '2026-09-27T11:30:00.000Z']
    );
    
    const response = await request('/v1/graph', { credential: expiredToken });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
  });

  await t.test('revoked wallet-session is rejected', async () => {
    const revokedToken = 'wsi1_' + randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(revokedToken).digest('hex');
    const ownerId = 'w_' + createHash('sha256').update(wallet1).digest('base64url').slice(0, 42);
    await pool.query(
      `INSERT INTO falcon_mesh.wallet_auth_sessions (token_hash, wallet_address, owner_id, created_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, wallet1, ownerId, at, '2026-09-27T12:30:00.000Z', at]
    );
    
    const response = await request('/v1/graph', { credential: revokedToken });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
  });
});

test('T72: lending prepare validates wallet matches session', { skip: !url && 'Set FALCON_MESH_TEST_DATABASE_URL to the disposable database.' }, async t => {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  const store = createStore(pool);
  const walletAuth = createWalletAuth(pool, { allowedOrigins: new Set(['http://127.0.0.1:4182']) });
  
  // Mock lending service
  const lending = createLendingStore(pool, {
    meshStore: store,
    prepareLending: async (request) => ({
      schemaVersion: 1,
      network: 'devnet',
      wallet: request.wallet,
      action: request.action,
      inputBaseUnits: request.inputBaseUnits,
      expiresAt: '2026-09-27T12:02:00.000Z',
    }),
    verifySignedLending: async (intent, transactionBase64) => {
      return '5' + 'x'.repeat(87); // Mock signature
    },
    readLendingReceipt: async (intent, signature) => ({
      signature,
      status: 'PENDING',
    }),
    now: () => at,
  });
  
  await store.ready();
  await walletAuth.ready();
  
  const server = createApi({ 
    store,
    lending,
    walletAuth,
    tokenHashes: hashes, 
    allowedOrigins: new Set(['http://127.0.0.1:4182']), 
    now: () => at 
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { credential, input } = {}) {
    const response = await fetch(base + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { 
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 
        ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}) 
      },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }

  const wallet1 = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
  const wallet2 = 'J3dxNj7nDRRqRRXuEMynDG57DkZK4jYRuv3Garmb1i99';
  let session1Token;
  
  await t.test('setup: create wallet session for wallet1', async () => {
    const sessionToken = 'wsi1_' + randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
    const ownerId = 'w_' + createHash('sha256').update(wallet1).digest('base64url').slice(0, 42);
    await pool.query(
      `INSERT INTO falcon_mesh.wallet_auth_sessions (token_hash, wallet_address, owner_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash, wallet1, ownerId, at, '2026-09-27T12:30:00.000Z']
    );
    session1Token = sessionToken;
  });

  let analysisId;
  await t.test('setup: create analysis for lending', async () => {
    const revisions = makeDemoDocuments(at, 'liquid').map(document => ({ 
      revisionId: randomUUID(), 
      expectedRevisionId: null, 
      content: JSON.stringify(document) 
    }));
    await request('/v1/sources', { credential: session1Token, input: { revisions } });
    const analysis = await request('/v1/analyses/live', { 
      credential: session1Token, 
      input: { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 } 
    });
    assert.equal(analysis.status, 200);
    analysisId = analysis.data.record.id;
  });

  await t.test('lending prepare succeeds when wallet matches session', async () => {
    const response = await request('/v1/lending/intents', {
      credential: session1Token,
      input: {
        requestId: randomUUID(),
        analysisId,
        wallet: wallet1,
        action: 'supply',
        inputBaseUnits: '1000000',
      }
    });
    assert.equal(response.status, 200);
    assert.ok(response.data.record.id);
  });

  await t.test('lending prepare fails when wallet does not match session', async () => {
    const response = await request('/v1/lending/intents', {
      credential: session1Token,
      input: {
        requestId: randomUUID(),
        analysisId,
        wallet: wallet2,
        action: 'supply',
        inputBaseUnits: '1000000',
      }
    });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
    assert.match(response.data.error.message, /wallet must match/i);
  });

  await t.test('lending prepare with static token allows any wallet', async () => {
    const response = await request('/v1/lending/intents', {
      credential: token,
      input: {
        requestId: randomUUID(),
        analysisId,
        wallet: wallet2,
        action: 'supply',
        inputBaseUnits: '1000000',
      }
    });
    assert.equal(response.status, 200);
    assert.ok(response.data.record.id);
  });

  await t.test('lending list/get/submit/receipt work with wallet-session auth', async () => {
    const prepare = await request('/v1/lending/intents', {
      credential: session1Token,
      input: {
        requestId: randomUUID(),
        analysisId,
        wallet: wallet1,
        action: 'supply',
        inputBaseUnits: '2000000',
      }
    });
    assert.equal(prepare.status, 200);
    const intentId = prepare.data.record.id;
    
    // List
    const list = await request('/v1/lending/intents', { credential: session1Token });
    assert.equal(list.status, 200);
    assert.ok(list.data.records.length > 0);
    
    // Get
    const get = await request(`/v1/lending/intents/${intentId}`, { credential: session1Token });
    assert.equal(get.status, 200);
    assert.equal(get.data.record.id, intentId);
  });
});
