import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createStore } from '../store.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const connectionString = process.env.FALCON_MESH_TEST_DATABASE_URL;
if (!connectionString) throw new Error('FALCON_MESH_TEST_DATABASE_URL must name an initialized disposable Postgres database. DATABASE_URL is never used by these tests.');
const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const store = createStore(pool);
const AT = '2026-09-27T12:00:00.000Z';
const later = (seconds = 1) => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const owner = () => `test_${randomUUID().replaceAll('-', '')}`;
const code = expected => error => error?.code === expected;
const revision = (document, expectedRevisionId = null, revisionId = randomUUID()) => ({ revisionId, expectedRevisionId, content: JSON.stringify(document) });
const demo = (at = AT, scenario = 'liquid') => makeDemoDocuments(at, scenario).map(document => revision(document));
const query = (requestId = randomUUID()) => ({ requestId, observationId: 'observation:shared', maxHops: 3 });
const emptySource = key => ({ schemaVersion: 1, mode: 'synthetic', sourceKey: key, sourceUrl: `synthetic://tests/${key}`, observedAt: AT, nodes: [], edges: [] });

before(async () => { await store.ready(); });
after(async () => { await pool.end(); });

test('V91: retains exact UTF-8 source text, hash, metadata, and source across a fresh connection', async () => {
  const scope = owner();
  const document = makeDemoDocuments(AT)[0];
  document.nodes[0].label = 'Position café';
  const input = { revisionId: randomUUID(), expectedRevisionId: null, content: `\n${JSON.stringify(document, null, 2)}\n` };
  const [metadata] = await store.ingestSources(scope, [input], AT);
  assert.equal(metadata.sha256, createHash('sha256').update(input.content, 'utf8').digest('hex'));
  assert.equal(metadata.capturedAt, AT);
  assert.equal(Object.hasOwn(metadata, 'content'), false);
  const freshPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const loaded = await createStore(freshPool).getSource(scope, input.revisionId);
    assert.deepEqual(loaded, { ...metadata, content: input.content });
  } finally { await freshPool.end(); }
});

test('V91: stale revision retry returns original metadata without restoring its head', async () => {
  const scope = owner();
  const first = demo();
  const saved = await store.ingestSources(scope, first, AT);
  const nextDocument = makeDemoDocuments(later(), 'illiquid')[1];
  const next = revision(nextDocument, first[1].revisionId);
  await store.ingestSources(scope, [next], later());
  const retried = await store.ingestSources(scope, [first[1]], later(2));
  assert.deepEqual(retried, [saved[1]]);
  const graph = await store.getGraph(scope, later(2));
  assert.equal(graph.sources.find(item => item.sourceKey === nextDocument.sourceKey).revisionId, next.revisionId);
  assert.equal(graph.nodes.find(item => item.id === 'observation:shared').properties.availableLiquidityUnits, '400000000');
  await assert.rejects(store.ingestSources(scope, [{ ...first[1], content: `${first[1].content}\n` }], later(2)), code('CONFLICT'));
});

test('V91: later batch conflict rolls back earlier revision and head changes', async () => {
  const scope = owner();
  const initial = demo();
  await store.ingestSources(scope, initial, AT);
  const before = await store.getGraph(scope, AT);
  const changed = makeDemoDocuments(later(), 'illiquid');
  const batch = [revision(changed[0], initial[0].revisionId), revision(changed[1], randomUUID())];
  await assert.rejects(store.ingestSources(scope, batch, later()), code('CONFLICT'));
  assert.equal(await store.getSource(scope, batch[0].revisionId), null);
  assert.equal(await store.getSource(scope, batch[1].revisionId), null);
  assert.deepEqual(await store.getGraph(scope, AT), before);
});

