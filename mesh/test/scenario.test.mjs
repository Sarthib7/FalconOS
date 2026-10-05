import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureSource, projectLiveGraph } from '../live.mjs';
import { RESERVE_DECISION_MARKER, evaluateReserveScenario, parseScenario } from '../scenario.mjs';

const AT = '2026-09-27T12:00:00.000Z';
const RESERVE = 'solana-devnet-reserve-liquidity';
const OBSERVATION = `observation:live:${RESERVE}`;
const M = 'decision:mesh-reserve-scenario/1';
const PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const ADDRESS = { reserve: 'HRwMj8uuoGVWCanKzKvpTWN5ZvXjtjKGxcFbn2qTPKMW', vault: '6icVFmuKEsH5dzDwTSrxzrnJ14N27gDKRc2XAxPtB4ep' };
// Historical public accounts replayed under one controlled test slot. Never live data.
const PUBLIC = JSON.parse(readFileSync(new URL('./fixtures/kamino-public-accounts.json', import.meta.url), 'utf8'));
const BOOK = BigInt(PUBLIC.accounts[ADDRESS.reserve] && Buffer.from(PUBLIC.accounts[ADDRESS.reserve].data[0], 'base64').readBigUInt64LE(224));
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => AT;
const later = seconds => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const rejects = error => error?.code === 'INVALID_INPUT';
const SCENARIO = { proposedUnits: '1000', maxProposedUnits: '1000', minBookLiquidityUnits: String(BOOK), maxObservationAgeSeconds: 300 };

function account(name) {
  const source = PUBLIC.accounts[ADDRESS[name]];
  return { executable: source.executable, lamports: source.lamports, owner: source.owner, data: [...source.data], space: source.space };
}
function reserveFetch({ failAccounts = false } = {}) {
  return async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === 'getGenesisHash') return Response.json({ jsonrpc: '2.0', id: 1, result: GENESIS });
    if (failAccounts) return new Response('Unavailable', { status: 503 });
    const value = request.params[0].map(address => address === ADDRESS.reserve ? account('reserve') : address === ADDRESS.vault ? account('vault') : null);
    return Response.json({ jsonrpc: '2.0', id: 2, result: { context: { slot: PUBLIC.slot }, value } });
  };
}
async function reserveRevision(options) {
  const content = await captureSource(RESERVE, { fetchImpl: reserveFetch(options), now });
  const document = JSON.parse(content);
  return { revisionId: randomUUID(), sourceKey: document.sourceKey, sourceUrl: document.sourceUrl, observedAt: document.observedAt, capturedAt: AT, sha256: hash(content), content };
}
async function liveGraph(options) {
  const revision = await reserveRevision(options);
  return { revision, graph: projectLiveGraph([revision], AT) };
}
const check = (analysis, id) => analysis.checks.find(item => item.id === id);
const ids = list => list.map(item => item.id);

test('exports the shared decision marker', () => {
  assert.equal(RESERVE_DECISION_MARKER, M);
});

