import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import { createApi } from '../http.mjs';
import { createStore } from '../store.mjs';
import { captureSource } from '../live.mjs';
import { createKaminoBrowserFixture } from './support/kamino-fixtures.mjs';

const url = process.env.FALCON_MESH_TEST_DATABASE_URL;
if (!url) throw new Error('FALCON_MESH_TEST_DATABASE_URL must name an initialized disposable mesh database.');
const at = '2026-09-27T12:00:00.000Z';
const scenario = { proposedUnits: '1000000', maxProposedUnits: '2000000', minBookLiquidityUnits: '200000000', maxObservationAgeSeconds: 300 };
const digest = token => createHash('sha256').update(token).digest('hex');

test('V114/V92: owner-entered reserve decisions keep original evidence, isolate owners and cannot authorize lending', async t => {
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000 });
  const fixture = createKaminoBrowserFixture(Keypair.generate().publicKey.toBase58(), () => at);
  const store = createStore(pool, { now: () => at, capture: (id, options) => captureSource(id, { ...options, fetchImpl: fixture.publicFetch }) });
  const firstOwner = `scenario_${randomUUID().replaceAll('-', '')}`;
  const otherOwner = `scenario_${randomUUID().replaceAll('-', '')}`;
  const token = 'scenario-local-alpha-token-0000000000000000';
  const otherToken = 'scenario-local-bravo-token-0000000000000000';
  const server = createApi({ store, tokenHashes: new Map([[digest(token), firstOwner], [digest(otherToken), otherOwner]]), now: () => at });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, credential = token, body) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };

  const capture = await store.captureSource(firstOwner, { requestId: randomUUID(), connectorId: 'solana-devnet-reserve-liquidity', expectedRevisionId: null });
  const input = { requestId: randomUUID(), scenario };
  const created = await call('/v1/decisions/reserve', token, input);
  assert.equal(created.status, 200);
  const record = created.data.record;
  assert.equal(record.analysis.status, 'REVIEW');
  assert.equal(record.analysis.policyVersion, 'mesh-reserve-scenario/1');
  assert.equal(record.analysis.executionReady, false);
  assert.deepEqual(record.analysis.sourceRevisionIds, [capture.revisionId]);
  assert.equal(record.analysis.availableLiquidityUnits, '252145908');
  assert.equal(record.analysis.scenario.provenance, 'OWNER_ENTERED');
  assert.ok(record.analysis.decisionGraph.edges.every(edge => record.analysis.decisionGraph.nodes.some(node => node.id === edge.source) && record.analysis.decisionGraph.nodes.some(node => node.id === edge.target)));

  assert.deepEqual((await call(`/v1/decisions/${record.id}`)).data.record, record);
  assert.equal((await call('/v1/decisions')).data.records[0].id, record.id);
  assert.deepEqual((await call('/v1/analyses')).data.records, [], 'the existing analysis view must not misread a decision');
  assert.equal((await call(`/v1/analyses/${record.id}`)).status, 404, 'lending cannot load a decision as program evidence');
  assert.equal((await call(`/v1/decisions/${record.id}`, otherToken)).status, 404);
  assert.deepEqual((await call('/v1/decisions', otherToken)).data.records, []);

  const newer = await store.captureSource(firstOwner, { requestId: randomUUID(), connectorId: 'solana-devnet-reserve-liquidity', expectedRevisionId: capture.revisionId });
  assert.notEqual(newer.revisionId, capture.revisionId);
  assert.deepEqual((await call('/v1/decisions/reserve', token, input)).data.record, record, 'an identical retry keeps the old graph and result');
  const changed = await call('/v1/decisions/reserve', token, { requestId: input.requestId, scenario: { ...scenario, proposedUnits: '1500000' } });
  assert.equal(changed.status, 409);
  assert.equal(changed.data.error.code, 'CONFLICT');
  assert.equal((await call('/v1/decisions/reserve', token, { requestId: randomUUID(), scenario: { ...scenario, unknown: true } })).status, 400);
  assert.equal((await call('/v1/analyses/live', token, { requestId: randomUUID(), observationId: 'decision:mesh-reserve-scenario/1', maxHops: 3 })).status, 400);

  const missing = await call('/v1/decisions/reserve', otherToken, { requestId: randomUUID(), scenario });
  assert.equal(missing.status, 200);
  assert.equal(missing.data.record.analysis.status, 'NO_DATA');
  assert.equal(missing.data.record.analysis.availableLiquidityUnits, null);
  assert.ok(missing.data.record.analysis.decisionGraph.nodes.every(node => node.origin !== 'OBSERVED'));
});
