import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGraph, createRun, formatUsdc, replayRun } from '../treasury/domain.mjs';

const START = '2026-09-26T12:00:00.000Z';
const MAX_USDC = '18446744073709.551615';
const MAX_UNITS = '18446744073709551615';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (seconds) => new Date(Date.parse(START) + seconds * 1000).toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));

function setup(overrides = {}) {
  return {
    id: id(0), createdAt: START, totalUsdc: '1000', reserveUsdc: '300',
    investmentCapUsdc: '500', minLiquidityUsdc: '1000', maxObservationAgeSeconds: 60,
    ...overrides,
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function assertConserved(balance, expected = '1000000000') {
  assert.equal(balance.totalUnits, expected);
  assert.equal(['reserveUnits', 'undelegatedUnits', 'idleUnits', 'positionUnits']
    .reduce((total, key) => total + BigInt(balance[key]), 0n), BigInt(expected));
}

test('V77/V78: setup separates protected, undelegated, and delegated simulated cash', () => {
  const run = createRun(setup());
  const view = replayRun(run);
  assert.equal(run.mode, 'simulation');
  assert.equal(view.state.mode, 'simulation');
  assert.deepEqual(view.state.balances, {
    totalUnits: '1000000000', reserveUnits: '300000000', undelegatedUnits: '200000000',
    idleUnits: '500000000', positionUnits: '0',
  });
  assert.equal(view.state.observation, null);
  assert.equal(view.state.lastDecision, null);
  assert.equal(view.entries.length, 0);
});

test('V78: decimal ingress and display preserve every micro-USDC without floating point', () => {
  const view = replayRun(createRun(setup({ totalUsdc: '0.000006', reserveUsdc: '0.000001', investmentCapUsdc: '0.000003' })));
  assert.deepEqual(view.state.balances, { totalUnits: '6', reserveUnits: '1', undelegatedUnits: '2', idleUnits: '3', positionUnits: '0' });
  assert.equal(formatUsdc('1'), '0.000001');
  assert.equal(formatUsdc('1234000'), '1.234');
  assert.equal(formatUsdc('1000000'), '1');
  assert.equal(formatUsdc('0'), '0');
  assert.equal(formatUsdc(MAX_UNITS), MAX_USDC);
});

test('V78: u64 maximum survives setup and one excess unit is rejected', () => {
  const run = createRun(setup({ totalUsdc: MAX_USDC, reserveUsdc: '0', investmentCapUsdc: MAX_USDC, minLiquidityUsdc: MAX_USDC }));
  const view = replayRun(run);
  assert.equal(view.state.balances.idleUnits, MAX_UNITS);
  assert.equal(view.state.balances.positionUnits, '0');
  assertConserved(view.state.balances, MAX_UNITS);
  assert.throws(() => createRun(setup({ totalUsdc: '18446744073709.551616' })), /64-bit/);
  assert.throws(() => formatUsdc('18446744073709551616'), /64-bit/);
});

test('V78: money boundaries reject numbers, signs, exponent notation, whitespace, and excess precision', () => {
  for (const field of ['totalUsdc', 'reserveUsdc', 'investmentCapUsdc', 'minLiquidityUsdc']) {
    for (const value of [1, null, '', '-1', '+1', '1e2', ' 1', '1 ', '1.', '.1', '01', '0.0000001', 'NaN']) {
      assert.throws(() => createRun(setup({ [field]: value })), /USDC decimal string/, `${field}: ${value}`);
    }
  }
  for (const value of [1, null, '-1', '1.1', '01', '1e6']) assert.throws(() => formatUsdc(value), /integer-unit string/);
});

test('V78: setup rejects a reserve and investment cap that exceed total cash', () => {
  assert.throws(() => createRun(setup({ reserveUsdc: '500.000001' })), /reserve plus investment cap exceeds/);
  const boundary = replayRun(createRun(setup({ reserveUsdc: '500' })));
  assert.equal(boundary.state.balances.undelegatedUnits, '0');
});

test('V77/V83: saved setup keeps the exact version 1 record and an empty journal', () => {
  const run = createRun(setup());
  assert.deepEqual(Object.keys(run), ['schemaVersion', 'mode', 'id', 'createdAt', 'setup', 'events']);
  assert.equal(run.schemaVersion, 1);
  assert.deepEqual(run.events, []);
  const view = replayRun(clone(run));
  assert.deepEqual(view, replayRun(run));
  assert.equal(view.state.revision, 0);
  assert.equal(view.state.revoked, false);
  assert.equal(view.state.at, run.createdAt);
  for (const type of ['observe', 'cycle', 'revoke', 'owner_redeem']) {
    const nonempty = { ...run, events: [{ id: id(1), at: at(1), type }] };
    assert.throws(() => replayRun(nonempty), /empty event journal/);
    assert.equal(nonempty.events.length, 1);
  }
  for (const events of [null, {}, '', new Array(1)]) {
    assert.throws(() => replayRun({ ...run, events }), /empty event journal/);
  }
});

test('V77/V83: exact schemas reject unsupported state and malformed setup records', () => {
  assert.throws(() => createRun({ ...setup(), wallet: 'ignored' }), /unknown fields/);
  const run = createRun(setup());
  for (const field of ['state', 'graph', 'executionReady']) assert.throws(() => replayRun({ ...run, [field]: true }), /unknown fields/);
  for (const schemaVersion of [0, 2, '1', null]) assert.throws(() => replayRun({ ...run, schemaVersion }), /schema or mode/);
  assert.throws(() => replayRun({ ...run, mode: 'live' }), /schema or mode/);
  assert.throws(() => replayRun({ ...run, setup: { ...run.setup, extra: true } }), /unknown fields/);
  const missing = clone(run);
  delete missing.setup.reserveUsdc;
  assert.throws(() => replayRun(missing), /missing or unknown/);
  for (const invalid of [null, [], Object.create({ ...run })]) assert.throws(() => replayRun(invalid), /plain object/);
});

test('V83: saved setup validates UUIDs, canonical dates, and evidence-age policy', () => {
  assert.throws(() => createRun(setup({ id: 'run-1' })), /UUID/);
  for (const createdAt of ['2026-09-26T12:00:00Z', '2026-02-30T12:00:00.000Z', '2026-09-26T12:00:00.000+00:00']) {
    assert.throws(() => createRun(setup({ createdAt })), /UTC/);
  }
  for (const limit of [0, 3601, 1.5, '60', null, NaN, Infinity]) {
    assert.throws(() => createRun(setup({ maxObservationAgeSeconds: limit })), /age limit/);
  }
  assert.equal(replayRun(createRun(setup({ maxObservationAgeSeconds: 1 }))).state.mandate.maxObservationAgeSeconds, 1);
  assert.equal(replayRun(createRun(setup({ maxObservationAgeSeconds: 3600 }))).state.mandate.maxObservationAgeSeconds, 3600);
});

test('V78/V79: setup graph records protected funds and required authority relationships', () => {
  const { state, graph } = replayRun(createRun(setup()));
  assert.equal(graph.mode, 'simulation');
  assert.equal(graph.id, `${state.runId}:0:${START}`);
  assert.equal(graph.revision, 0);
  assert.deepEqual(graph.nodes.map(node => node.id), ['mandate', 'reserve', 'undelegated', 'account', 'position', 'observation']);
  assert.deepEqual(graph.edges, [
    { source: 'mandate', target: 'account', relation: 'authorizes' },
    { source: 'mandate', target: 'reserve', relation: 'excludes' },
    { source: 'mandate', target: 'undelegated', relation: 'excludes' },
    { source: 'account', target: 'position', relation: 'owns' },
    { source: 'position', target: 'observation', relation: 'depends_on' },
  ]);
  const data = Object.fromEntries(graph.nodes.map(node => [node.id, node.data]));
  assert.deepEqual(data.mandate, { investmentCapUnits: '500000000', minLiquidityUnits: '1000000000', maxObservationAgeSeconds: 60, revoked: false });
  assert.deepEqual(data.reserve, { reserveUnits: '300000000' });
  assert.deepEqual(data.undelegated, { undelegatedUnits: '200000000' });
  assert.deepEqual(data.account, { runId: state.runId, totalUnits: '1000000000', idleUnits: '500000000' });
  assert.deepEqual(data.position, { positionUnits: '0' });
  assert.deepEqual(data.observation, { observation: null });
  assertConserved(state.balances);
});

test('V78/V79: graph rejects changed balances and state that could not come from setup', () => {
  const state = replayRun(createRun(setup())).state;
  const changes = [
    s => { s.revision = 1; },
    s => { s.revoked = true; },
    s => { s.observation = {}; },
    s => { s.lastDecision = {}; },
    s => { s.at = at(1); },
    s => { s.mode = 'mainnet'; },
    s => { s.mandate.investmentCapUnits = '499999999'; },
    s => { s.balances.idleUnits = '500000001'; },
    s => { s.balances.idleUnits = '499999999'; s.balances.positionUnits = '1'; },
    s => { s.balances.idleUnits = '499999999'; s.balances.undelegatedUnits = '200000001'; },
  ];
  for (const change of changes) {
    const invalid = clone(state);
    change(invalid);
    assert.throws(() => buildGraph(invalid, at(1)));
  }
  assert.throws(() => buildGraph(state, at(-1)), /precedes state/);
  assert.equal(buildGraph(state, at(1)).at, at(1));
});

test('V77/V83: setup, replay, and graph building do not mutate or share the caller state', () => {
  const input = freeze(setup());
  const run = freeze(createRun(input));
  const before = JSON.stringify(run);
  const view = replayRun(run);
  const graph = buildGraph(freeze(view.state), START);
  graph.nodes.find(node => node.id === 'mandate').data.investmentCapUnits = '1';
  graph.edges.pop();
  assert.equal(view.state.mandate.investmentCapUnits, '500000000');
  assert.equal(view.graph.edges.length, 5);
  assert.equal(JSON.stringify(run), before);
  assert.deepEqual(replayRun(run), view);
});