test('V114: fresh reserve evidence yields REVIEW with the exact analysis contract and never READY', async () => {
  const { revision, graph } = await liveGraph();
  const result = evaluateReserveScenario(graph, SCENARIO, AT);
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'kind', 'mode', 'policyVersion', 'at', 'graphRevision', 'observationId', 'status', 'summary',
    'scenario', 'checks', 'availableLiquidityUnits', 'totalAffectedUnits', 'positionResults', 'sourceRevisionIds', 'coverage', 'decisionGraph', 'executionReady', 'limits', 'expiresAt']);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, 'reserve_scenario_decision');
  assert.equal(result.mode, 'live');
  assert.equal(result.policyVersion, 'mesh-reserve-scenario/1');
  assert.equal(result.at, AT);
  assert.equal(result.graphRevision, graph.revision);
  assert.equal(result.observationId, OBSERVATION);
  assert.equal(result.status, 'REVIEW');
  assert.deepEqual(result.scenario, { ...SCENARIO, provenance: 'OWNER_ENTERED' });
  assert.deepEqual(result.checks.map(item => [item.id, item.status]), [['evidence', 'PASS'], ['freshness', 'PASS'], ['owner_cap', 'PASS'], ['book_floor', 'PASS']]);
  assert.equal(result.availableLiquidityUnits, String(BOOK));
  assert.equal(result.totalAffectedUnits, null);
  assert.deepEqual(result.positionResults, []);
  assert.deepEqual(result.sourceRevisionIds, [revision.revisionId]);
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.executionReady, false);
  assert.equal(result.expiresAt, later(300));
  assert.ok(result.summary.includes('not withdrawable liquidity'));
  assert.ok(result.summary.includes('execution approval'));
  assert.equal(JSON.stringify(result).includes('READY"'), false);
  assert.ok(result.limits.some(text => text.includes('not withdrawable')));
  assert.ok(result.limits.some(text => text.includes('not verified wallet holdings')));
  assert.ok(result.limits.some(text => text.includes('never executes')));
});

test('V114: decision graph carries only real source path IDs plus owner, rule and result nodes with truthful origins', async () => {
  const { graph } = await liveGraph();
  const { decisionGraph } = evaluateReserveScenario(graph, SCENARIO, AT);
  assert.equal(decisionGraph.schemaVersion, 1);
  const origins = Object.fromEntries(decisionGraph.nodes.map(node => [node.id, [node.kind, node.origin]]));
  assert.deepEqual(origins, {
    [OBSERVATION]: ['observation', 'OBSERVED'],
    [`account:devnet:${ADDRESS.reserve}`]: ['reserve', 'OBSERVED'],
    [`account:devnet:${ADDRESS.vault}`]: ['vault', 'OBSERVED'],
    [`account:devnet:${PROGRAM}`]: ['program', 'OBSERVED'],
    [`${M}:owner-proposal`]: ['proposal', 'OWNER_ENTERED'],
    [`${M}:owner-mandate`]: ['mandate', 'OWNER_ENTERED'],
    [`${M}:check:evidence`]: ['check', 'RULE'],
    [`${M}:check:freshness`]: ['check', 'RULE'],
    [`${M}:check:owner_cap`]: ['check', 'RULE'],
    [`${M}:check:book_floor`]: ['check', 'RULE'],
    [`${M}:result`]: ['decision', 'DERIVED'],
  });
  for (const node of decisionGraph.nodes) assert.deepEqual(Object.keys(node), ['id', 'kind', 'label', 'origin', 'detail']);
  const nodeIds = new Set(ids(decisionGraph.nodes));
  assert.equal(new Set(ids(decisionGraph.edges)).size, decisionGraph.edges.length);
  for (const edge of decisionGraph.edges) {
    assert.deepEqual(Object.keys(edge), ['id', 'source', 'target', 'relation']);
    assert.ok(nodeIds.has(edge.source) && nodeIds.has(edge.target), edge.id);
  }
  const live = decisionGraph.edges.filter(edge => edge.id.startsWith('edge:live:'));
  assert.deepEqual(live.map(edge => [edge.id, edge.source, edge.target, edge.relation]), [
    ['edge:live:reserve-observation', OBSERVATION, `account:devnet:${ADDRESS.reserve}`, 'observes'],
    ['edge:live:reserve-program', `account:devnet:${ADDRESS.reserve}`, `account:devnet:${PROGRAM}`, 'owned_by_program'],
    ['edge:live:reserve-vault', `account:devnet:${ADDRESS.reserve}`, `account:devnet:${ADDRESS.vault}`, 'holds_liquidity_in'],
  ]);
  const proposal = decisionGraph.nodes.find(node => node.id === `${M}:owner-proposal`);
  assert.ok(proposal.detail.includes('not a wallet holding'));
  assert.equal(decisionGraph.nodes.some(node => node.kind === 'wallet' || /holds?\b.*wallet/i.test(node.label)), false);
  const observation = decisionGraph.nodes.find(node => node.id === OBSERVATION).detail;
  assert.ok(observation.includes(`slot ${PUBLIC.slot}`) && observation.includes(String(BOOK)) && /sha256 [a-f0-9]{64}/.test(observation));
  for (const item of evaluateReserveScenario(graph, SCENARIO, AT).checks) for (const id of item.evidenceNodeIds) assert.ok(nodeIds.has(id));
  assert.deepEqual(check(evaluateReserveScenario(graph, SCENARIO, AT), 'evidence').evidenceNodeIds.sort(), [OBSERVATION, `account:devnet:${ADDRESS.reserve}`, `account:devnet:${ADDRESS.vault}`, `account:devnet:${PROGRAM}`].sort());
});

