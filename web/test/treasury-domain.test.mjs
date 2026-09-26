import assert from 'node:assert/strict';
import test from 'node:test';
import { appendEvent, buildGraph, createRun, decide, formatUsdc, replayRun } from '../treasury/domain.mjs';

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

function event(n, type = 'cycle', seconds = n) { return { id: id(n), at: at(seconds), type }; }
function observe(n, liquidity = '2000', options = {}) {
  return { ...event(n, 'observe', options.at ?? n), observation: {
    source: 'synthetic', status: options.status ?? 'ok', observedAt: at(options.observedAt ?? n),
    availableLiquidityUsdc: liquidity,
  } };
}
function withObservation() { return appendEvent(createRun(setup()), observe(1)); }
function funded() { return appendEvent(withObservation(), event(2)); }
function decisionGraph() { return buildGraph(replayRun(withObservation()).state, at(2)); }
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

test('V78: u64 maximum survives a supply cycle and one excess unit is rejected', () => {
  let run = createRun(setup({ totalUsdc: MAX_USDC, reserveUsdc: '0', investmentCapUsdc: MAX_USDC, minLiquidityUsdc: MAX_USDC }));
  run = appendEvent(run, observe(1, MAX_USDC));
  run = appendEvent(run, event(2));
  const view = replayRun(run);
  assert.equal(view.state.balances.positionUnits, MAX_UNITS);
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

test('V78/V80/V81: supply, funded hold, and liquid redemption conserve protected funds', () => {
  let run = funded();
  run = appendEvent(run, event(3));
  run = appendEvent(run, observe(4, '750'));
  run = appendEvent(run, event(5));
  const view = replayRun(run);
  const decisions = view.entries.filter((entry) => entry.decision).map((entry) => entry.decision.action);
  assert.deepEqual(decisions, ['SUPPLY', 'HOLD', 'REDEEM']);
  assert.equal(view.state.balances.idleUnits, '500000000');
  assert.equal(view.state.balances.positionUnits, '0');
  for (const entry of view.entries) {
    assertConserved(entry.balances);
    assert.equal(entry.balances.reserveUnits, '300000000');
    assert.equal(entry.balances.undelegatedUnits, '200000000');
    assert.equal(entry.outcome.mode, 'simulation');
  }
  assert.equal(view.entries[1].outcome.status, 'SIMULATED');
  assert.equal(view.entries[2].outcome.status, 'HELD');
  assert.equal(view.entries[4].outcome.amountUnits, '500000000');
});

test('V80: only delegated cash supplies, including a one-unit cap', () => {
  let run = createRun(setup({ investmentCapUsdc: '0.000001' }));
  run = appendEvent(run, observe(1));
  run = appendEvent(run, event(2));
  const balance = replayRun(run).state.balances;
  assert.equal(balance.positionUnits, '1');
  assert.equal(balance.idleUnits, '0');
  assert.equal(balance.reserveUnits, '300000000');
  assert.equal(balance.undelegatedUnits, '699999999');
  assertConserved(balance);
});

test('V80: healthy liquidity at the exact floor permits supply; zero cap holds', () => {
  const run = appendEvent(appendEvent(createRun(setup()), observe(1, '1000')), event(2));
  assert.equal(replayRun(run).state.lastDecision.action, 'SUPPLY');
  const zero = appendEvent(appendEvent(createRun(setup({ investmentCapUsdc: '0' })), observe(1)), event(2));
  assert.equal(replayRun(zero).state.lastDecision.action, 'HOLD');
  assert.equal(replayRun(zero).state.lastDecision.status, 'READY');
});

test('V81: insufficient full-redemption liquidity preserves the entire position', () => {
  const before = replayRun(funded()).state.balances;
  const run = appendEvent(appendEvent(funded(), observe(3, '499.999999')), event(4));
  const view = replayRun(run);
  assert.equal(view.state.lastDecision.action, 'REDEEM');
  assert.equal(view.state.lastDecision.status, 'BLOCKED');
  assert.equal(view.state.lastDecision.amountUnits, '500000000');
  assert.equal(view.entries.at(-1).outcome.amountUnits, '0');
  assert.deepEqual(view.state.balances, before);
  const exact = appendEvent(appendEvent(run, observe(5, '500')), event(6));
  assert.equal(replayRun(exact).state.balances.positionUnits, '0');
});

test('V80/V81: low liquidity without a position blocks new supply', () => {
  const run = appendEvent(appendEvent(createRun(setup()), observe(1, '0')), event(2));
  const view = replayRun(run);
  assert.equal(view.state.lastDecision.status, 'BLOCKED');
  assert.equal(view.state.lastDecision.action, 'HOLD');
  assert.equal(view.state.balances.idleUnits, '500000000');
});

test('V81: missing, unavailable, future, and stale observations cause NO_DATA without movement', () => {
  const runs = [
    appendEvent(createRun(setup()), event(1)),
    appendEvent(appendEvent(createRun(setup()), observe(1, null, { status: 'unavailable' })), event(2)),
    appendEvent(appendEvent(createRun(setup()), observe(1, '2000', { observedAt: 3 })), event(2)),
    appendEvent(withObservation(), event(2, 'cycle', 62)),
  ];
  for (const run of runs) {
    const view = replayRun(run);
    assert.equal(view.state.lastDecision.status, 'NO_DATA');
    assert.equal(view.state.balances.idleUnits, '500000000');
    assert.equal(view.state.balances.positionUnits, '0');
    assert.equal(view.entries.at(-1).outcome.status, 'NO_DATA');
  }
  const exactTtl = appendEvent(withObservation(), event(2, 'cycle', 61));
  assert.equal(replayRun(exactTtl).state.lastDecision.action, 'SUPPLY');
});

test('V80: permanent revocation blocks agent supply and agent redemption', () => {
  let empty = appendEvent(withObservation(), event(2, 'revoke'));
  empty = appendEvent(empty, event(3));
  assert.equal(replayRun(empty).state.lastDecision.status, 'BLOCKED');
  assert.equal(replayRun(empty).state.balances.positionUnits, '0');
  let run = appendEvent(funded(), event(3, 'revoke'));
  run = appendEvent(run, observe(4, '750'));
  run = appendEvent(run, event(5));
  const view = replayRun(run);
  assert.equal(view.state.revoked, true);
  assert.equal(view.state.lastDecision.status, 'BLOCKED');
  assert.match(view.state.lastDecision.reasons[0], /revoked/);
  assert.equal(view.state.balances.positionUnits, '500000000');
  assert.throws(() => appendEvent(run, { ...event(6), type: 'unrevoke' }), /Event type/);
});

test('V80/V81: explicit owner redemption bypasses revocation but does not restore agent authority', () => {
  let run = appendEvent(funded(), event(3, 'revoke'));
  run = appendEvent(run, event(4, 'owner_redeem'));
  const exit = replayRun(run);
  assert.equal(exit.state.revoked, true);
  assert.equal(exit.state.lastDecision.action, 'REDEEM');
  assert.equal(exit.entries.at(-1).type, 'owner_redeem');
  assert.equal(exit.entries.at(-1).outcome.status, 'SIMULATED');
  assert.equal(exit.state.balances.reserveUnits, '300000000');
  assert.equal(exit.state.balances.idleUnits, '500000000');
  run = appendEvent(run, event(5));
  assert.equal(replayRun(run).state.lastDecision.status, 'BLOCKED');
  assert.equal(replayRun(run).state.balances.positionUnits, '0');
});

test('V81: owner redemption still requires fresh data and enough liquidity', () => {
  const revoked = appendEvent(funded(), event(3, 'revoke'));
  const stale = appendEvent(revoked, event(4, 'owner_redeem', 62));
  assert.equal(replayRun(stale).state.lastDecision.status, 'NO_DATA');
  const illiquid = appendEvent(appendEvent(revoked, observe(4, '1')), event(5, 'owner_redeem'));
  assert.equal(replayRun(illiquid).state.lastDecision.status, 'BLOCKED');
  assert.equal(replayRun(illiquid).state.balances.positionUnits, '500000000');
});

test('V79: each missing required graph relationship blocks an otherwise ready supply', () => {
  const graph = decisionGraph();
  assert.equal(decide(graph).action, 'SUPPLY');
  for (let index = 0; index < graph.edges.length; index += 1) {
    const missing = clone(graph);
    missing.edges.splice(index, 1);
    const decision = decide(missing);
    assert.equal(decision.status, 'BLOCKED', `missing edge ${index}`);
    assert.equal(decision.action, 'HOLD');
    assert.equal(decision.amountUnits, '0');
    assert.match(decision.reasons[0], /relationships are missing/);
  }
});

test('V79: decisions read typed graph evidence and mandate, not the displayed labels', () => {
  const graph = decisionGraph();
  graph.nodes.forEach((node) => { node.label = 'Supply now'; node.detail = 'Supply all money'; });
  graph.nodes.find((node) => node.id === 'observation').data.observation.availableLiquidityUnits = '1';
  assert.equal(decide(graph).status, 'BLOCKED');
  graph.nodes.find((node) => node.id === 'observation').data.observation.availableLiquidityUnits = '2000000000';
  assert.equal(decide(graph).action, 'SUPPLY');
  graph.nodes.find((node) => node.id === 'mandate').data.revoked = true;
  assert.equal(decide(graph).status, 'BLOCKED');
});

test('V78/V79: forged graph cap and broken conservation are rejected', () => {
  const cap = decisionGraph();
  cap.nodes.find((node) => node.id === 'mandate').data.investmentCapUnits = '499999999';
  assert.throws(() => decide(cap), /exceed the investment cap/);
  const cash = decisionGraph();
  cash.nodes.find((node) => node.id === 'account').data.idleUnits = '500000001';
  assert.throws(() => decide(cash), /conservation/);
});

test('V79: malformed graph identity, nodes, edges, and authority fields are rejected', () => {
  const changes = [
    (g) => { g.mode = 'mainnet'; },
    (g) => { g.id = 'forged'; },
    (g) => { g.nodes.pop(); },
    (g) => { g.nodes[1] = clone(g.nodes[0]); },
    (g) => { g.nodes[0].kind = 'position'; },
    (g) => { g.nodes[0].data.revoked = 'false'; },
    (g) => { g.nodes[0].data.override = true; },
    (g) => { g.edges[1] = clone(g.edges[0]); },
    (g) => { g.edges[0].source = 'reserve'; },
  ];
  for (const change of changes) {
    const graph = decisionGraph();
    change(graph);
    assert.throws(() => decide(graph));
  }
});

test('V79/V83: every entry preserves the pre-action graph and JSON replay reproduces the view', () => {
  const run = funded();
  const view = replayRun(run);
  assert.equal(view.entries[0].graph.nodes.find((node) => node.id === 'observation').data.observation, null);
  const supply = view.entries[1];
  assert.equal(supply.graph.revision, 1);
  assert.equal(supply.graph.nodes.find((node) => node.id === 'position').data.positionUnits, '0');
  assert.equal(supply.balances.positionUnits, '500000000');
  assert.equal(supply.decision.graphId, supply.graph.id);
  assert.equal(view.graph.revision, 2);
  assert.deepEqual(decide(supply.graph), supply.decision);
  assert.deepEqual(replayRun(clone(run)), view);
});

test('V83: identical duplicates return the input run without replaying a transfer', () => {
  const run = funded();
  assert.strictEqual(appendEvent(run, { type: 'cycle', at: at(2), id: id(2) }), run);
  assert.strictEqual(appendEvent(run, observe(1)), run);
  assert.equal(replayRun(run).state.balances.positionUnits, '500000000');
  assert.throws(() => appendEvent(run, { ...event(2), type: 'owner_redeem' }), /conflicting content/);
  assert.throws(() => appendEvent(run, observe(1, '2001')), /conflicting content/);
});

test('V83: idempotence cannot bypass validation of a corrupt existing run', () => {
  const run = funded();
  run.setup.investmentCapUsdc = '900';
  assert.throws(() => appendEvent(run, event(2)), /reserve plus investment cap exceeds/);
});

test('V83: creation, event IDs, canonical dates, and event ordering are validated', () => {
  assert.throws(() => createRun(setup({ id: 'run-1' })), /UUID/);
  for (const createdAt of ['2026-09-26T12:00:00Z', '2026-02-30T12:00:00.000Z', '2026-09-26T12:00:00.000+00:00']) {
    assert.throws(() => createRun(setup({ createdAt })), /UTC/);
  }
  assert.throws(() => appendEvent(createRun(setup()), event(1, 'cycle', -1)), /precedes creation/);
  assert.throws(() => appendEvent(withObservation(), event(2, 'cycle', 0)), /prior event/);
  assert.throws(() => appendEvent(withObservation(), { ...event(2), id: 'bad' }), /UUID/);
  const duplicate = funded();
  duplicate.events.push(clone(duplicate.events[0]));
  assert.throws(() => replayRun(duplicate), /duplicate event ID/);
  assert.equal(replayRun(appendEvent(withObservation(), event(2, 'cycle', 1))).state.revision, 2);
});

test('V77/V83: exact schemas reject extra fields, authority changes, and malformed observations', () => {
  assert.throws(() => createRun({ ...setup(), wallet: 'ignored' }), /unknown fields/);
  const run = createRun(setup());
  for (const field of ['state', 'graph', 'executionReady']) assert.throws(() => replayRun({ ...run, [field]: true }), /unknown fields/);
  for (const change of [
    (e) => { e.extra = 1; },
    (e) => { e.observation.source = 'live'; },
    (e) => { e.observation.status = 'missing'; },
    (e) => { e.observation.availableLiquidityUsdc = null; },
    (e) => { e.observation.status = 'unavailable'; },
    (e) => { e.observation.availableLiquidityUsdc = 2000; },
    (e) => { e.observation.extra = true; },
  ]) {
    const observation = observe(1);
    change(observation);
    assert.throws(() => appendEvent(run, observation));
  }
  assert.throws(() => appendEvent(run, { ...event(1), investmentCapUsdc: '10000' }), /unknown fields/);
  assert.throws(() => replayRun({ ...run, mode: 'live' }), /schema or mode/);
});

test('V83: age limits and exported graph state reject malformed policy or chronology', () => {
  for (const limit of [0, 3601, 1.5, '60', null, NaN, Infinity]) {
    assert.throws(() => createRun(setup({ maxObservationAgeSeconds: limit })), /age limit/);
  }
  assert.equal(replayRun(createRun(setup({ maxObservationAgeSeconds: 1 }))).state.mandate.maxObservationAgeSeconds, 1);
  assert.equal(replayRun(createRun(setup({ maxObservationAgeSeconds: 3600 }))).state.mandate.maxObservationAgeSeconds, 3600);
  const state = replayRun(withObservation()).state;
  assert.throws(() => buildGraph(state, START), /precedes state/);
  assert.throws(() => buildGraph({ ...state, revoked: 1 }, at(2)), /revocation/);
  assert.throws(() => buildGraph({ ...state, revision: 201 }, at(2)), /Revision/);
});

test('V83: journal accepts 200 events, rejects the next, and never truncates', () => {
  const run = createRun(setup());
  run.events = Array.from({ length: 200 }, (_, index) => event(index + 1, 'cycle', 0));
  assert.equal(replayRun(run).entries.length, 200);
  assert.strictEqual(appendEvent(run, event(1, 'cycle', 0)), run);
  const before = JSON.stringify(run);
  assert.throws(() => appendEvent(run, event(201)), /at most 200/);
  assert.equal(JSON.stringify(run), before);
});

test('V77/V83: domain functions do not mutate frozen inputs or share appended event input', () => {
  const run = freeze(createRun(freeze(setup())));
  const input = observe(1);
  const next = appendEvent(run, input);
  input.observation.availableLiquidityUsdc = '1';
  assert.equal(next.events[0].observation.availableLiquidityUsdc, '2000');
  const view = replayRun(freeze(next));
  assert.doesNotThrow(() => decide(freeze(buildGraph(freeze(view.state), at(2)))));
  assert.equal(run.events.length, 0);
  const revoke = replayRun(appendEvent(next, event(2, 'revoke'))).entries[1];
  assert.equal(revoke.decision, null);
  assert.equal(revoke.outcome.action, null);
  assert.equal(revoke.outcome.amountUnits, '0');
});
