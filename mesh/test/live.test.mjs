import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CONNECTORS, captureSource, validateLiveSource, projectLiveGraph, analyzeLiveGraph } from '../live.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const AT = '2026-09-27T12:00:00.000Z';
const PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const OWNER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const DOCS = 'kamino-program-docs';
const RPC = 'solana-devnet-klend';
const RESERVE = 'solana-devnet-reserve-liquidity';
const QUERY = { observationId: `observation:live:${RPC}`, maxHops: 3 };
const DOCUMENT = `# Test capture\n\n## Deployments\n\n* Devnet: \`${PROGRAM}\`\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => AT;
const later = seconds => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const rejects = error => error?.code === 'INVALID_INPUT';

function accountResult() {
  return { context: { slot: 123 }, value: { executable: true, owner: OWNER, data: [Buffer.alloc(36, 1).toString('base64'), 'base64'], space: 36 } };
}
// Non-atomic historical test replay: public fixture accounts (reserve/vault were read at two different past slots)
// are recombined into ONE synthetic getMultipleAccounts response under a single test context slot. Never live data.
const PUBLIC = JSON.parse(readFileSync(new URL('./fixtures/kamino-public-accounts.json', import.meta.url), 'utf8'));
const ADDRESS = { reserve: 'HRwMj8uuoGVWCanKzKvpTWN5ZvXjtjKGxcFbn2qTPKMW', vault: '6icVFmuKEsH5dzDwTSrxzrnJ14N27gDKRc2XAxPtB4ep' };
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TEST_SLOT = PUBLIC.slot;
const RESERVE_BYTES = Buffer.from(PUBLIC.accounts[ADDRESS.reserve].data[0], 'base64');
const VAULT_BYTES = Buffer.from(PUBLIC.accounts[ADDRESS.vault].data[0], 'base64');
const BOOK_AMOUNT = RESERVE_BYTES.readBigUInt64LE(224);
const RESERVE_QUERY = { observationId: `observation:live:${RESERVE}`, maxHops: 3 };
const RESERVE_POLICY = 'mesh-reserve-liquidity/1';
const OBSERVATION_KEYS = ['availableLiquidityUnits', 'observationType', 'reasonCode', 'reserveDataSha256', 'slot', 'status', 'vaultDataSha256'];

function reserveAccount(name) {
  const source = PUBLIC.accounts[ADDRESS[name]];
  return { executable: source.executable, lamports: source.lamports, owner: source.owner, data: [...source.data], space: source.space };
}
// Edits account bytes and keeps the declared space consistent unless told otherwise.
function editBytes(account, change, { space = true } = {}) {
  const bytes = change(Buffer.from(account.data[0], 'base64'));
  account.data[0] = bytes.toString('base64');
  if (space) account.space = bytes.length;
}
const withBytes = (offset, value) => bytes => { value.copy(bytes, offset); return bytes; };
const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const pubkeyBytes = base58Address => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of base58Address) number = number * 58n + BigInt(alphabet.indexOf(character));
  const out = Buffer.alloc(32);
  for (let index = 31; index >= 0; index -= 1) { out[index] = Number(number & 255n); number >>= 8n; }
  return out;
};
// One response for the fixed pair, keyed by requested address so the test does not pin request ordering.
function reserveResponse(addresses, mutate) {
  const byAddress = { reserve: reserveAccount('reserve'), vault: reserveAccount('vault') };
  const result = { context: { slot: TEST_SLOT }, value: addresses.map(address => address === ADDRESS.reserve ? byAddress.reserve : address === ADDRESS.vault ? byAddress.vault : null) };
  mutate?.(result, byAddress);
  return result;
}
function fixtureFetch({ document = DOCUMENT, genesis = GENESIS, account = accountResult(), reserve, calls = [] } = {}) {
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
    if (request.method === 'getMultipleAccounts') {
      assert.equal(request.jsonrpc, '2.0');
      assert.equal(request.id, 2);
      assert.equal(request.params.length, 2);
      assert.deepEqual(request.params[1], { encoding: 'base64', commitment: 'confirmed' });
      assert.deepEqual([...request.params[0]].sort(), Object.values(ADDRESS).sort());
      return Response.json({ jsonrpc: '2.0', id: 2, result: reserveResponse(request.params[0], typeof reserve === 'function' ? reserve : undefined) });
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
  assert.deepEqual(CONNECTORS.map(item => Object.keys(item).sort()), Array(3).fill(['id', 'label', 'network', 'sourceUrl']));
  assert.deepEqual(CONNECTORS.map(item => item.id).sort(), [DOCS, RESERVE, RPC].sort());
  const reserveConnector = CONNECTORS.find(item => item.id === RESERVE);
  assert.equal(reserveConnector.sourceUrl, 'https://api.devnet.solana.com');
  assert.equal(reserveConnector.network, 'devnet');
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

// ---- Devnet reserve-liquidity connector (KLend reserve book amount vs SPL vault amount, one snapshot) ----

async function reserveCapture(options) { return captureSource(RESERVE, { fetchImpl: fixtureFetch(options), now }); }
const observationOf = source => source.nodes.find(node => node.kind === 'observation');
const failsClosed = run => { try { return run().status === 'NO_DATA'; } catch (error) { return rejects(error); } };
function forgeReserveBody(source, change) {
  const exchange = source.capture.exchanges[1];
  const body = JSON.parse(Buffer.from(exchange.response.bodyBase64, 'base64'));
  change(body.result);
  const raw = Buffer.from(JSON.stringify(body));
  Object.assign(exchange.response, { bodyBase64: raw.toString('base64'), sha256: hash(raw), byteLength: raw.length });
}
function stripGraphRevision(result) { const { graphRevision, ...rest } = result; return rest; }

test('V113: reserve capture retains the exact one-snapshot response, raw account bytes, hashes and slot (historical replay fixture)', async () => {
  const calls = [];
  const content = await reserveCapture({ calls });
  const source = validateLiveSource(content, AT);
  const methods = calls.map(call => JSON.parse(call.init.body).method);
  assert.deepEqual(methods, ['getGenesisHash', 'getMultipleAccounts']);
  assert.deepEqual(source.capture.chain, { network: 'devnet', genesisHash: GENESIS, commitment: 'confirmed', slot: String(TEST_SLOT) });
  assert.equal(source.capture.status, 'ok');
  assert.equal(source.capture.reasonCode, null);
  assert.equal(source.capture.exchanges.length, 2);
  const exchange = source.capture.exchanges[1];
  const raw = Buffer.from(exchange.response.bodyBase64, 'base64');
  assert.equal(exchange.response.sha256, hash(raw));
  assert.equal(exchange.response.byteLength, raw.length);
  const requested = JSON.parse(Buffer.from(exchange.request.bodyBase64, 'base64'));
  assert.deepEqual([...requested.params[0]].sort(), Object.values(ADDRESS).sort());
  const retained = JSON.parse(raw);
  assert.equal(retained.result.context.slot, TEST_SLOT);
  const retainedBytes = Object.fromEntries(requested.params[0].map((address, index) => [address, Buffer.from(retained.result.value[index].data[0], 'base64')]));
  assert.ok(retainedBytes[ADDRESS.reserve].equals(RESERVE_BYTES));
  assert.ok(retainedBytes[ADDRESS.vault].equals(VAULT_BYTES));
  // The two fields the connector compares are equal in the public data, and equal to the projected value.
  assert.equal(RESERVE_BYTES.readBigUInt64LE(224), VAULT_BYTES.readBigUInt64LE(64));
  const observation = observationOf(source);
  assert.deepEqual(Object.keys(observation.properties).sort(), OBSERVATION_KEYS);
  assert.deepEqual(observation.properties, {
    observationType: 'reserve_liquidity', status: 'ok', reasonCode: null, slot: String(TEST_SLOT),
    availableLiquidityUnits: String(BOOK_AMOUNT), reserveDataSha256: hash(RESERVE_BYTES), vaultDataSha256: hash(VAULT_BYTES),
  });
  assert.equal(observation.id, `observation:live:${RESERVE}`);
  const accounts = source.nodes.filter(node => node.kind === 'account').map(node => node.properties.address);
  assert.ok(accounts.includes(ADDRESS.reserve) && accounts.includes(ADDRESS.vault) && accounts.includes(PROGRAM));
  const relations = source.edges.map(edge => edge.relation).sort();
  assert.deepEqual(relations, ['holds_liquidity_in', 'observes', 'owned_by_program']);
});

test('V113: equal u64 reserve and vault amounts stay exact strings including zero and the u64 maximum', async () => {
  for (const amount of [0n, 1n, 2n ** 53n + 1n, 2n ** 64n - 1n]) {
    const content = await reserveCapture({ reserve: (_, by) => {
      editBytes(by.reserve, withBytes(224, u64(amount)));
      editBytes(by.vault, withBytes(64, u64(amount)));
    } });
    const source = validateLiveSource(content, AT);
    assert.equal(source.capture.status, 'ok');
    assert.equal(observationOf(source).properties.availableLiquidityUnits, amount.toString());
    assert.equal(analyze([revision(content)], RESERVE_QUERY).availableLiquidityUnits, amount.toString());
  }
});

const RESERVE_FAILURES = {
  'reserve amount differs from vault amount': (_, by) => editBytes(by.reserve, withBytes(224, u64(BOOK_AMOUNT + 1n))),
  'vault amount differs from reserve amount': (_, by) => editBytes(by.vault, withBytes(64, u64(BOOK_AMOUNT - 1n))),
  'reserve not owned by the lending program': (_, by) => { by.reserve.owner = OWNER; },
  'reserve owned by the token program': (_, by) => { by.reserve.owner = TOKEN; },
  'reserve market pointer changed': (_, by) => editBytes(by.reserve, withBytes(32, pubkeyBytes(ADDRESS.vault))),
  'reserve liquidity mint pointer changed': (_, by) => editBytes(by.reserve, withBytes(128, pubkeyBytes(ADDRESS.vault))),
  'reserve vault pointer changed': (_, by) => editBytes(by.reserve, withBytes(160, pubkeyBytes(ADDRESS.reserve))),
  'reserve shorter than the pinned layout': (_, by) => editBytes(by.reserve, bytes => bytes.subarray(0, bytes.length - 1)),
  'reserve longer than the pinned layout': (_, by) => editBytes(by.reserve, bytes => Buffer.concat([bytes, Buffer.alloc(1)])),
  'reserve declared space disagrees with bytes': (_, by) => { by.reserve.space += 1; },
  'vault owned by Token-2022': (_, by) => { by.vault.owner = TOKEN_2022; },
  'vault owned by the lending program': (_, by) => { by.vault.owner = PROGRAM; },
  'vault mint changed': (_, by) => editBytes(by.vault, withBytes(0, pubkeyBytes(ADDRESS.reserve))),
  'vault authority changed': (_, by) => editBytes(by.vault, withBytes(32, pubkeyBytes(ADDRESS.reserve))),
  'vault authority is empty': (_, by) => editBytes(by.vault, withBytes(32, Buffer.alloc(32))),
  'vault uninitialized': (_, by) => editBytes(by.vault, withBytes(108, Buffer.from([0]))),
  'vault frozen': (_, by) => editBytes(by.vault, withBytes(108, Buffer.from([2]))),
  'vault shorter than a classic token account': (_, by) => editBytes(by.vault, bytes => bytes.subarray(0, 164)),
  'vault longer than a classic token account': (_, by) => editBytes(by.vault, bytes => Buffer.concat([bytes, Buffer.alloc(1)])),
  'reserve missing': (result, by) => { result.value[result.value.indexOf(by.reserve)] = null; },
  'vault missing': (result, by) => { result.value[result.value.indexOf(by.vault)] = null; },
  'accounts returned in the swapped order': result => { result.value.reverse(); },
  'one account returned': result => { result.value.pop(); },
  'extra account returned': (result, by) => { result.value.push(by.vault); },
  'non-base64 encoding': (_, by) => { by.vault.data[1] = 'jsonParsed'; },
  'missing context slot': result => { delete result.context; },
  'negative slot': result => { result.context.slot = -1; },
  'string slot': result => { result.context.slot = String(TEST_SLOT); },
  'fractional slot': result => { result.context.slot = 1.5; },
};

test('V113: any identity, layout, amount or response mismatch fails closed and never carries liquidity', async () => {
  for (const [name, mutate] of Object.entries(RESERVE_FAILURES)) {
    const content = await reserveCapture({ reserve: mutate });
    const source = validateLiveSource(content, AT);
    const observation = observationOf(source);
    assert.notEqual(source.capture.status, 'ok', name);
    assert.equal(typeof source.capture.reasonCode, 'string', name);
    assert.notEqual(observation.properties.status, 'ok', name);
    assert.equal(observation.properties.availableLiquidityUnits, null, name);
    assert.deepEqual(Object.keys(observation.properties).sort(), OBSERVATION_KEYS, name);
    assert.equal(source.capture.exchanges.length, 2, name);
    assert.ok(source.capture.exchanges[1].response.bodyBase64, name);
    const result = analyze([revision(content)], RESERVE_QUERY);
    assert.equal(result.status, 'NO_DATA', name);
    assert.equal(result.availableLiquidityUnits, null, name);
    assert.equal(result.totalAffectedUnits, null, name);
  }
});

test('V113: wrong cluster stops before any reserve account request and yields NO_DATA', async () => {
  const calls = [];
  const content = await reserveCapture({ genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', calls });
  const source = validateLiveSource(content, AT);
  assert.equal(calls.length, 1);
  assert.equal(source.capture.reasonCode, 'WRONG_CLUSTER');
  assert.equal(source.capture.chain, null);
  assert.equal(analyze([revision(content)], RESERVE_QUERY).status, 'NO_DATA');
});

test('V113: transport failures of the reserve read retain no complete evidence and analyze as NO_DATA', async () => {
  const fetched = fixtureFetch();
  let failed = 0;
  for (const status of [503, 200]) {
    const content = await captureSource(RESERVE, { now, fetchImpl: async (url, init) => {
      const request = JSON.parse(init.body);
      if (request.method !== 'getMultipleAccounts') return fetched(url, init);
      failed += 1;
      return status === 503 ? new Response('Unavailable', { status }) : new Response('not json', { status });
    } });
    const source = validateLiveSource(content, AT);
    assert.notEqual(source.capture.status, 'ok');
    assert.equal(observationOf(source).properties.availableLiquidityUnits, null);
    assert.equal(analyze([revision(content)], RESERVE_QUERY).status, 'NO_DATA');
  }
  assert.equal(failed, 2);
});

test('V113: forged reserve projection, retained bytes, request and slot are rejected', async () => {
  const content = await reserveCapture();
  const mutations = {
    'liquidity value': source => { observationOf(source).properties.availableLiquidityUnits = '1'; },
    'liquidity as number': source => { observationOf(source).properties.availableLiquidityUnits = Number(BOOK_AMOUNT); },
    'reserve hash': source => { observationOf(source).properties.reserveDataSha256 = '0'.repeat(64); },
    'vault hash': source => { observationOf(source).properties.vaultDataSha256 = '0'.repeat(64); },
    'slot': source => { observationOf(source).properties.slot = '1'; },
    'chain slot': source => { source.capture.chain.slot = '1'; },
    'status': source => { source.capture.status = 'invalid'; },
    'extra property': source => { observationOf(source).properties.withdrawable = true; },
    'missing property': source => { delete observationOf(source).properties.vaultDataSha256; },
    'observation type': source => { observationOf(source).properties.observationType = 'program_account'; },
    'reserve address': source => { source.nodes.find(node => node.kind === 'account' && node.properties.address === ADDRESS.reserve).properties.address = ADDRESS.vault; },
    'edge relation': source => { source.edges.find(edge => edge.relation === 'holds_liquidity_in').relation = 'owned_by_program'; },
    'missing edge': source => { source.edges = source.edges.filter(edge => edge.relation !== 'owned_by_program'); },
    'extra edge': source => { source.edges.push({ ...source.edges[0], id: 'edge:live:extra' }); },
    'request accounts': source => {
      const request = JSON.parse(Buffer.from(source.capture.exchanges[1].request.bodyBase64, 'base64'));
      request.params[0].push(PROGRAM);
      source.capture.exchanges[1].request.bodyBase64 = Buffer.from(JSON.stringify(request)).toString('base64');
    },
    'request commitment': source => {
      const request = JSON.parse(Buffer.from(source.capture.exchanges[1].request.bodyBase64, 'base64'));
      request.params[1].commitment = 'processed';
      source.capture.exchanges[1].request.bodyBase64 = Buffer.from(JSON.stringify(request)).toString('base64');
    },
    'retained amount with consistent hash': source => forgeReserveBody(source, result => {
      const account = result.value.find(item => item.owner === PROGRAM);
      const bytes = Buffer.from(account.data[0], 'base64'); u64(BOOK_AMOUNT + 1n).copy(bytes, 224); account.data[0] = bytes.toString('base64');
    }),
    'retained slot with consistent hash': source => forgeReserveBody(source, result => { result.context.slot += 1; }),
    'retained vault removed with consistent hash': source => forgeReserveBody(source, result => { result.value[result.value.findIndex(item => item.owner === TOKEN)] = null; }),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const source = JSON.parse(content); mutate(source);
    assert.throws(() => validateLiveSource(JSON.stringify(source), AT), rejects, name);
  }
});

test('V113: reserve analysis reports observed book liquidity under its own policy without any approval claim', async () => {
  const revisions = [revision(await reserveCapture())];
  const graph = projectLiveGraph(revisions, AT);
  assert.deepEqual(graph.issues, []);
  const result = analyzeLiveGraph(graph, RESERVE_QUERY, AT);
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.mode, 'live');
  assert.equal(result.policyVersion, RESERVE_POLICY);
  assert.equal(result.availableLiquidityUnits, String(BOOK_AMOUNT));
  assert.equal(result.totalAffectedUnits, null);
  assert.deepEqual(result.positionResults, []);
  assert.deepEqual(result.sourceRevisionIds, revisions.map(source => source.revisionId));
  assert.equal(result.observationId, RESERVE_QUERY.observationId);
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.coverage.visitedNodeIds.length, 4);
  assert.equal(result.coverage.visitedEdgeIds.length, 3);
  const [docs, rpc] = await pair();
  assert.deepEqual(Object.keys(result).sort(), Object.keys(analyze([docs, rpc])).sort());
  // All three fixed sources together still answer the reserve question with the reserve policy.
  const combined = analyzeLiveGraph(projectLiveGraph([docs, rpc, ...revisions], AT), RESERVE_QUERY, AT);
  assert.equal(combined.policyVersion, RESERVE_POLICY);
  assert.equal(combined.status, 'OBSERVED');
  assert.equal(combined.availableLiquidityUnits, String(BOOK_AMOUNT));
  assert.equal(combined.totalAffectedUnits, null);
});

test('V113: stale, future and failed reserve evidence yields NO_DATA with no liquidity value', async () => {
  const revisions = [revision(await reserveCapture())];
  assert.equal(analyze(revisions, RESERVE_QUERY, later(300)).status, 'OBSERVED');
  for (const at of [later(301), later(3600), later(-1)]) {
    const result = analyze(revisions, RESERVE_QUERY, at);
    assert.equal(result.status, 'NO_DATA');
    assert.equal(result.policyVersion, RESERVE_POLICY);
    assert.equal(result.availableLiquidityUnits, null);
    assert.equal(result.totalAffectedUnits, null);
  }
  const futureCapture = revisions.map(source => ({ ...source, capturedAt: later(1) }));
  assert.equal(analyze(futureCapture, RESERVE_QUERY).status, 'NO_DATA');
  const failed = [revision(await reserveCapture({ reserve: RESERVE_FAILURES['reserve amount differs from vault amount'] }))];
  const result = analyze(failed, RESERVE_QUERY);
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.availableLiquidityUnits, null);
  assert.equal(result.policyVersion, RESERVE_POLICY);
});

test('V113: forged reserve graph observations cannot produce OBSERVED', async () => {
  const revisions = [revision(await reserveCapture())];
  const mutations = {
    'numeric liquidity': node => { node.properties.availableLiquidityUnits = Number(BOOK_AMOUNT); },
    'leading zero liquidity': node => { node.properties.availableLiquidityUnits = `0${BOOK_AMOUNT}`; },
    'negative liquidity': node => { node.properties.availableLiquidityUnits = '-1'; },
    'oversized liquidity': node => { node.properties.availableLiquidityUnits = (2n ** 64n).toString(); },
    'ok without liquidity': node => { node.properties.availableLiquidityUnits = null; },
    'ok without reserve hash': node => { node.properties.reserveDataSha256 = null; },
    'ok without slot': node => { node.properties.slot = null; },
    'ok with a reason': node => { node.properties.reasonCode = 'FORGED'; },
    'malformed hash': node => { node.properties.vaultDataSha256 = 'xyz'; },
    'extra key': node => { node.properties.withdrawable = true; },
    'wrong type': node => { node.properties.observationType = 'document'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const graph = projectLiveGraph(revisions, AT);
    mutate(graph.nodes.find(node => node.id === RESERVE_QUERY.observationId));
    assert.ok(failsClosed(() => analyzeLiveGraph(graph, RESERVE_QUERY, AT)), name);
  }
  for (const edgeMutation of [
    graph => { graph.edges = graph.edges.filter(edge => edge.relation !== 'holds_liquidity_in'); },
    graph => { graph.edges = graph.edges.filter(edge => edge.relation !== 'owned_by_program'); },
    graph => { graph.edges.find(edge => edge.relation === 'holds_liquidity_in').relation = 'claims_program'; },
    graph => { graph.nodes = graph.nodes.filter(node => node.properties.address !== ADDRESS.vault); },
  ]) {
    const graph = projectLiveGraph(revisions, AT);
    edgeMutation(graph);
    assert.ok(failsClosed(() => analyzeLiveGraph(graph, RESERVE_QUERY, AT)));
  }
});

test('V100, V113: optional reserve capture, healthy or failed, never changes the two-source program result', async () => {
  const [docs, rpc] = await pair();
  const baselineGraph = projectLiveGraph([docs, rpc], AT);
  const baseline = analyzeLiveGraph(baselineGraph, QUERY, AT);
  assert.equal(baseline.status, 'OBSERVED');
  assert.equal(baseline.policyVersion, 'mesh-public-evidence/1');
  assert.equal(baselineGraph.nodes.length, 5);
  assert.equal(baselineGraph.edges.length, 4);
  assert.deepEqual(baseline.sourceRevisionIds, [docs.revisionId, rpc.revisionId].sort());
  const healthy = revision(await reserveCapture());
  const failing = [
    revision(await reserveCapture({ reserve: RESERVE_FAILURES['reserve amount differs from vault amount'] })),
    revision(await reserveCapture({ reserve: RESERVE_FAILURES['vault owned by Token-2022'] })),
    revision(await reserveCapture({ genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' })),
  ];
  for (const reserve of [healthy, ...failing]) {
    for (const start of [`observation:live:${RPC}`, `observation:live:${DOCS}`]) {
      const graph = projectLiveGraph([docs, rpc, reserve], AT);
      const result = analyzeLiveGraph(graph, { observationId: start, maxHops: 3 }, AT);
      const expected = analyze([docs, rpc], { observationId: start, maxHops: 3 });
      assert.deepEqual(stripGraphRevision(result), stripGraphRevision(expected));
      assert.equal(result.status, 'OBSERVED');
      assert.equal(result.policyVersion, 'mesh-public-evidence/1');
      assert.equal(result.availableLiquidityUnits, null);
      assert.equal(result.coverage.visitedNodeIds.length, 5);
      assert.equal(result.coverage.visitedEdgeIds.length, 4);
      assert.deepEqual(result.sourceRevisionIds, [docs.revisionId, rpc.revisionId].sort());
    }
  }
  // The historical two-source graph is byte-stable and unaffected by the new connector's existence.
  assert.equal(JSON.stringify(projectLiveGraph([docs, rpc], AT)), JSON.stringify(baselineGraph));
  assert.deepEqual(baselineGraph.issues, []);
});

test('V113: reserve, program and document graphs merge without conflicting shared program identity', async () => {
  const [docs, rpc] = await pair();
  const reserve = revision(await reserveCapture());
  const graph = projectLiveGraph([docs, rpc, reserve], AT);
  assert.deepEqual(graph.issues, []);
  assert.equal(graph.nodes.length, 8);
  assert.equal(graph.edges.length, 7);
  assert.equal(graph.sources.length, 3);
  const program = graph.nodes.find(node => node.kind === 'account' && node.properties.address === PROGRAM);
  assert.deepEqual([...program.sourceRevisionIds].sort(), [docs.revisionId, rpc.revisionId, reserve.revisionId].sort());
});