test('V114: evaluation is deterministic and never mutates the graph or scenario', async () => {
  const { graph } = await liveGraph();
  const graphCopy = JSON.stringify(graph);
  const scenario = { ...SCENARIO };
  const first = evaluateReserveScenario(graph, scenario, AT);
  assert.deepEqual(evaluateReserveScenario(graph, scenario, AT), first);
  assert.equal(JSON.stringify(graph), graphCopy);
  assert.deepEqual(scenario, SCENARIO);
  first.decisionGraph.nodes.pop();
  assert.equal(evaluateReserveScenario(graph, scenario, AT).decisionGraph.nodes.length, 11);
});

test('V114: owner cap and book floor boundaries are exact BigInt comparisons', async () => {
  const { graph } = await liveGraph();
  const run = patch => evaluateReserveScenario(graph, { ...SCENARIO, ...patch }, AT);
  // Equality passes on both limits.
  assert.equal(run({ proposedUnits: '1000', maxProposedUnits: '1000' }).status, 'REVIEW');
  assert.equal(run({ minBookLiquidityUnits: String(BOOK) }).status, 'REVIEW');
  assert.equal(run({ minBookLiquidityUnits: '0' }).status, 'REVIEW');
  // One unit over/under blocks with a clear per-check result.
  const overCap = run({ proposedUnits: '1001' });
  assert.equal(overCap.status, 'BLOCKED');
  assert.deepEqual(overCap.checks.map(item => item.status), ['PASS', 'PASS', 'BLOCKED', 'PASS']);
  assert.equal(overCap.availableLiquidityUnits, String(BOOK));
  const underFloor = run({ minBookLiquidityUnits: String(BOOK + 1n) });
  assert.equal(underFloor.status, 'BLOCKED');
  assert.deepEqual(underFloor.checks.map(item => item.status), ['PASS', 'PASS', 'PASS', 'BLOCKED']);
  const both = run({ proposedUnits: '1001', minBookLiquidityUnits: String(BOOK + 1n) });
  assert.equal(both.status, 'BLOCKED');
  assert.deepEqual(both.checks.map(item => item.status), ['PASS', 'PASS', 'BLOCKED', 'BLOCKED']);
  assert.ok(both.summary.includes('owner maximum') && both.summary.includes('owner floor'));
  // Values beyond Number precision keep exact comparison.
  const huge = '18446744073709551615';
  assert.equal(run({ proposedUnits: huge, maxProposedUnits: huge }).status, 'REVIEW');
  assert.equal(run({ proposedUnits: huge, maxProposedUnits: '18446744073709551614' }).status, 'BLOCKED');
  assert.equal(run({ proposedUnits: '9007199254740993', maxProposedUnits: '9007199254740992' }).status, 'BLOCKED');
  assert.equal(run({ minBookLiquidityUnits: huge }).status, 'BLOCKED');
});

