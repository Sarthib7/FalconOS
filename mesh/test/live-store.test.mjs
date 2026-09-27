import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createStore } from '../store.mjs';
import { captureSource } from '../live.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const url = process.env.FALCON_MESH_TEST_DATABASE_URL;
const at = '2026-09-27T12:00:00.000Z';
const program = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const code = expected => error => error?.code === expected;

test('V99/V100: live captures retain provenance, partition graphs and survive retries in Postgres', { skip: !url }, async t => {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  t.after(() => pool.end());
  const owner = `live_${randomUUID().replaceAll('-', '')}`;
  let fetches = 0;
  let failed = false;
  const capture = (id, options) => captureSource(id, { ...options, fetchImpl: async (url, init) => {
    fetches += 1;
    if (failed) throw new Error('private transport detail');
    if (init.method === 'GET') return new Response(`## Deployments\n* Devnet: \`${program}\`\n`);
    const request = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id: request.id, result: request.method === 'getGenesisHash' ? genesis : {
      context: { slot: 123 }, value: { owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: true, data: [Buffer.alloc(36).toString('base64'), 'base64'], space: 36 },
    } });
  } });
  const store = createStore(pool, { capture, now: () => at });
  const inputs = ['kamino-program-docs', 'solana-devnet-klend'].map(connectorId => ({ connectorId, requestId: randomUUID(), expectedRevisionId: null }));
  const sources = [];
  for (const input of inputs) sources.push(await store.captureSource(owner, input));
  const initialFetches = fetches;
  assert.deepEqual(await store.captureSource(owner, inputs[0]), sources[0]);
  assert.equal(fetches, initialFetches);
  await assert.rejects(store.captureSource(owner, { ...inputs[0], connectorId: inputs[1].connectorId }), code('CONFLICT'));
  await assert.rejects(store.captureSource(owner, { ...inputs[0], requestId: randomUUID(), connectorId: 'https://localhost/private' }), code('INVALID_INPUT'));
  const retained = await store.getSource(owner, sources[0].revisionId);
  const v2 = JSON.parse(retained.content);
  assert.equal(v2.capture.status, 'ok');
  assert.ok(v2.capture.exchanges[0].response.sha256);
  await assert.rejects(store.ingestSources(owner, [{ revisionId: randomUUID(), expectedRevisionId: sources[0].revisionId, content: retained.content }], at), code('INVALID_INPUT'));
  const forged = { ...makeDemoDocuments(at)[0], sourceKey: v2.sourceKey };
  await assert.rejects(store.ingestSources(owner, [{ revisionId: randomUUID(), expectedRevisionId: sources[0].revisionId, content: JSON.stringify(forged) }], at), code('INVALID_INPUT'));
  const synthetic = makeDemoDocuments(at).map(document => ({ revisionId: randomUUID(), expectedRevisionId: null, content: JSON.stringify(document) }));
  await store.ingestSources(owner, synthetic, at);
  assert.equal((await store.getGraph(owner, at)).mode, 'synthetic');
  assert.equal((await store.getGraph(owner, at)).sources.length, 2);
  const graph = await store.getGraph(owner, at, 'live');
  assert.equal(graph.sources.length, 2);
  assert.ok(graph.nodes.every(node => !node.id.startsWith('position:')));
  const query = { requestId: randomUUID(), observationId: 'observation:live:solana-devnet-klend', maxHops: 3 };
  const record = await store.createAnalysis(owner, query, at, 'live');
  assert.equal(record.analysis.status, 'OBSERVED');
  assert.equal(record.analysis.totalAffectedUnits, null);
  await assert.rejects(store.createAnalysis(owner, query, at, 'synthetic'), code('CONFLICT'));
  const syntheticRecord = await store.createAnalysis(owner, { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 }, at);
  const before = JSON.stringify(syntheticRecord);
  failed = true;
  const failureInput = { ...inputs[1], requestId: randomUUID(), expectedRevisionId: sources[1].revisionId };
  const failure = await store.captureSource(owner, failureInput);
  assert.equal(JSON.parse((await store.getSource(owner, failure.revisionId)).content).capture.status, 'unavailable');
  const failedRecord = await store.createAnalysis(owner, { ...query, requestId: randomUUID() }, at, 'live');
  assert.equal(failedRecord.analysis.status, 'NO_DATA');
  assert.deepEqual(await store.createAnalysis(owner, query, at, 'live'), record);
  assert.equal(JSON.stringify(await store.getAnalysis(owner, syntheticRecord.id)), before);
  const beforeRetry = fetches;
  assert.deepEqual(await store.captureSource(owner, inputs[1]), sources[1]);
  assert.equal(fetches, beforeRetry);
  assert.ok((await store.getGraph(owner, at, 'live')).sources.some(source => source.revisionId === failure.revisionId));
  const stranger = `other_${randomUUID().replaceAll('-', '')}`;
  assert.equal(await store.getSource(stranger, failure.revisionId), null);
  assert.equal((await store.getGraph(stranger, at, 'live')).nodes.length, 0);
  const [left, right] = await Promise.all([
    store.captureSource(owner, { ...failureInput, requestId: randomUUID(), expectedRevisionId: failure.revisionId }),
    store.captureSource(owner, { ...failureInput, requestId: randomUUID(), expectedRevisionId: failure.revisionId }),
  ].map(promise => promise.then(value => ({ value }), error => ({ error }))));
  assert.equal([left, right].filter(result => result.value).length, 1);
  assert.equal([left, right].find(result => result.error).error.code, 'CONFLICT');
});
