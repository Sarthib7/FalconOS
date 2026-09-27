import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { CONNECTORS, captureSource, validateLiveSource, projectLiveGraph, analyzeLiveGraph } from '../live.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const AT = '2026-09-27T12:00:00.000Z';
const PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const OWNER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const DOCS = 'kamino-program-docs';
const RPC = 'solana-devnet-klend';
const QUERY = { observationId: `observation:live:${RPC}`, maxHops: 3 };
const DOCUMENT = `# Test capture\n\n## Deployments\n\n* Devnet: \`${PROGRAM}\`\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => AT;
const later = seconds => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const rejects = error => error?.code === 'INVALID_INPUT';

function accountResult() {
  return { context: { slot: 123 }, value: { executable: true, owner: OWNER, data: [Buffer.alloc(36, 1).toString('base64'), 'base64'], space: 36 } };
}
function fixtureFetch({ document = DOCUMENT, genesis = GENESIS, account = accountResult(), calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.ok(init.signal instanceof AbortSignal);
    if (init.method === 'GET') {
      assert.equal(url, CONNECTORS[0].sourceUrl);
      return new Response(document, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    assert.equal(url, 'https://api.devnet.solana.com');
    const request = JSON.parse(init.body);
    if (request.method === 'getGenesisHash') {
      assert.deepEqual(request, { jsonrpc: '2.0', id: 1, method: 'getGenesisHash' });
      return Response.json({ jsonrpc: '2.0', id: 1, result: genesis });
    }
    assert.deepEqual(request, { jsonrpc: '2.0', id: 2, method: 'getAccountInfo', params: [PROGRAM, { encoding: 'base64', commitment: 'confirmed' }] });
    return Response.json({ jsonrpc: '2.0', id: 2, result: account });
  };
}
function revision(content, capturedAt = AT) {
  const document = JSON.parse(content);
  return { revisionId: randomUUID(), sourceKey: document.sourceKey, sourceUrl: document.sourceUrl, observedAt: document.observedAt, capturedAt, sha256: hash(content), content };
}
async function pair(options = {}) {
  const fetchImpl = fixtureFetch(options);
  return [revision(await captureSource(DOCS, { fetchImpl, now })), revision(await captureSource(RPC, { fetchImpl, now }))];
}
function analyze(revisions, query = QUERY, at = AT) { return analyzeLiveGraph(projectLiveGraph(revisions, at), query, at); }

test('V99: registry exposes only fixed public connector metadata and rejects arbitrary fetch targets', async () => {
  assert.deepEqual(CONNECTORS.map(item => Object.keys(item).sort()), Array(2).fill(['id', 'label', 'network', 'sourceUrl']));
  assert.ok(Object.isFrozen(CONNECTORS) && CONNECTORS.every(Object.isFrozen));
  let fetched = false;
  await assert.rejects(captureSource('https://localhost/private', { fetchImpl: async () => { fetched = true; }, now }), rejects);
  assert.equal(fetched, false);
});

test('V99: document capture retains exact raw bytes, hash, transport and receipt time', async () => {
  const raw = `${DOCUMENT}\nPublic text with UTF-8: € 🪙\n`;
  const content = await captureSource(DOCS, { fetchImpl: fixtureFetch({ document: raw }), now });
  const parsed = validateLiveSource(content, AT);
  assert.equal(parsed.mode, 'live');
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.sourceKey, `live:${DOCS}`);
  assert.equal(parsed.observedAt, AT);
  assert.equal(parsed.capture.status, 'ok');
  assert.equal(parsed.capture.chain, null);
  const exchange = parsed.capture.exchanges[0];
  assert.deepEqual(exchange.request, { method: 'GET', bodyBase64: null });
  assert.equal(exchange.startedAt, AT);
  assert.equal(exchange.completedAt, AT);
  assert.equal(exchange.response.byteLength, Buffer.byteLength(raw));
  assert.equal(exchange.response.sha256, hash(Buffer.from(raw)));
  assert.equal(Buffer.from(exchange.response.bodyBase64, 'base64').toString('utf8'), raw);
  assert.equal(exchange.failure, null);
});

test('V99: Devnet capture binds both RPC exchanges to full genesis, account identity and slot', async () => {
  const calls = [];
  const content = await captureSource(RPC, { fetchImpl: fixtureFetch({ calls }), now });
  const parsed = validateLiveSource(content, AT);
  assert.equal(calls.length, 2);
  assert.deepEqual(parsed.capture.chain, { network: 'devnet', genesisHash: GENESIS, commitment: 'confirmed', slot: '123' });
  assert.equal(parsed.capture.exchanges.length, 2);
  assert.equal(parsed.capture.status, 'ok');
  const observation = parsed.nodes.find(node => node.kind === 'observation');
  assert.equal(observation.properties.programOwner, OWNER);
  assert.equal(observation.properties.dataSha256, hash(Buffer.alloc(36, 1)));
  assert.equal(observation.properties.executable, true);
  assert.equal(parsed.nodes.find(node => node.kind === 'account').properties.address, PROGRAM);
});

test('V99: transport accepts URL normalization but rejects a different response target', async () => {
  const fetched = fixtureFetch();
  const content = await captureSource(RPC, { now, fetchImpl: async (...args) => {
    const response = await fetched(...args);
    Object.defineProperty(response, 'url', { value: 'https://api.devnet.solana.com/' });
    return response;
  } });
  assert.equal(validateLiveSource(content, AT).capture.status, 'ok');
  const redirected = await captureSource(DOCS, { now, fetchImpl: async () => {
    const response = new Response(DOCUMENT);
    Object.defineProperty(response, 'url', { value: 'https://attacker.invalid/document' });
    return response;
  } });
  assert.equal(validateLiveSource(redirected, AT).capture.reasonCode, 'TRANSPORT');
});

test('V99: an empty complete HTTP response retains its status and zero-byte body', async () => {
  const content = await captureSource(DOCS, { now, fetchImpl: async () => new Response(null, { status: 204 }) });
  const source = validateLiveSource(content, AT);
  assert.equal(source.capture.status, 'invalid');
  assert.equal(source.capture.exchanges[0].response.httpStatus, 204);
  assert.equal(source.capture.exchanges[0].response.byteLength, 0);
  assert.equal(source.capture.exchanges[0].response.sha256, hash(Buffer.alloc(0)));
});

test('V99: wrong cluster and shortened chain reference cannot trigger an account request', async () => {
  for (const genesis of ['EtWTRABZaYq6iMfeYKouRu166VU2xqa1', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d']) {
    const calls = [];
    const content = await captureSource(RPC, { fetchImpl: fixtureFetch({ genesis, calls }), now });
    const parsed = validateLiveSource(content, AT);
    assert.equal(calls.length, 1);
    assert.equal(parsed.capture.status, 'invalid');
    assert.equal(parsed.capture.reasonCode, 'WRONG_CLUSTER');
    assert.equal(parsed.capture.chain, null);
    assert.equal(analyze([revision(content)]).status, 'NO_DATA');
  }
});

test('V99: source validation rejects forged raw hash, request, identity, version, and projection', async () => {
  const content = await captureSource(RPC, { fetchImpl: fixtureFetch(), now });
  const mutations = [
    source => { source.capture.exchanges[0].response.sha256 = '0'.repeat(64); },
    source => { source.capture.exchanges[0].response.byteLength += 1; },
    source => { source.capture.exchanges[1].request.bodyBase64 = Buffer.from('{}').toString('base64'); },
    source => { source.sourceUrl = 'https://attacker.invalid'; },
    source => { source.capture.projectionVersion = 'unknown'; },
    source => { source.capture.chain.genesisHash = 'fake'; },
    source => { source.nodes.find(node => node.kind === 'account').properties.address = OWNER; },
    source => { source.capture.exchanges[0].response.bodyBase64 += '\n'; },
    source => { source.capture.exchanges[0].completedAt = later(1); },
    source => { source.capture.exchanges[1].request.url = 'https://attacker.invalid'; },
  ];
  for (const mutate of mutations) {
    const source = JSON.parse(content); mutate(source);
    assert.throws(() => validateLiveSource(JSON.stringify(source), AT), rejects);
  }
  const source = JSON.parse(content);
  const raw = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'wrong-cluster' }));
  Object.assign(source.capture.exchanges[0].response, { bodyBase64: raw.toString('base64'), sha256: hash(raw), byteLength: raw.length });
  assert.throws(() => validateLiveSource(JSON.stringify(source), AT), rejects);
});

test('V99: missing, nonexecutable and malformed accounts become retained failed captures', async () => {
  const malformed = [
    { ...accountResult(), context: { slot: -1 } },
    { ...accountResult(), context: { slot: Number.MAX_SAFE_INTEGER + 1 } },
    { ...accountResult(), context: { slot: '123' } },
    { context: { slot: 123 }, value: null },
    ...[
      { executable: false }, { executable: 'true' }, { owner: 'invalid' },
      { data: ['not base64!', 'base64'] }, { data: ['', 'base64'] },
      { data: [Buffer.alloc(36).toString('base64'), 'jsonParsed'] }, { space: 10 },
    ].map(changes => ({ context: { slot: 123 }, value: { ...accountResult().value, ...changes } })),
  ];
  for (const account of malformed) {
    const content = await captureSource(RPC, { fetchImpl: fixtureFetch({ account }), now });
    const parsed = validateLiveSource(content, AT);
    assert.notEqual(parsed.capture.status, 'ok');
    assert.equal(parsed.capture.exchanges.length, 2);
    assert.ok(parsed.capture.exchanges[1].response.bodyBase64);
    assert.equal(analyze([revision(content)]).status, 'NO_DATA');
  }
});

test('V99: interrupted and oversize bodies are never retained as complete evidence', async () => {
  for (const oversized of [true, false]) {
    let pulls = 0;
    const content = await captureSource(DOCS, { now, fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(Buffer.from(DOCUMENT));
        else if (oversized) controller.enqueue(Buffer.alloc(40 * 1024 + 1));
        else controller.error(new Error('Interrupted private transport detail'));
      },
    })) });
    const source = validateLiveSource(content, AT);
    assert.equal(source.capture.status, oversized ? 'too_large' : 'unavailable');
    assert.equal(source.capture.exchanges[0].response, null);
    assert.equal(source.capture.exchanges[0].failure, oversized ? 'TOO_LARGE' : 'TRANSPORT');
    assert.equal(content.includes('private transport detail'), false);
  }
});

test('V99: stalled fetch has a bounded deadline even when injected transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = captureSource(DOCS, { now, fetchImpl: () => new Promise(() => {}) });
  t.mock.timers.tick(5000);
  const source = validateLiveSource(await pending, AT);
  assert.equal(source.capture.status, 'unavailable');
  assert.equal(source.capture.reasonCode, 'TIMEOUT');
  assert.equal(source.capture.exchanges[0].response, null);
});

test('V99: failed refresh invalidates the current graph while historical graph remains usable at its cutoff', async () => {
  const original = await pair();
  const originalGraph = projectLiveGraph(original, AT);
  const oldCopy = JSON.stringify(originalGraph);
  const failed = await captureSource(DOCS, { now, fetchImpl: async () => new Response('Unavailable', { status: 503 }) });
  const parsed = validateLiveSource(failed, AT);
  assert.equal(parsed.capture.reasonCode, 'HTTP_ERROR');
  assert.equal(Buffer.from(parsed.capture.exchanges[0].response.bodyBase64, 'base64').toString(), 'Unavailable');
  const nextGraph = projectLiveGraph([revision(failed), original[1]], AT);
  assert.equal(analyzeLiveGraph(nextGraph, QUERY, AT).status, 'NO_DATA');
  assert.equal(analyzeLiveGraph(originalGraph, QUERY, AT).status, 'OBSERVED');
  assert.equal(JSON.stringify(originalGraph), oldCopy);
  assert.notEqual(nextGraph.revision, originalGraph.revision);
});

test('V100: linked document and onchain account evidence produces OBSERVED with paths and no money approval', async () => {
  const revisions = await pair();
  const graph = projectLiveGraph(revisions, AT);
  const result = analyzeLiveGraph(graph, QUERY, AT);
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.mode, 'live');
  assert.equal(result.policyVersion, 'mesh-public-evidence/1');
  assert.equal(result.totalAffectedUnits, null);
  assert.equal(result.availableLiquidityUnits, null);
  assert.deepEqual(result.positionResults, []);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 4);
  assert.equal(result.coverage.visitedNodeIds.length, 5);
  assert.equal(result.coverage.visitedEdgeIds.length, 4);
  assert.deepEqual(result.sourceRevisionIds, revisions.map(source => source.revisionId).sort());
  assert.match(result.summary, /Lending usability and wallet ownership are not assessed/);
  assert.equal(analyze(revisions, { observationId: `observation:live:${DOCS}`, maxHops: 3 }).status, 'OBSERVED');
});

test('V100: document alone, account alone, missing links, and reached hop bound cannot produce OBSERVED', async () => {
  const revisions = await pair();
  assert.equal(analyze([revisions[0]], { observationId: `observation:live:${DOCS}`, maxHops: 3 }).status, 'NO_DATA');
  assert.equal(analyze([revisions[1]]).status, 'NO_DATA');
  const graph = projectLiveGraph(revisions, AT);
  graph.edges = graph.edges.filter(edge => edge.relation !== 'claims_program');
  assert.equal(analyzeLiveGraph(graph, QUERY, AT).status, 'NO_DATA');
  for (const maxHops of [1, 2]) {
    const result = analyze(revisions, { ...QUERY, maxHops });
    assert.equal(result.status, 'NO_DATA');
    assert.equal(result.coverage.status, 'truncated');
  }
});

test('V100: stale and future evidence cannot produce OBSERVED', async () => {
  const revisions = await pair();
  assert.equal(analyze(revisions, QUERY, later(300)).status, 'OBSERVED');
  assert.equal(analyze(revisions, QUERY, later(301)).status, 'NO_DATA');
  assert.equal(analyze(revisions, QUERY, later(-1)).status, 'NO_DATA');
  const futureCapture = revisions.map(source => ({ ...source, capturedAt: later(1) }));
  assert.equal(analyze(futureCapture).status, 'NO_DATA');
});

test('V100: a document deployment conflict cannot be rescued by a valid account capture', async () => {
  for (const document of [`## Deployments\n* Devnet: \`${OWNER}\`\n`, `${DOCUMENT}* Devnet: \`${OWNER}\`\n`, 'Unrelated official text']) {
    const revisions = await pair({ document });
    const graph = projectLiveGraph(revisions, AT);
    assert.ok(graph.issues.some(issue => issue.includes('DOCUMENT_CLAIM_MISMATCH')));
    assert.equal(analyzeLiveGraph(graph, QUERY, AT).status, 'NO_DATA');
  }
});

