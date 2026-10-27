import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import { Pool } from 'pg';
import { createApi } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createWalletAuth, deriveWalletOwnerId } from '../wallet-auth.mjs';
import { createCfoStore } from '../cfo/store.mjs';
import { createCfoService } from '../cfo/service.mjs';
import { createIntentsAdapter } from '../cfo/intents.mjs';
import { canonicalBytes, sha256 } from '../council/evidence.ts';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const digest = value => createHash('sha256').update(value).digest('hex');

test('V197/V213: CFO records and traces require wallet identity and isolate retained evidence', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 });
  const origin = 'http://127.0.0.1:4183';
  const allowedOrigins = new Set([origin]);
  const walletAuth = createWalletAuth(pool, { allowedOrigins });
  const store = createStore(pool);
  const cfoStore = createCfoStore(pool);
  const cfo = createCfoService({ store: cfoStore, adapter: createIntentsAdapter({ enabled: false }) });
  const operator = randomBytes(32).toString('hex');
  const wallets = [Keypair.generate(), Keypair.generate()];
  const credentials = [];
  for (const key of wallets) {
    const address = key.publicKey.toBase58();
    const token = 'wsi1_' + randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO falcon_mesh.wallet_auth_sessions
      (token_hash,wallet_address,owner_id,created_at,expires_at)
      VALUES ($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '20 minutes')`,
    [digest(token), address, deriveWalletOwnerId(address)]);
    credentials.push(token);
  }
  const address = wallets[0].publicKey.toBase58();
  const owner = deriveWalletOwnerId(address);
  const { record: retained } = await cfoStore.append(owner, { requestId: randomUUID(), kind: 'portfolio', data: {
    schemaVersion: 1, chain: 'near', network: 'mainnet', wallet: address,
    signerId: Buffer.from(wallets[0].publicKey.toBytes()).toString('hex'),
    capturedAt: new Date().toISOString(), blockHash: { signedData: 'private-trace-block-marker' }, blockHeight: null,
    assets: [], balances: [], status: 'NO_DATA', reasons: ['Test-owned unavailable source record.'],
  } });
  const api = createApi({ store, walletAuth, cfo, allowedOrigins,
    tokenHashes: new Map([[digest(operator), owner]]) });
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    await cfo.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
    await pool.query('DELETE FROM falcon_mesh.wallet_auth_sessions WHERE token_hash=ANY($1::text[])', [credentials.map(digest)]);
    await pool.query('DELETE FROM falcon_mesh.analyses WHERE owner_id=ANY($1::text[])', [wallets.map(key => deriveWalletOwnerId(key.publicKey.toBase58()))]);
    await pool.end();
  });
  const base = `http://127.0.0.1:${api.address().port}`;
  async function request(path, credential, body) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin, authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, payload: await response.json() };
  }
  const own = await request('/v1/cfo/records/' + retained.id, credentials[0]);
  assert.equal(own.status, 200);
  assert.equal(own.payload.record.data.wallet, address);
  const tracePath = '/v1/cfo/records/' + retained.id + '/trace';
  const traced = await request(tracePath, credentials[0]);
  assert.equal(traced.status, 200);
  assert.equal(traced.payload.trace.rootRecordId, retained.id);
  assert.equal(traced.payload.trace.rootHash, retained.contentHash);
  assert.equal(traced.payload.trace.status, 'NO_DATA');
  assert.equal(traced.payload.trace.executionReady, false);
  assert.deepEqual(traced.payload.trace.nodes.map(node => ({
    recordId: node.recordId, kind: node.kind, status: node.status,
  })), [{ recordId: retained.id, kind: 'portfolio', status: 'NO_DATA' }]);
  assert.equal(traced.payload.trace.nodes[0].facts.blockHash, null,
    'unavailable source metadata cannot forward an untyped provider object');
  assert.equal(JSON.stringify(traced).includes('private-trace-block-marker'), false);
  assert.deepEqual((await request(tracePath, credentials[0])).payload.trace, traced.payload.trace,
    'replay cannot replace retained evidence or change its identity');
  const foreignTrace = await request(tracePath, credentials[1]);
  assert.equal(foreignTrace.status, 404);
  assert.equal(JSON.stringify(foreignTrace.payload).includes(retained.contentHash), false);
  assert.equal((await request(tracePath, operator)).status, 401);
  assert.equal((await request(tracePath + '?owner=' + owner, credentials[0])).status, 400);
  const mandateData = {
    schemaVersion: 1, wallet: address, reserveAssetId: 'fixture:reserve',
    reserveFloorBaseUnits: '0', maxActionReserveBaseUnits: '1000000', maxPositionBps: 10000,
    slippageBps: 50, maxFeeBps: 100, maxEvidenceAgeSeconds: 300, targets: [],
    monitorIntervalSeconds: 300, maxMonitorCycles: 1,
  };
  const mandate = (await cfoStore.append(owner, { requestId: randomUUID(), kind: 'mandate', data: mandateData })).record;
  const portfolio = (await cfoStore.append(owner, { requestId: randomUUID(), kind: 'portfolio',
    data: { ...retained.data, blockHash: 'test-only-retained-block', blockHeight: 1, status: 'OBSERVED', reasons: [] } })).record;
  const quotes = (await cfoStore.append(owner, { requestId: randomUUID(), kind: 'quotes',
    data: { schemaVersion: 1, wallet: address, quotes: [] } })).record;
  const planRequest = { requestId: randomUUID(), action: 'hold',
    sourceAssetId: null, targetAssetId: null, inputBaseUnits: null };
  const checkMarker = 'private-retained-check-marker';
  const reviewMarker = 'private-retained-review-marker';
  const snapshot = {
    schemaVersion: 1, domain: 'cfo', capturedAt: new Date().toISOString(),
    portfolio: portfolio.data, mandate: mandate.data, mandateHash: sha256(canonicalBytes(mandate.data)),
    request: planRequest, quotes: [], proposal: null,
    checks: [{ id: 'bad-retained-check', status: 'PASS', detail: { signedData: checkMarker } }],
    reasons: [], status: 'REVIEW',
  };
  const sourceRefs = [mandate, portfolio, quotes].map(record => ({ revisionId: record.id, sha256: record.contentHash }));
  const reviewJobId = randomUUID();
  const badPlan = (await cfoStore.append(owner, { requestId: planRequest.requestId, kind: 'plan', data: {
    schemaVersion: 1, wallet: address, request: planRequest, snapshot, snapshotHash: sha256(canonicalBytes(snapshot)),
    sourceRefs, quoteBindings: [], status: 'REVIEW', reviewJobId, workflow: 'SINGLE',
  } })).record;
  const badReview = (await cfoStore.append(owner, { requestId: randomUUID(), kind: 'review', data: {
    schemaVersion: 1, wallet: address, jobId: reviewJobId, planId: badPlan.id, snapshotHash: badPlan.data.snapshotHash,
    state: 'COMPLETE', phase: 'TERMINAL', result: {
      schemaVersion: 1, runId: reviewJobId, snapshotHash: badPlan.data.snapshotHash,
      lead: null, risk: null, status: { signedData: reviewMarker }, proposal: null, reasons: [], executionReady: false,
    }, deadlineAt: new Date(Date.now() + 60_000).toISOString(), leaseUntil: null, workerId: null, sourceRefs,
  } })).record;
  const requestMarker = 'private-retained-request-marker';
  const badRequestData = structuredClone(badPlan.data);
  badRequestData.request = { ...planRequest, requestId: randomUUID(), sourceAssetId: { signedData: requestMarker } };
  badRequestData.snapshot.request = structuredClone(badRequestData.request);
  badRequestData.snapshot.checks = [];
  badRequestData.snapshotHash = sha256(canonicalBytes(badRequestData.snapshot));
  const badRequest = (await cfoStore.append(owner, {
    requestId: badRequestData.request.requestId, kind: 'plan', data: badRequestData,
  })).record;
  function assertUnavailableProjection(payload, marker) {
    assert.equal(payload.trace.status, 'NO_DATA', 'invalid retained values cannot become an observed assessment');
    assert.equal(JSON.stringify(payload).includes(marker), false, 'private nested data cannot enter trace facts');
    assert.equal(payload.trace.nodes.every(node => typeof node.status === 'string'), true);
    const planNode = payload.trace.nodes.find(node => node.kind === 'plan');
    assert.equal(planNode.facts.checks.every(check => typeof check.id === 'string'
      && typeof check.status === 'string' && typeof check.detail === 'string'), true);
  }
  const malformedCases = [];
  for (const [record, marker] of [[badPlan, checkMarker], [badReview, reviewMarker], [badRequest, requestMarker]]) {
    const response = await request('/v1/cfo/records/' + record.id + '/trace', credentials[0]);
    assert.equal(response.status, 200);
    malformedCases.push({ recordId: record.id, marker, payload: response.payload });
  }
  if (process.env.FALCON_MCP_TEST_BINARY) {
    const child = spawn(process.env.FALCON_MCP_TEST_BINARY, [], {
      env: { ...process.env, PORT: '0', FALCON_MCP_HOST: '127.0.0.1',
        FALCON_MCP_ALLOWED_HOSTS: '127.0.0.1', FALCON_MCP_ORIGIN: origin, FALCON_MESH_API_URL: base },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
      await exited;
    });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('MCP startup timed out.')); }, 10_000);
      let log = '';
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('MCP exited before readiness.')); });
      child.stderr.on('data', bytes => {
        log = (log + bytes).slice(-8192);
        const match = /falcon-mcp listening on (\d+)\./.exec(log);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const rpc = async (credential, extra = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json',
          accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call',
          params: { name: 'falcon_cfo_decision_trace', arguments: { session: credential, recordId: retained.id, ...extra } } }),
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
      return (await response.json()).result;
    };
    const throughMcp = await rpc(credentials[0]);
    assert.notEqual(throughMcp.isError, true);
    assert.deepEqual(throughMcp.structuredContent.trace, traced.payload.trace,
      'MCP redaction must preserve the exact backend trace and its hash');
    const foreignMcp = await rpc(credentials[1]);
    assert.equal(foreignMcp.isError, true);
    assert.equal(foreignMcp.structuredContent.code, 'NOT_FOUND');
    assert.equal(JSON.stringify(foreignMcp).includes(retained.contentHash), false);
    assert.equal((await rpc(credentials[0], { owner })).structuredContent.code, 'INVALID_INPUT');
    for (const entry of malformedCases) {
      const result = await rpc(credentials[0], { recordId: entry.recordId });
      assert.notEqual(result.isError, true);
      assertUnavailableProjection(result.structuredContent, entry.marker);
      assert.deepEqual(result.structuredContent.trace, entry.payload.trace,
        'HTTP and native MCP must return the same typed, hash-bound unavailable projection');
    }
    t.diagnostic('Actual native MCP -> authenticated Mesh -> PostgreSQL trace verified.');
  }
  for (const entry of malformedCases) assertUnavailableProjection(entry.payload, entry.marker);
  await pool.query(`UPDATE falcon_mesh.analyses
    SET analysis = jsonb_set(analysis, '{data,capturedAt}', to_jsonb('2026-01-01T00:00:00.000Z'::text))
    WHERE owner_id = $1 AND id = $2`, [owner, retained.id]);
  const corrupted = await request(tracePath, credentials[0]);
  assert.equal(corrupted.status, 503);
  assert.equal(corrupted.payload.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(corrupted.payload.trace, undefined, 'corrupt evidence cannot reuse an earlier successful trace');
  const foreign = await request('/v1/cfo/records/' + retained.id, credentials[1]);
  assert.equal(foreign.status, 404);
  assert.equal(JSON.stringify(foreign.payload).includes(address), false);
  const operatorRead = await request('/v1/cfo/records/' + retained.id, operator);
  assert.equal(operatorRead.status, 401, 'a static token mapped to the same owner still cannot replace a wallet session');
  const injectedOwner = await request('/v1/cfo/capture', credentials[0], { requestId: randomUUID(), owner });
  assert.equal(injectedOwner.status, 400);
  const mismatchedWallet = await request('/v1/cfo/mandate', credentials[0], { requestId: randomUUID(), mandate: { wallet: wallets[1].publicKey.toBase58() } });
  assert.equal(mismatchedWallet.status, 401);
  await walletAuth.revokeSession(credentials[0]);
  const revoked = await request('/v1/cfo', credentials[0]);
  assert.equal(revoked.status, 401);
});
