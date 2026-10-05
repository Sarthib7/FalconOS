import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Agent, request as httpRequest } from 'node:http';
import { Pool } from 'pg';
import { createApi, parseOrigins, parseTokenHashes } from '../http.mjs';
import { createStore } from '../store.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';
import { MeshError } from '../domain.mjs';

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

for (const input of [
  { name: 'known-length overflow', length: 1024 * 1024 + 65536, first: 65536, status: 413, code: 'TOO_LARGE' },
  { name: 'chunked overflow', length: 1024 * 1024 + 65536, first: 1024 * 1024 + 1, chunked: true, status: 413, code: 'TOO_LARGE' },
  { name: 'known-length unsupported content type', length: 65536, first: 1, contentType: 'text/plain', status: 400, code: 'INVALID_INPUT' },
  { name: 'chunked unauthorized request', length: 65536, first: 1, chunked: true, unauthorized: true, status: 401, code: 'UNAUTHORIZED' },
]) {
  test(`V112: ${input.name} returns a complete error and drains the remaining upload`, { timeout: 5000 }, async t => {
    let writes = 0;
    const store = { ingestSources: async () => { writes += 1; return []; } };
    const server = createApi({ store, tokenHashes: hashes });
    const agent = new Agent({ keepAlive: true });
    t.after(async () => { agent.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    assert.equal(server.requestTimeout, 15000);
    let incoming;
    let markDrained;
    const drained = new Promise(resolve => { markDrained = resolve; });
    server.once('request', request => {
      incoming = request;
      request.once('end', () => markDrained(true));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    let upload;
    const reply = new Promise((resolve, reject) => {
      upload = httpRequest({
        hostname: '127.0.0.1', port: server.address().port, path: '/v1/sources', method: 'POST', agent,
        headers: {
          'Content-Type': input.contentType || 'application/json',
          ...(input.unauthorized ? {} : { Authorization: `Bearer ${token}` }),
          ...(input.chunked ? {} : { 'Content-Length': input.length }),
        },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () => resolve({ status: response.statusCode, complete: response.complete, body: Buffer.concat(chunks).toString() }));
      });
      upload.once('error', reject);
      // Keep part of the body unsent until the error has arrived.
      upload.write(Buffer.alloc(input.first, 'x'));
    });
    const result = await reply;
    assert.equal(result.status, input.status);
    assert.equal(result.complete, true);
    assert.equal(JSON.parse(result.body).error.code, input.code);
    assert.equal(incoming.complete, false, 'the response must arrive before the upload finishes');
    upload.end(Buffer.alloc(input.length - input.first, 'x'));
    let timer;
    try {
      const completed = await Promise.race([drained, new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
      assert.equal(completed, true, 'the server must drain the upload after sending the error');
    } finally { clearTimeout(timer); }
    assert.equal(incoming.complete, true);
    assert.equal(writes, 0, 'rejected input must never reach storage');
  });
}

const EVIDENCE_EXCHANGES = 2;

test('B1: lending prepare failure surfaces bounded, sanitized RPC evidence; other errors omit it', async t => {
  const exchange = i => ({
    url: 'https://api.devnet.solana.com', startedAt: at, completedAt: at,
    request: { method: 'POST', rpcMethod: `method-${i}`, bodyBase64: 'e30=' },
    response: { httpStatus: 200, contentType: 'application/json', bodyBase64: 'e30=', byteLength: 2, sha256: 'ab' },
  });
  const exchanges = [exchange(1), exchange(2), exchange(3), exchange(4)];
  const lending = {
    async prepare(owner, input) {
      if (input.action === 'evidence') {
        const error = new MeshError('INVALID_INPUT', 'Lending input or account data is invalid.');
        error.evidence = { exchanges };
        throw error;
      }
      if (input.action === 'conflict') throw new MeshError('CONFLICT', 'A saved live OBSERVED analysis is required.');
      throw new Error('secret internal detail with SQL SELECT * FROM ...');
    },
  };
  const server = createApi({ store: {}, lending, tokenHashes: hashes });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const prepare = async action => {
    const response = await fetch(`${base}/v1/lending/intents`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), analysisId: randomUUID(), wallet: 'w', action, inputBaseUnits: '1' }),
    });
    return { status: response.status, data: await response.json() };
  };

  const surfaced = await prepare('evidence');
  assert.equal(surfaced.status, 400);
  assert.equal(surfaced.data.error.code, 'INVALID_INPUT');
  assert.ok(Array.isArray(surfaced.data.error.evidence.exchanges), 'evidence exchanges must be surfaced');
  assert.ok(surfaced.data.error.evidence.exchanges.length <= EVIDENCE_EXCHANGES, 'surfaced evidence must be bounded');
  assert.deepEqual(surfaced.data.error.evidence.exchanges, exchanges.slice(-EVIDENCE_EXCHANGES), 'only the last, unmodified exchange records pass through');
  assert.deepEqual(Object.keys(surfaced.data.error).sort(), ['code', 'evidence', 'message'], 'no extra error fields leak');

  const conflict = await prepare('conflict');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, 'CONFLICT');
  assert.ok(!('evidence' in conflict.data.error), 'a known error without captured evidence stays evidence-free');

  const fallback = await prepare('other');
  assert.equal(fallback.status, 503);
  assert.equal(fallback.data.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(fallback.data.error.message, 'Mesh storage could not complete the request.');
  assert.ok(!('evidence' in fallback.data.error), 'the unknown-error fallback must not surface evidence');
});

test('C2: lending POST forwards an optional decisionId unchanged and still rejects any other extra or missing field', async t => {
  const seen = [];
  const lending = { async prepare(_owner, input) { seen.push(input); return { id: 'x' }; } };
  const server = createApi({ store: {}, lending, tokenHashes: hashes });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const post = async body => (await fetch(`http://127.0.0.1:${server.address().port}/v1/lending/intents`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).status;
  const base = { requestId: randomUUID(), analysisId: randomUUID(), wallet: 'w', action: 'supply', inputBaseUnits: '1' };
  const decisionId = randomUUID();
  assert.equal(await post({ ...base, decisionId }), 200);
  assert.deepEqual(seen, [{ ...base, decisionId }]);
  assert.equal(await post(base), 200, 'the route leaves per-action decisionId rules to the lending store');
  assert.equal(await post({ ...base, decisionId, extra: 1 }), 400);
  assert.equal(await post({ ...base, extra: 1 }), 400);
  const { wallet, ...missing } = base;
  assert.equal(await post({ ...missing, decisionId }), 400);
  assert.equal(seen.length, 2);
});
test('R1: the per-owner rate limit trips independently of other owners and clears on window reset', async t => {
  let currentTime = 1_000_000;
  const clock = () => currentTime;
  const store = { ready: async () => {} };
  const server = createApi({ store, tokenHashes: hashes, rateWindowMs: 1000, rateMaxPerOwner: 2, rateMaxGlobal: 3, clock });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, credential) => {
    const response = await fetch(base + path, { headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}) } });
    return { status: response.status, retryAfter: response.headers.get('retry-after'), data: await response.json() };
  };

  assert.equal((await get('/v1/connectors', token)).status, 200);
  assert.equal((await get('/v1/connectors', token)).status, 200);
  const blocked = await get('/v1/connectors', token);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error.code, 'RATE_LIMITED');
  assert.equal(blocked.retryAfter, '1');

  const other = await get('/v1/connectors', otherToken);
  assert.equal(other.status, 200, 'a different owner is unaffected by the first owner exhausting its per-owner cap');

  assert.equal((await get('/healthz')).status, 200, 'health checks stay exempt while an owner is capped');
  assert.equal((await get('/readyz')).status, 200, 'readiness checks stay exempt while an owner is capped');

  currentTime += 1000;
  const afterReset = await get('/v1/connectors', token);
  assert.equal(afterReset.status, 200, 'a window rollover clears the per-owner cap');
});

