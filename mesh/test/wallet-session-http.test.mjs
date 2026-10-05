import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { createApi, parseTokenHashes } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createWalletAuth } from '../wallet-auth.mjs';
import { createLendingStore } from '../lending-store.mjs';
import { captureSource } from '../live.mjs';
import { ADAPTER_VERSION } from '../kamino-wire.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

// Every wallet session in this file is minted by the REAL challenge/verify flow
// (createChallenge -> ed25519 signature -> verifyChallenge), never by a raw INSERT, so owner IDs
// come from deriveWalletOwnerId and satisfy the ^wallet_[a-f0-9]{56}$ column check. ONE injected
// clock per suite drives both createWalletAuth and every time-dependent assertion.
const at = '2026-09-27T12:00:00.000Z';
const T0 = Date.parse(at);
const SESSION_TTL_MS = 30 * 60_000;
const origin = 'http://127.0.0.1:4182';
const token = 'test-only-falcon-mesh-alpha-token-00000000';
const digest = value => createHash('sha256').update(value).digest('hex');
const url = process.env.FALCON_MESH_TEST_DATABASE_URL;
const prefix = randomUUID().replaceAll('-', '');
const hashes = parseTokenHashes(JSON.stringify({ [digest(token)]: `http_${prefix}` }));
const skip = !url && 'Set FALCON_MESH_TEST_DATABASE_URL to the disposable database.';