test('V114: owner freshness limit and the 300 second ceiling are inclusive boundaries; stale or future evidence is NO_DATA', async () => {
  const { graph } = await liveGraph();
  const tight = { ...SCENARIO, maxObservationAgeSeconds: 60 };
  const atLimit = evaluateReserveScenario(graph, tight, later(60));
  assert.equal(atLimit.status, 'REVIEW');
  assert.equal(atLimit.expiresAt, later(60));
  assert.equal(evaluateReserveScenario(graph, SCENARIO, later(300)).status, 'REVIEW');
  const cases = [
    [tight, later(61), 'older'],
    [SCENARIO, later(301), 'older'],
    [SCENARIO, later(3600), 'older'],
    [SCENARIO, later(-1), 'after'],
  ];
  for (const [scenario, at, word] of cases) {
    const result = evaluateReserveScenario(graph, scenario, at);
    assert.equal(result.status, 'NO_DATA', at);
    assert.equal(result.availableLiquidityUnits, null);
    assert.equal(result.expiresAt, null);
    assert.equal(result.executionReady, false);
    assert.deepEqual(result.checks.map(item => item.status), ['PASS', 'NO_DATA', 'PASS', 'SKIPPED']);
    assert.ok(check(result, 'freshness').detail.includes(word) || check(result, 'freshness').detail.includes('above'), check(result, 'freshness').detail);
    assert.ok(result.summary.startsWith('No decision:'));
  }
  // Stale evidence outranks owner blocks: no BLOCKED status can hide missing data.
  const blockedButStale = evaluateReserveScenario(graph, { ...SCENARIO, proposedUnits: '1001' }, later(301));
  assert.equal(blockedButStale.status, 'NO_DATA');
  assert.equal(check(blockedButStale, 'owner_cap').status, 'BLOCKED');
});

test('V114: failed or absent reserve capture is NO_DATA with skipped checks and no fabricated source nodes', async () => {
  const failed = await liveGraph({ failAccounts: true });
  const empty = projectLiveGraph([], AT);
  for (const graph of [failed.graph, empty]) {
    const result = evaluateReserveScenario(graph, SCENARIO, AT);
    assert.equal(result.status, 'NO_DATA');
    assert.equal(result.availableLiquidityUnits, null);
    assert.equal(result.expiresAt, null);
    assert.deepEqual(result.checks.map(item => item.status), ['NO_DATA', 'SKIPPED', 'PASS', 'SKIPPED']);
    assert.deepEqual(result.decisionGraph.nodes.map(node => node.origin).filter(origin => origin === 'OBSERVED'), []);
    assert.equal(result.decisionGraph.nodes.some(node => node.id === OBSERVATION || node.id.startsWith('account:')), false);
    assert.equal(result.decisionGraph.edges.some(edge => edge.id.startsWith('edge:live:')), false);
    const nodeIds = new Set(ids(result.decisionGraph.nodes));
    for (const edge of result.decisionGraph.edges) assert.ok(nodeIds.has(edge.source) && nodeIds.has(edge.target));
    assert.ok(nodeIds.has(`${M}:owner-proposal`) && nodeIds.has(`${M}:owner-mandate`) && nodeIds.has(`${M}:result`));
  }
});

test('V114: only the reserve capture is decision evidence, never other live sources', async () => {
  const { revision, graph } = await liveGraph();
  const result = evaluateReserveScenario(graph, SCENARIO, AT);
  assert.deepEqual(result.sourceRevisionIds, [revision.revisionId]);
  assert.equal(result.observationId, OBSERVATION);
  // Program or document evidence alone can never satisfy the reserve decision.
  const other = await captureSource('solana-devnet-klend', {
    now, fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      if (request.method === 'getGenesisHash') return Response.json({ jsonrpc: '2.0', id: 1, result: GENESIS });
      return Response.json({ jsonrpc: '2.0', id: 2, result: { context: { slot: 123 }, value: { executable: true, owner: 'BPFLoaderUpgradeab1e11111111111111111111111', data: [Buffer.alloc(36, 1).toString('base64'), 'base64'], space: 36 } } });
    },
  });
  const document = JSON.parse(other);
  const rpc = { revisionId: randomUUID(), sourceKey: document.sourceKey, sourceUrl: document.sourceUrl, observedAt: document.observedAt, capturedAt: AT, sha256: hash(other), content: other };
  const onlyRpc = evaluateReserveScenario(projectLiveGraph([rpc], AT), SCENARIO, AT);
  assert.equal(onlyRpc.status, 'NO_DATA');
  assert.deepEqual(onlyRpc.sourceRevisionIds, []);
  const combined = evaluateReserveScenario(projectLiveGraph([rpc, revision], AT), SCENARIO, AT);
  assert.equal(combined.status, 'REVIEW');
  assert.deepEqual(combined.sourceRevisionIds, [revision.revisionId]);
});

