import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApi, parseOrigins, parseTokenHashes } from '../http.mjs';
import { createStore } from '../store.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const at = '2026-09-27T12:00:00.000Z';
const token = 'test-only-falcon-mesh-alpha-token-00000000';
const otherToken = 'test-only-falcon-mesh-bravo-token-00000000';
const digest = value => createHash('sha256').update(value).digest('hex');
const url = process.env.FALCON_MESH_TEST_DATABASE_URL;
const prefix = randomUUID().replaceAll('-', '');
const hashes = parseTokenHashes(JSON.stringify({ [digest(token)]: `http_${prefix}`, [digest(otherToken)]: `other_${prefix}` }));

test('V92: empty or malformed token configuration fails closed', () => {
  for (const value of [undefined, '{}', '[]', 'null', '{"raw-token":"owner"}', JSON.stringify({ [digest(token)]: '../owner' })]) {
    assert.throws(() => parseTokenHashes(value));
  }
  assert.equal(hashes.size, 2);
});

test('V95: configured CORS origins are exact and HTTPS except loopback', () => {
  assert.deepEqual([...parseOrigins('https://falcon.example,http://127.0.0.1:4182')], ['https://falcon.example', 'http://127.0.0.1:4182']);
  for (const value of ['https://falcon.example/path', 'http://falcon.example', '*', 'https://user:pass@falcon.example', 'null']) {
    assert.throws(() => parseOrigins(value));
  }
});

test('I15/V91-V96: authenticated HTTP source -> graph -> saved analysis uses real Postgres', { skip: !url && 'Set FALCON_MESH_TEST_DATABASE_URL to the disposable database.' }, async t => {
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 3000 });
  const store = createStore(pool);
  await store.ready();
  const server = createApi({ store, tokenHashes: hashes, allowedOrigins: new Set(['http://127.0.0.1:4182']), now: () => at });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { credential = token, input, origin, raw } = {}) {
    const response = await fetch(base + path, {
      method: input === undefined && raw === undefined ? 'GET' : 'POST',
      headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(input !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
      ...(input !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(input) } : {}),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  await t.test('V92: every data route requires a valid credential', async () => {
    for (const path of ['/v1/graph', '/v1/analyses', `/v1/sources/${randomUUID()}`]) {
      assert.equal((await request(path, { credential: null })).status, 401);
    }
    assert.equal((await request('/v1/graph', { credential: 'wrong-token-with-at-least-32-characters' })).status, 401);
    assert.equal((await request('/healthz', { credential: null })).data.status, 'alive');
    assert.equal((await request('/readyz', { credential: null })).data.status, 'ready');
  });
  await t.test('V95: foreign origins, malformed JSON, caller owner and oversized bodies fail', async () => {
    assert.equal((await request('/v1/graph', { origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request('/v1/sources', { raw: '{' })).status, 400);
    assert.equal((await request('/v1/sources', { input: { revisions: [], owner: 'victim' } })).status, 400);
    assert.equal((await request('/v1/sources', { raw: JSON.stringify({ large: 'x'.repeat(1024 * 1024) }) })).status, 413);
    assert.equal((await request('/v1/graph?owner=victim')).status, 400);
    const preflight = await fetch(base + '/v1/sources', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4182', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:4182');
  });
  let original;
  let revisions;
  await t.test('V91/V93: sources commit before graph and analysis become readable', async () => {
    revisions = makeDemoDocuments(at, 'liquid').map(document => ({ revisionId: randomUUID(), expectedRevisionId: null, content: JSON.stringify(document) }));
    const write = await request('/v1/sources', { input: { revisions } });
    assert.equal(write.status, 200, JSON.stringify(write.data));
    assert.equal(write.data.sources.length, 2);
    const graph = await request('/v1/graph', { origin: 'http://127.0.0.1:4182' });
    assert.equal(graph.status, 200);
    assert.ok(graph.data.graph.nodes.some(node => node.id === 'position:unrelated'));
    const result = await request('/v1/analyses', { input: { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    original = result.data.record;
    assert.equal(original.analysis.status, 'READY');
    assert.deepEqual(original.analysis.positionResults.map(row => row.positionId).sort(), ['position:one', 'position:two']);
    assert.ok(original.analysis.positionResults.every(row => row.pathNodeIds.includes('reserve:shared') && row.pathEdgeIds.length >= 2));
  });
  await t.test('V92: another owner cannot see graph, sources or saved records', async () => {
    const graph = await request('/v1/graph', { credential: otherToken });
    assert.equal(graph.data.graph.nodes.length, 0);
    assert.equal((await request(`/v1/sources/${revisions[0].revisionId}`, { credential: otherToken })).status, 404);
    assert.equal((await request(`/v1/analyses/${original.id}`, { credential: otherToken })).status, 404);
    assert.equal((await request('/v1/analyses', { credential: otherToken })).data.records.length, 0);
  });
  await t.test('V93/V94: new liquidity changes connected analysis and preserves original history', async () => {
    const documents = makeDemoDocuments(at, 'illiquid');
    const liquidity = documents.find(document => document.sourceKey === 'demo/liquidity');
    const index = revisions.findIndex(item => JSON.parse(item.content).sourceKey === 'demo/liquidity');
    const write = await request('/v1/sources', { input: { revisions: [{ revisionId: randomUUID(), expectedRevisionId: revisions[index].revisionId, content: JSON.stringify(liquidity) }] } });
    assert.equal(write.status, 200, JSON.stringify(write.data));
    const result = await request('/v1/analyses', { input: { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 } });
    assert.equal(result.data.record.analysis.status, 'BLOCKED');
    assert.notEqual(result.data.record.graph.revision, original.graph.revision);
    assert.deepEqual((await request(`/v1/analyses/${original.id}`)).data.record, original);
    const retained = (await request(`/v1/sources/${revisions[index].revisionId}`)).data.source;
    assert.equal(retained.content, revisions[index].content);
    assert.equal(retained.sha256, digest(retained.content));
  });
});