test('V91: concurrent head updates admit one winner and retain no rejected revision', async () => {
  const scope = owner();
  const [initial] = demo();
  await store.ingestSources(scope, [initial], AT);
  const changed = JSON.parse(initial.content);
  const left = revision({ ...changed, sourceUrl: 'synthetic://tests/left' }, initial.revisionId);
  const right = revision({ ...changed, sourceUrl: 'synthetic://tests/right' }, initial.revisionId);
  const outcomes = await Promise.allSettled([store.ingestSources(scope, [left], later()), store.ingestSources(scope, [right], later())]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const loser = outcomes.findIndex(outcome => outcome.status === 'rejected');
  assert.equal(outcomes[loser].reason.code, 'CONFLICT');
  assert.equal(await store.getSource(scope, [left, right][loser].revisionId), null);
  const graph = await store.getGraph(scope, later());
  assert.equal(graph.sources[0].revisionId, [right, left][loser].revisionId);
});

test('V91: concurrent identical source retries share one immutable revision', async () => {
  const scope = owner();
  const input = demo();
  const [left, right] = await Promise.all([store.ingestSources(scope, input, AT), store.ingestSources(scope, input, later())]);
  assert.deepEqual(left, right);
  assert.equal((await store.getGraph(scope, later())).sources.length, 2);
});

test('V92: composite owner keys isolate identical revision IDs and every saved read', async () => {
  const firstOwner = owner();
  const secondOwner = owner();
  const first = demo();
  const second = first.map(item => ({ ...item }));
  const secondDocument = JSON.parse(second[1].content);
  secondDocument.nodes[0].properties.availableLiquidityUnits = '1';
  second[1].content = JSON.stringify(secondDocument);
  await store.ingestSources(firstOwner, first, AT);
  await store.ingestSources(secondOwner, second, AT);
  assert.equal((await store.getSource(firstOwner, first[1].revisionId)).content, first[1].content);
  assert.equal((await store.getSource(secondOwner, second[1].revisionId)).content, second[1].content);
  assert.equal((await store.getGraph(firstOwner, AT)).nodes.find(node => node.id === 'observation:shared').properties.availableLiquidityUnits, '600000000');
  assert.equal((await store.getGraph(secondOwner, AT)).nodes.find(node => node.id === 'observation:shared').properties.availableLiquidityUnits, '1');
  const request = query();
  const firstRecord = await store.createAnalysis(firstOwner, request, AT);
  const secondRecord = await store.createAnalysis(secondOwner, request, AT);
  assert.equal(firstRecord.analysis.status, 'READY');
  assert.equal(secondRecord.analysis.status, 'BLOCKED');
  assert.notEqual(firstRecord.id, secondRecord.id);
  assert.equal(await store.getAnalysis(secondOwner, firstRecord.id), null);
  assert.equal(await store.getAnalysis(firstOwner, secondRecord.id), null);
  assert.deepEqual((await store.listAnalyses(firstOwner)).map(item => item.id), [firstRecord.id]);
  const privateSource = revision(emptySource('private/source'));
  await store.ingestSources(secondOwner, [privateSource], AT);
  assert.equal(await store.getSource(firstOwner, privateSource.revisionId), null);
  assert.equal((await store.getGraph(owner(), AT)).sources.length, 0);
});

test('V94: analysis retries and history keep the original graph after source changes and process reconnection', async () => {
  const scope = owner();
  const inputs = demo();
  await store.ingestSources(scope, inputs, AT);
  const request = query();
  const saved = await store.createAnalysis(scope, request, AT);
  const serialized = JSON.stringify(saved);
  const next = revision(makeDemoDocuments(later(), 'illiquid')[1], inputs[1].revisionId);
  await store.ingestSources(scope, [next], later());
  assert.deepEqual(await store.createAnalysis(scope, request, later(1000)), saved);
  assert.equal((await store.createAnalysis(scope, query(), later())).analysis.status, 'BLOCKED');
  const freshPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try { assert.deepEqual(await createStore(freshPool).getAnalysis(scope, saved.id), saved); }
  finally { await freshPool.end(); }
  assert.equal(JSON.stringify(saved), serialized);
  assert.equal(saved.analysis.status, 'READY');
  assert.equal(saved.analysis.totalAffectedUnits, '500000000');
  assert.ok(saved.graph.sources.some(item => item.revisionId === inputs[1].revisionId));
  assert.equal(saved.graph.sources.some(item => item.revisionId === next.revisionId), false);
  await assert.rejects(store.createAnalysis(scope, { ...request, maxHops: 2 }, later()), code('CONFLICT'));
  await assert.rejects(store.createAnalysis(scope, { ...request, observationId: 'other:observation' }, later()), code('CONFLICT'));
});

test('V94: concurrent identical analysis requests return the same committed record', async () => {
  const scope = owner();
  await store.ingestSources(scope, demo(), AT);
  const request = query();
  const results = await Promise.all(Array.from({ length: 4 }, () => store.createAnalysis(scope, request, AT)));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal((await store.listAnalyses(scope)).length, 1);
});

test('V94: concurrent changed analysis arguments cannot reuse a request ID', async () => {
  const scope = owner();
  await store.ingestSources(scope, demo(), AT);
  const request = query();
  const results = await Promise.allSettled([store.createAnalysis(scope, request, AT), store.createAnalysis(scope, { ...request, maxHops: 2 }, AT)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CONFLICT');
  assert.equal((await store.listAnalyses(scope)).length, 1);
});

test('V94: analysis saves one source snapshot while a source batch waits to commit', { timeout: 20000 }, async () => {
  const scope = owner();
  const inputs = demo();
  await store.ingestSources(scope, inputs, AT);
  let signalRead;
  let resumeRead;
  const read = new Promise(resolve => { signalRead = resolve; });
  const resume = new Promise(resolve => { resumeRead = resolve; });
  const pausedStore = createStore({
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, params) {
          const result = await client.query(sql, params);
          if (sql.includes('SELECT r.*')) { signalRead(); await resume; }
          return result;
        },
        release: error => client.release(error),
      };
    },
  });
  const analysis = pausedStore.createAnalysis(scope, query(), AT);
  await read;
  const updated = makeDemoDocuments(later(), 'illiquid').map((document, index) => revision(document, inputs[index].revisionId));
  const write = store.ingestSources(scope, updated, later());
  resumeRead();
  const [saved] = await Promise.all([analysis, write]);
  assert.deepEqual(saved.graph.sources.map(item => item.revisionId).sort(), inputs.map(item => item.revisionId).sort());
  assert.equal(saved.analysis.status, 'READY');
  assert.deepEqual((await store.getGraph(scope, later())).sources.map(item => item.revisionId).sort(), updated.map(item => item.revisionId).sort());
});