test('R2: the global rate limit trips across owners even when no owner reaches its own cap', async t => {
  let currentTime = 2_000_000;
  const clock = () => currentTime;
  const store = { ready: async () => {} };
  const server = createApi({ store, tokenHashes: hashes, rateWindowMs: 1000, rateMaxPerOwner: 100, rateMaxGlobal: 3, clock });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, credential) => {
    const response = await fetch(base + path, { headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}) } });
    return { status: response.status, data: await response.json() };
  };

  assert.equal((await get('/v1/connectors', token)).status, 200);
  assert.equal((await get('/v1/connectors', otherToken)).status, 200);
  assert.equal((await get('/v1/connectors', token)).status, 200);
  const blocked = await get('/v1/connectors', otherToken);
  assert.equal(blocked.status, 429, 'the shared global cap trips even though this owner is far under its own per-owner cap');
  assert.equal(blocked.data.error.code, 'RATE_LIMITED');

  assert.equal((await get('/healthz')).status, 200, 'health checks stay exempt while the global cap is exhausted');
  assert.equal((await get('/readyz')).status, 200, 'readiness checks stay exempt while the global cap is exhausted');
});

test('R1: the per-owner rate limit trips independently of other owners and clears on window reset', async t => {
  let currentTime = 1_000_000;
  const clock = () => currentTime;
  const store = { ready: async () => {} };
  const server = createApi({ store, tokenHashes: hashes, rateWindowMs: 1000, rateMaxPerOwner: 2, rateMaxGlobal: 3, clock });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, credential) => {
    const response = await fetch(base + path, { headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}) } });
    return { status: response.status, retryAfter: response.headers.get('retry-after'), data: await response.json() };
  };

  assert.equal((await get('/v1/connectors', token)).status, 200);
  assert.equal((await get('/v1/connectors', token)).status, 200);
  const blocked = await get('/v1/connectors', token);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error.code, 'RATE_LIMITED');
  assert.equal(blocked.retryAfter, '1');

  const other = await get('/v1/connectors', otherToken);
  assert.equal(other.status, 200, 'a different owner is unaffected by the first owner exhausting its per-owner cap');

  assert.equal((await get('/healthz')).status, 200, 'health checks stay exempt while an owner is capped');
  assert.equal((await get('/readyz')).status, 200, 'readiness checks stay exempt while an owner is capped');

  currentTime += 1000;
  const afterReset = await get('/v1/connectors', token);
  assert.equal(afterReset.status, 200, 'a window rollover clears the per-owner cap');
});