const newWallet = () => {
  const pair = generateKeyPairSync('ed25519');
  const address = new PublicKey(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toBase58();
  return { pair, address };
};
async function login(walletAuth, wallet) {
  const challenge = await walletAuth.createChallenge(wallet.address, origin);
  const signature = sign(null, Buffer.from(challenge.message, 'utf8'), wallet.pair.privateKey).toString('base64');
  const session = await walletAuth.verifyChallenge(challenge.challengeId, signature, origin);
  assert.match(session.ownerId, /^wallet_[a-f0-9]{56}$/);
  assert.equal(session.walletAddress, wallet.address);
  return session;
}
function client(base) {
  return async function request(path, { credential, input, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('T72: wallet-session auth for owner-scoped endpoints', { skip }, async t => {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  let time = T0;
  const clock = () => time;
  const iso = () => new Date(time).toISOString();
  const store = createStore(pool, { now: iso });
  const walletAuth = createWalletAuth(pool, { allowedOrigins: new Set([origin]), clock });
  await store.ready();
  await walletAuth.ready();

  const server = createApi({ store, walletAuth, tokenHashes: hashes, allowedOrigins: new Set([origin]), now: iso });
  const base = await listen(server);
  const ownerIds = [];
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pool.query('DELETE FROM falcon_mesh.wallet_auth_sessions WHERE owner_id = ANY($1::text[])', [ownerIds]);
    await pool.end();
  });
  const request = client(base);
  const sessionRow = async sessionToken => (await pool.query(
    'SELECT owner_id, created_at, expires_at, revoked_at FROM falcon_mesh.wallet_auth_sessions WHERE token_hash = $1', [digest(sessionToken)],
  )).rows[0];

  const wallet1 = newWallet();
  const wallet2 = newWallet();
  let session1;
  let session2;

  await t.test('setup: real challenge/verify mints sessions for two distinct wallets on the injected clock', async () => {
    session1 = await login(walletAuth, wallet1);
    session2 = await login(walletAuth, wallet2);
    ownerIds.push(session1.ownerId, session2.ownerId);
    assert.notEqual(session1.ownerId, session2.ownerId);
    assert.equal(Date.parse(session1.expiresAt), T0 + SESSION_TTL_MS);
    const row = await sessionRow(session1.sessionToken);
    assert.equal(row.owner_id, session1.ownerId);
    assert.equal(row.revoked_at, null);
  });

  await t.test('wallet-session can access graph endpoint', async () => {
    const response = await request('/v1/graph', { credential: session1.sessionToken });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.data.graph.nodes));
  });

  await t.test('wallet-session can access connectors endpoint', async () => {
    const response = await request('/v1/connectors', { credential: session1.sessionToken });
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
    const response = await request('/v1/sources', { credential: session1.sessionToken, input: { revisions } });
    assert.equal(response.status, 200);
    assert.equal(response.data.sources.length, 2);
  });

  let analysisId;
  await t.test('wallet-session can create analysis', async () => {
    const response = await request('/v1/analyses', {
      credential: session1.sessionToken,
      input: { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 },
    });
    assert.equal(response.status, 200);
    assert.ok(response.data.record.id);
    analysisId = response.data.record.id;
  });

  await t.test('wallet-session can list analyses', async () => {
    const response = await request('/v1/analyses', { credential: session1.sessionToken });
    assert.equal(response.status, 200);
    assert.ok(response.data.records.some(record => record.id === analysisId));
  });

  await t.test('cross-owner isolation: wallet2 sees none of wallet1 data and wallet1 still sees its own', async () => {
    // Positive controls: the data exists and is visible to its owner, so the empties below are not vacuous.
    const own = await request('/v1/graph', { credential: session1.sessionToken });
    assert.ok(own.data.graph.nodes.length > 0);
    assert.equal((await request(`/v1/sources/${revisions[0].revisionId}`, { credential: session1.sessionToken })).status, 200);
    assert.equal((await request(`/v1/analyses/${analysisId}`, { credential: session1.sessionToken })).status, 200);

    const graph = await request('/v1/graph', { credential: session2.sessionToken });
    assert.equal(graph.status, 200);
    assert.equal(graph.data.graph.nodes.length, 0);

    const analyses = await request('/v1/analyses', { credential: session2.sessionToken });
    assert.equal(analyses.status, 200);
    assert.deepEqual(analyses.data.records, []);

    const source = await request(`/v1/sources/${revisions[0].revisionId}`, { credential: session2.sessionToken });
    assert.equal(source.status, 404);
    const analysis = await request(`/v1/analyses/${analysisId}`, { credential: session2.sessionToken });
    assert.equal(analysis.status, 404);
  });

  await t.test('legacy static token still works and sees none of the wallet data', async () => {
    const response = await request('/v1/graph', { credential: token });
    assert.equal(response.status, 200);
    assert.equal(response.data.graph.nodes.length, 0);
  });

  await t.test('invalid wallet-session token is rejected', async () => {
    const response = await request('/v1/graph', { credential: 'wsi1_invalid_token_aaaaaaaaaaaaaaaaaaaaaaaaaa' });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
  });

  await t.test('well-formed but never-issued wallet-session token is rejected', async () => {
    const response = await request('/v1/graph', { credential: `wsi1_${'A'.repeat(43)}` });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
  });

  await t.test('expired wallet-session is rejected on expiry alone while a control session from the same wallet stays valid', async () => {
    try {
      time = T0;
      const expiring = await login(walletAuth, wallet1);
      const expiresAt = Date.parse(expiring.expiresAt);
      assert.equal(expiresAt, T0 + SESSION_TTL_MS);

      time = T0 + 20 * 60_000;
      const control = await login(walletAuth, wallet1); // expires at T0 + 50m
      assert.equal(Date.parse(control.expiresAt), T0 + 50 * 60_000);
      // Precondition: before its expiry the soon-to-expire session is accepted.
      assert.equal((await request('/v1/analyses', { credential: expiring.sessionToken })).status, 200);

      time = expiresAt - 1; // last valid millisecond
      assert.equal((await request('/v1/analyses', { credential: expiring.sessionToken })).status, 200);

      for (const probe of [expiresAt, expiresAt + 60_000]) { // the expiry instant itself and one minute after
        time = probe;
        const expired = await request('/v1/analyses', { credential: expiring.sessionToken });
        assert.equal(expired.status, 401);
        assert.equal(expired.data.error.code, 'UNAUTHORIZED');
        const alive = await request('/v1/analyses', { credential: control.sessionToken });
        assert.equal(alive.status, 200);
        assert.ok(alive.data.records.some(record => record.id === analysisId), 'control session still reads the owner data');
      }

      // The 401 is caused by expiry alone: the row still exists and was never revoked.
      const row = await sessionRow(expiring.sessionToken);
      assert.ok(row, 'expired session row still exists');
      assert.equal(row.revoked_at, null);
      assert.ok(new Date(row.expires_at).getTime() <= time);
    } finally {
      time = T0;
    }
  });

  await t.test('revoked wallet-session is rejected on revocation alone while a control session from the same wallet stays valid', async () => {
    time = T0;
    const revoked = await login(walletAuth, wallet1);
    const control = await login(walletAuth, wallet1);
    for (const session of [revoked, control]) {
      assert.equal((await request('/v1/analyses', { credential: session.sessionToken })).status, 200);
    }

    const logout = await request('/v1/auth/wallet/logout', { credential: revoked.sessionToken, input: {}, headers: { Origin: origin } });
    assert.equal(logout.status, 200);
    assert.equal(logout.data.revoked, true);

    const rejected = await request('/v1/analyses', { credential: revoked.sessionToken });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.data.error.code, 'UNAUTHORIZED');
    const alive = await request('/v1/analyses', { credential: control.sessionToken });
    assert.equal(alive.status, 200);
    assert.ok(alive.data.records.some(record => record.id === analysisId));

    // The 401 is caused by revocation alone: the session is still inside its lifetime.
    const row = await sessionRow(revoked.sessionToken);
    assert.ok(row, 'revoked session row still exists');
    assert.notEqual(row.revoked_at, null);
    assert.ok(new Date(row.expires_at).getTime() > time);
    assert.equal((await sessionRow(control.sessionToken)).revoked_at, null);
  });
});

