import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateAllocation } from '../yield-domain.mjs';

const at = '2026-10-03T12:00:00.000Z';
const opportunity = (poolId, baseApyBps, tvlUsdCents = 100000000, project = 'kamino-lend') => ({
  provider: 'defillama', project, poolId, chain: 'Solana',
  assetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  baseApyBps, apyRewardBps: null, tvlUsdCents: String(tvlUsdCents), retrievedAt: at,
});
const input = overrides => ({
  requestId: '11111111-1111-4111-8111-111111111111',
  simulatedAt: at,
  portfolio: {
    totalUnits: '1000000000', reserveUnits: '100000000', undelegatedUnits: '0',
    idleUnits: '400000000',
    positions: [{ poolId: 'old-pool', units: '500000000' }],
  },
  policy: { investmentCapUnits: '900000000', maxVenueConcentrationBps: 5000, maxVenues: 2 },
  sourceSnapshot: { provider: 'defillama', retrievedAt: at, providerAsOf: null },
  opportunities: [
    opportunity('pool-b', 500, 100000000, 'solend'), opportunity('pool-a', 640), opportunity('pool-c', 450, 100000000, 'save'),
  ],
  ...overrides,
});

test('V126-V129,V133: allocator ranks deterministically and simulates source-to-destination movements', () => {
  const plan = simulateAllocation(input());
  assert.equal(plan.status, 'SIMULATED');
  assert.equal(plan.executionReady, false);
  assert.deepEqual(plan.allocations.map(x => x.poolId), ['pool-a', 'pool-b']);
  assert.deepEqual(plan.allocations.map(x => x.units), ['450000000', '450000000']);
  assert.deepEqual(plan.flows.map(x => [x.type, x.from.poolId ?? x.from.kind, x.to.poolId ?? x.to.kind, x.amountUnits]), [
    ['REDEEM', 'old-pool', 'idle', '500000000'],
    ['SUPPLY', 'idle', 'pool-a', '450000000'],
    ['SUPPLY', 'idle', 'pool-b', '450000000'],
  ]);
  assert.equal(plan.before.totalUnits, '1000000000');
  assert.equal(plan.after.totalUnits, '1000000000');
  assert.equal(plan.after.reserveUnits, '100000000');
  assert.equal(plan.after.idleUnits, '0');
  assert.equal(plan.after.positions.reduce((sum, x) => sum + BigInt(x.units), 0n).toString(), '900000000');
  assert.equal(plan.costs.status, 'UNKNOWN');
});

test('V125: equal base rates use TVL then pool ID as stable tie breakers', () => {
  const a = opportunity('pool-b', 500, 200000000);
  const b = opportunity('pool-a', 500, 200000000);
  const result = simulateAllocation(input({ portfolio: { totalUnits: '100000000', reserveUnits: '0', undelegatedUnits: '0', idleUnits: '100000000', positions: [] }, policy: { investmentCapUnits: '100000000', maxVenueConcentrationBps: 10000, maxVenues: 1 }, opportunities: [a, b] }));
  assert.equal(result.allocations[0].poolId, 'pool-a');
});

test('V127: missing venue limits block allocation and leave the portfolio unchanged', () => {
  const source = input({ policy: { investmentCapUnits: '900000000' } });
  const result = simulateAllocation(source);
  assert.equal(result.status, 'REVIEW');
  assert.deepEqual(result.flows, []);
  assert.equal(result.after.totalUnits, '1000000000');
  assert.equal(result.after.positions[0].units, '500000000');
});

test('V123,V130: no eligible opportunities returns NO_DATA with no simulated movement', () => {
  const result = simulateAllocation(input({ opportunities: [] }));
  assert.equal(result.status, 'NO_DATA');
  assert.deepEqual(result.flows, []);
  assert.equal(result.after.totalUnits, result.before.totalUnits);
});

test('V127: a portfolio with a non-conserving ledger is rejected', () => {
  assert.throws(() => simulateAllocation(input({ portfolio: { totalUnits: '1000000000', reserveUnits: '100000000', undelegatedUnits: '0', idleUnits: '400000000', positions: [] } })), /conservation/i);
});
test('V140: concentration and venue count group pools by provider project', () => {
  const plan = simulateAllocation(input({ opportunities: [
    opportunity('pool-a', 640, 100000000, 'kamino-lend'),
    opportunity('pool-b', 500, 100000000, 'kamino-lend'),
    opportunity('pool-c', 450, 100000000, 'save'),
  ] }));
  assert.deepEqual(plan.allocations.map(item => [item.poolId, item.project, item.units]), [
    ['pool-a', 'kamino-lend', '450000000'],
    ['pool-c', 'save', '450000000'],
  ]);
  assert.equal(plan.after.positions.some(position => position.poolId === 'pool-b'), false);
  assert.throws(() => simulateAllocation(input({ opportunities: [{ ...opportunity('bad-pool', 500), project: '' }] })), /project/i);
});