test('V114: forged graphs, wrong mode and invalid times fail closed at the boundary', async () => {
  const { graph } = await liveGraph();
  assert.throws(() => evaluateReserveScenario({ ...graph, mode: 'synthetic' }, SCENARIO, AT), rejects);
  assert.throws(() => evaluateReserveScenario({ ...graph, revision: '0'.repeat(64) }, SCENARIO, AT), rejects);
  assert.throws(() => evaluateReserveScenario(graph, SCENARIO, 'yesterday'), rejects);
  assert.throws(() => evaluateReserveScenario(graph, { ...SCENARIO, proposedUnits: '0' }, AT), rejects);
  const forged = structuredClone(graph);
  forged.nodes.find(node => node.id === OBSERVATION).properties.withdrawable = true;
  assert.throws(() => evaluateReserveScenario(forged, SCENARIO, AT), rejects);
});

test('V114: parseScenario accepts only exact canonical u64 strings and a bounded integer age', () => {
  const ok = parseScenario(SCENARIO);
  assert.deepEqual(ok, SCENARIO);
  assert.deepEqual(parseScenario(ok), ok);
  assert.notEqual(ok, SCENARIO);
  const U64_MAX = '18446744073709551615';
  assert.deepEqual(parseScenario({ ...SCENARIO, proposedUnits: U64_MAX, maxProposedUnits: U64_MAX, minBookLiquidityUnits: '0', maxObservationAgeSeconds: 1 }),
    { proposedUnits: U64_MAX, maxProposedUnits: U64_MAX, minBookLiquidityUnits: '0', maxObservationAgeSeconds: 1 });
  const bad = [];
  for (const field of ['proposedUnits', 'maxProposedUnits', 'minBookLiquidityUnits']) {
    for (const value of ['18446744073709551616', '99999999999999999999999', '01', '+1', '-1', ' 1', '1 ', '1.0', '1e3', '0x10', '', '١٢', 1, 1n, null, undefined, {}, [], true]) {
      bad.push([field, value]);
    }
  }
  bad.push(['proposedUnits', '0'], ['maxProposedUnits', '0']);
  for (const value of [0, 301, -1, 1.5, '60', NaN, Infinity, null, undefined, 1n, 3e2 + 1]) bad.push(['maxObservationAgeSeconds', value]);
  for (const [field, value] of bad) assert.throws(() => parseScenario({ ...SCENARIO, [field]: value }), rejects, `${field}=${String(value)}`);
  const withMissing = { ...SCENARIO }; delete withMissing.minBookLiquidityUnits;
  const withGetter = { ...SCENARIO }; Object.defineProperty(withGetter, 'proposedUnits', { get: () => '1', enumerable: true });
  for (const input of [null, undefined, 'x', 5, [], [SCENARIO], withMissing, { ...SCENARIO, extra: 1 }, { ...SCENARIO, provenance: 'OWNER_ENTERED' },
    { ...SCENARIO, [Symbol('x')]: 1 }, Object.create({ ...SCENARIO }), withGetter, new (class Scenario { constructor() { Object.assign(this, SCENARIO); } })()]) {
    assert.throws(() => parseScenario(input), rejects);
  }
  assert.deepEqual(parseScenario(Object.assign(Object.create(null), SCENARIO)), SCENARIO);
});