const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const SIGNED = Buffer.from('fixture signed exact message').toString('base64');
const SIGNATURE = '2'.repeat(88);
async function publicFetch(_url, init) {
  if (init.method === 'GET') return new Response(`## Deployments\n* Devnet: \`${KLEND}\`\n`);
  const input = JSON.parse(init.body);
  return Response.json({ jsonrpc: '2.0', id: input.id, result: input.method === 'getGenesisHash' ? GENESIS : {
    context: { slot: 123 }, value: { owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: true, data: [Buffer.alloc(36, 1).toString('base64'), 'base64'], space: 36 },
  } });
}

test('T72: lending prepare validates wallet matches session', { skip }, async t => {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  const time = T0;
  const clock = () => time;
  const iso = () => new Date(time).toISOString();
  const store = createStore(pool, { now: iso, capture: (id, options) => captureSource(id, { ...options, fetchImpl: publicFetch }) });
  const walletAuth = createWalletAuth(pool, { allowedOrigins: new Set([origin]), clock });
  const calls = { prepare: 0, verify: 0, receipt: 0 };
  // Only the Kamino adapter and chain reads are replaced; the lending store, its owner scoping,
  // HTTP routing and wallet-session auth are the real implementations.
  const lending = createLendingStore(pool, {
    meshStore: store,
    prepareLending: async request => {
      calls.prepare += 1;
      return {
        schemaVersion: 1, network: 'devnet', genesisHash: GENESIS, walletControl: 'unverified',
        policyVersion: 'mesh-public-evidence/1', adapterVersion: ADAPTER_VERSION, ...request,
        transactionBase64: Buffer.from('fixture unsigned message').toString('base64'), messageSha256: 'a'.repeat(64),
        snapshot: { capturedAt: at, graph: { nodes: [], edges: [] } }, estimatedAmounts: { liquidityBaseUnits: '1', receiptBaseUnits: '1' },
      };
    },
    verifySignedLending: async (_intent, transactionBase64) => {
      calls.verify += 1;
      assert.equal(transactionBase64, SIGNED);
      return SIGNATURE;
    },
    readLendingReceipt: async (_intent, signature) => {
      calls.receipt += 1;
      return { status: 'PENDING', signature, observedAt: iso(), slot: null, amounts: null, exchanges: [], reason: 'Fixture pending.' };
    },
    now: iso,
  });
  await store.ready();
  await walletAuth.ready();

  const server = createApi({ store, lending, walletAuth, tokenHashes: hashes, allowedOrigins: new Set([origin]), now: iso });
  const base = await listen(server);
  const ownerIds = [];
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pool.query('DELETE FROM falcon_mesh.wallet_auth_sessions WHERE owner_id = ANY($1::text[])', [ownerIds]);
    await pool.end();
  });
  const request = client(base);

  // Exits are never gated by a reserve decision, so `redeem` exercises wallet binding independently of supply gating.
  const action = 'redeem';
  async function liveAnalysis(credential) {
    for (const connectorId of ['kamino-program-docs', 'solana-devnet-klend']) {
      const capture = await request('/v1/captures', { credential, input: { requestId: randomUUID(), connectorId, expectedRevisionId: null } });
      assert.equal(capture.status, 200);
    }
    const analysis = await request('/v1/analyses/live', {
      credential, input: { requestId: randomUUID(), observationId: 'observation:live:solana-devnet-klend', maxHops: 3 },
    });
    assert.equal(analysis.status, 200);
    assert.equal(analysis.data.record.analysis.status, 'OBSERVED');
    return analysis.data.record.id;
  }
  const prepareBody = (analysisId, wallet, inputBaseUnits = '1000000') => ({ requestId: randomUUID(), analysisId, wallet, action, inputBaseUnits });

  const wallet1 = newWallet();
  const wallet2 = newWallet();
  let session1;
  let session2;
  let analysisId;
  let intentId;

  await t.test('setup: real wallet sessions and a live OBSERVED analysis for wallet1', async () => {
    session1 = await login(walletAuth, wallet1);
    session2 = await login(walletAuth, wallet2);
    ownerIds.push(session1.ownerId, session2.ownerId);
    analysisId = await liveAnalysis(session1.sessionToken);
  });

  await t.test('lending prepare succeeds when wallet matches session', async () => {
    const before = calls.prepare;
    const response = await request('/v1/lending/intents', { credential: session1.sessionToken, input: prepareBody(analysisId, wallet1.address) });
    assert.equal(response.status, 200);
    assert.equal(response.data.record.request.wallet, wallet1.address);
    assert.equal(response.data.record.analysisId, analysisId);
    assert.equal(calls.prepare, before + 1);
    intentId = response.data.record.id;
  });

  await t.test('lending prepare fails when wallet does not match session and persists nothing', async () => {
    const before = { prepare: calls.prepare, listed: (await request('/v1/lending/intents', { credential: session1.sessionToken })).data.records.length };
    const body = prepareBody(analysisId, wallet2.address);
    const response = await request('/v1/lending/intents', { credential: session1.sessionToken, input: body });
    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, 'UNAUTHORIZED');
    assert.match(response.data.error.message, /wallet must match/i);
    assert.equal(calls.prepare, before.prepare, 'adapter must not run for a foreign wallet');
    const after = await request('/v1/lending/intents', { credential: session1.sessionToken });
    assert.equal(after.data.records.length, before.listed);
    assert.ok(!after.data.records.some(record => record.requestId === body.requestId));
  });

  await t.test('lending prepare with static token allows any wallet (against the static owner own live analysis)', async () => {
    const staticAnalysis = await liveAnalysis(token);
    const response = await request('/v1/lending/intents', { credential: token, input: prepareBody(staticAnalysis, wallet2.address) });
    assert.equal(response.status, 200);
    assert.equal(response.data.record.request.wallet, wallet2.address);
  });

  await t.test('lending list/get/submit/receipt work with wallet-session auth', async () => {
    const list = await request('/v1/lending/intents', { credential: session1.sessionToken });
    assert.equal(list.status, 200);
    assert.ok(list.data.records.some(record => record.id === intentId && record.status === 'PREPARED'));

    const get = await request(`/v1/lending/intents/${intentId}`, { credential: session1.sessionToken });
    assert.equal(get.status, 200);
    assert.equal(get.data.record.id, intentId);

    const submit = await request(`/v1/lending/intents/${intentId}/submit`, {
      credential: session1.sessionToken, input: { requestId: randomUUID(), transactionBase64: SIGNED },
    });
    assert.equal(submit.status, 200);
    assert.equal(submit.data.event.kind, 'SUBMITTED');
    assert.equal(submit.data.event.data.signature, SIGNATURE);

    const receipt = await request(`/v1/lending/intents/${intentId}/receipt`, { credential: session1.sessionToken, input: { requestId: randomUUID() } });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.event.kind, 'RECEIPT');
    assert.equal(receipt.data.event.data.status, 'PENDING');

    const relisted = await request('/v1/lending/intents', { credential: session1.sessionToken });
    assert.equal(relisted.data.records.find(record => record.id === intentId).status, 'PENDING');
  });

  await t.test('cross-owner isolation: wallet2 cannot list, read, submit, receipt, or prepare against wallet1 lending data', async () => {
    const list = await request('/v1/lending/intents', { credential: session2.sessionToken });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.records, []);

    assert.equal((await request(`/v1/lending/intents/${intentId}`, { credential: session2.sessionToken })).status, 404);
    const verifyBefore = calls.verify;
    const receiptBefore = calls.receipt;
    assert.equal((await request(`/v1/lending/intents/${intentId}/submit`, {
      credential: session2.sessionToken, input: { requestId: randomUUID(), transactionBase64: SIGNED },
    })).status, 404);
    assert.equal((await request(`/v1/lending/intents/${intentId}/receipt`, {
      credential: session2.sessionToken, input: { requestId: randomUUID() },
    })).status, 404);
    assert.equal(calls.verify, verifyBefore);
    assert.equal(calls.receipt, receiptBefore);

    const foreignAnalysis = await request('/v1/lending/intents', {
      credential: session2.sessionToken, input: prepareBody(analysisId, wallet2.address),
    });
    assert.equal(foreignAnalysis.status, 404, 'wallet2 cannot prepare against wallet1 analysis');
  });
});