test('V91, V95: source cap rejects overflow and rolls back a preceding update', async () => {
  const scope = owner();
  const inputs = Array.from({ length: 32 }, (_, index) => revision(emptySource(`source/${index}`)));
  for (let index = 0; index < inputs.length; index += 4) await store.ingestSources(scope, inputs.slice(index, index + 4), AT);
  const replacement = revision({ ...emptySource('source/0'), sourceUrl: 'synthetic://tests/replacement' }, inputs[0].revisionId);
  const overflow = revision(emptySource('source/overflow'));
  await assert.rejects(store.ingestSources(scope, [replacement, overflow], later()), code('TOO_LARGE'));
  assert.equal(await store.getSource(scope, replacement.revisionId), null);
  assert.equal(await store.getSource(scope, overflow.revisionId), null);
  const graph = await store.getGraph(scope, later());
  assert.equal(graph.sources.length, 32);
  assert.equal(graph.sources.find(item => item.sourceKey === 'source/0').revisionId, inputs[0].revisionId);
  await store.ingestSources(scope, [replacement], later());
  assert.equal((await store.getGraph(scope, later())).sources.length, 32);
});

test('V92, V94: history returns only the newest 20 records for its owner', async () => {
  const scope = owner();
  const saved = [];
  for (let index = 0; index < 23; index += 1) saved.push(await store.createAnalysis(scope, query(), later(index)));
  const history = await store.listAnalyses(scope);
  assert.deepEqual(history.map(item => item.id), saved.slice(-20).reverse().map(item => item.id));
  assert.deepEqual(Object.keys(history[0]).sort(), ['analysis', 'createdAt', 'id']);
  assert.equal((await store.getAnalysis(scope, saved[0].id)).id, saved[0].id);
});

test('V95: invalid batch and query fields fail before source writes', async () => {
  const scope = owner();
  const input = demo();
  await assert.rejects(store.ingestSources(scope, [], AT), code('INVALID_INPUT'));
  await assert.rejects(store.ingestSources(scope, [input[0], { ...input[1], unexpected: true }], AT), code('INVALID_INPUT'));
  await assert.rejects(store.ingestSources(scope, [input[0], input[0]], AT), code('INVALID_INPUT'));
  await assert.rejects(store.ingestSources(scope, [{ ...input[0], revisionId: 'bad' }], AT), code('INVALID_INPUT'));
  await assert.rejects(store.ingestSources(scope, [input[0]], '2026-09-27'), code('INVALID_INPUT'));
  await assert.rejects(store.createAnalysis(scope, { ...query(), owner: 'another_owner' }, AT), code('INVALID_INPUT'));
  await assert.rejects(store.createAnalysis(scope, { ...query(), maxHops: 0 }, AT), code('INVALID_INPUT'));
  await assert.rejects(store.createAnalysis(scope, { ...query(), observationId: null }, AT), code('INVALID_INPUT'));
  assert.equal((await store.getGraph(scope, AT)).sources.length, 0);
});

test('V95: database failures expose a stable message without connection or SQL details', async () => {
  const failedStore = createStore({ query: async () => { throw new Error('password=hidden SELECT private_table'); } });
  await assert.rejects(failedStore.getSource(owner(), randomUUID()), error => error.code === 'STORAGE_UNAVAILABLE'
    && error.message === 'Mesh storage could not complete the request.');
});

test('V95: readiness verifies schema version and rejects absent columns without DDL', async () => {
  assert.equal(await store.ready(), true);
  const queries = [];
  const missingColumns = createStore({ query: async sql => {
    queries.push(sql);
    return { rows: sql.includes('pg_namespace') ? [{ version: 'falcon_mesh_schema_version=3' }] : [] };
  } });
  await assert.rejects(missingColumns.ready(), code('STORAGE_UNAVAILABLE'));
  assert.ok(queries.every(sql => !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/.test(sql)));
  assert.equal(queries.length, 2);
  await assert.rejects(createStore({ query: async () => ({ rows: [{ version: 'falcon_mesh_schema_version=1' }] }) }).ready(), code('STORAGE_UNAVAILABLE'));
});

test('V95: schema setup refuses to connect without its explicit operator guard', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../init-db.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, FALCON_MESH_ALLOW_SCHEMA_SETUP: '', DATABASE_URL: 'postgresql://invalid:secret@invalid.invalid/private' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FALCON_MESH_ALLOW_SCHEMA_SETUP=1/);
  assert.doesNotMatch(result.stderr, /secret|invalid\.invalid/);
});