test('V99, V100: mixed modes, altered retained revisions, duplicate heads and forged graph provenance are rejected', async () => {
  const revisions = await pair();
  const synthetic = revision(JSON.stringify(makeDemoDocuments(AT)[0]));
  assert.throws(() => projectLiveGraph([...revisions, synthetic], AT), rejects);
  assert.throws(() => projectLiveGraph([{ ...revisions[0], sha256: '0'.repeat(64) }], AT), rejects);
  assert.throws(() => projectLiveGraph([revisions[0], { ...revisions[0], revisionId: randomUUID() }], AT), rejects);
  const graph = projectLiveGraph(revisions, AT);
  assert.throws(() => analyzeLiveGraph({ ...graph, mode: 'synthetic' }, QUERY, AT), rejects);
  assert.throws(() => analyzeLiveGraph({ ...graph, revision: '0'.repeat(64) }, QUERY, AT), rejects);
  graph.nodes[0].sourceRevisionIds = [randomUUID()];
  assert.throws(() => analyzeLiveGraph(graph, QUERY, AT), rejects);
});

test('V99: source receipt times must remain monotonic and bounded by capturedAt', async () => {
  const content = await captureSource(DOCS, { fetchImpl: fixtureFetch(), now });
  assert.throws(() => validateLiveSource(content, later(-1)), rejects);
  let tick = 0;
  await assert.rejects(captureSource(DOCS, { fetchImpl: fixtureFetch(), now: () => tick++ ? later(-1) : AT }), rejects);
});