test('R2: the global rate limit trips across owners even when no owner reaches its own cap', async t => {
  let currentTime = 2_000_000;
  const clock = () => currentTime;
  const store = { ready: async () => {} };
  const server = createApi({ store, tokenHashes: hashes, rateWindowMs: 1000, rateMaxPerOwner: 100, rateMaxGlobal: 3, clock });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, credential) => {
    const response = await fetch(base + path, { headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}) } });
    return { status: response.status, data: await response.json() };
  };

  assert.equal((await get('/v1/connectors', token)).status, 200);
  assert.equal((await get('/v1/connectors', otherToken)).status, 200);
  assert.equal((await get('/v1/connectors', token)).status, 200);
  const blocked = await get('/v1/connectors', otherToken);
  assert.equal(blocked.status, 429, 'the shared global cap trips even though this owner is far under its own per-owner cap');
  assert.equal(blocked.data.error.code, 'RATE_LIMITED');

  assert.equal((await get('/healthz')).status, 200, 'health checks stay exempt while the global cap is exhausted');
  assert.equal((await get('/readyz')).status, 200, 'readiness checks stay exempt while the global cap is exhausted');
});

test('V95: readiness failure does not expose storage details in response or logs', async t => {
  const store = { ready: async () => { const error = new Error('postgresql://secret@host/private'); error.code = '28P01'; throw error; } };
  const server = createApi({ store, tokenHashes: hashes });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const originalWrite = process.stderr.write;
  let diagnostic = '';
  process.stderr.write = chunk => { diagnostic += chunk; return true; };
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'STORAGE_UNAVAILABLE', message: 'Mesh storage is not ready.' } });
    assert.ok(!diagnostic.includes('postgresql://secret@host/private'), 'storage error details must not enter process logs');
  } finally { process.stderr.write = originalWrite; }
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
