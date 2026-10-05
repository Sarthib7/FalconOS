import test from 'node:test';
import assert from 'node:assert/strict';
import { createYieldAgentStore, parseUsdcInput, parseBpsInput } from '../dashboard/agent-store.mjs';
import { simulateAllocation } from '../../mesh/yield-domain.mjs';

function harness(initial = null) {
  let value = initial;
  const storage = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  const locks = { request: async (_name, _options, callback) => callback() };
  return { storage, locks, get raw() { return value; } };
}
const at = '2026-10-03T12:00:00.000Z';
const opportunity = { provider: 'defillama', project: 'kamino-lend', poolId: 'pool-a', chain: 'Solana', assetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', baseApyBps: 400, apyRewardBps: null, reportedApyBps: 400, tvlUsdCents: '100000000', retrievedAt: at, providerAsOf: null };
const initialPortfolio = { totalUnits: '1000000000', reserveUnits: '100000000', undelegatedUnits: '0', idleUnits: '900000000', positions: [] };
const policy = { investmentCapUnits: '900000000', maxVenueConcentrationBps: 10000, maxVenues: 1 };
const makePlan = portfolio => simulateAllocation({
  requestId: '11111111-1111-4111-8111-111111111111', simulatedAt: at,
  portfolio, policy,
  opportunities: [opportunity], sourceSnapshot: { provider: 'defillama', retrievedAt: at, providerAsOf: null },
});

test('V127,V133: saved plan applies only once to the exact local source portfolio', async () => {
  const h = harness(); const store = createYieldAgentStore({ storage: h.storage, locks: h.locks });
  const state = await store.initialize(initialPortfolio, policy); const plan = makePlan(state.portfolio);
  const next = await store.applyPlan(plan, state.revision);
  assert.equal(next.revision, 1);
  assert.equal(next.portfolio.totalUnits, initialPortfolio.totalUnits);
  assert.equal(next.portfolio.positions[0].units, '900000000');
  assert.equal(next.receipts.length, 1);
  await assert.rejects(store.applyPlan(plan, state.revision), /changed in another tab/i);
  assert.equal(store.load().revision, 1);
});
test('V127: changing policy invalidates pending plans without changing simulated balances', async () => {
  const h = harness(); const store = createYieldAgentStore({ storage: h.storage, locks: h.locks });
  const initial = await store.initialize(initialPortfolio, policy); const plan = makePlan(initial.portfolio);
  const nextPolicy = { ...policy, maxVenueConcentrationBps: 5000 };
  const updated = await store.updatePolicy(nextPolicy, initial.revision);
  assert.equal(updated.revision, 1);
  assert.deepEqual(updated.portfolio, initialPortfolio);
  await assert.rejects(store.applyPlan(plan, updated.revision), /policy is stale/i);
  assert.equal(store.load().revision, 1);
});

test('V132: a live or wallet-authorized response cannot mutate simulated storage', async () => {
  const h = harness(); const store = createYieldAgentStore({ storage: h.storage, locks: h.locks });
  const state = await store.initialize(initialPortfolio, policy); const plan = makePlan(state.portfolio);
  await assert.rejects(store.applyPlan({ ...plan, executionReady: true }, state.revision), /simulation-only/i);
  assert.equal(store.load().revision, 0);
});

test('V127: corrupt local state stays visible and is never silently reset', () => {
  const h = harness('{bad json'); const store = createYieldAgentStore({ storage: h.storage, locks: h.locks });
  assert.throws(() => store.load(), /invalid JSON/i);
  assert.equal(h.raw, '{bad json');
});
test('V126,V127: USDC and venue concentration inputs normalize exactly at their bounds', () => {
  assert.equal(parseUsdcInput('1'), '1000000');
  assert.equal(parseUsdcInput('12.345678'), '12345678');
  assert.equal(parseUsdcInput('0'), '0');
  assert.equal(parseBpsInput('50'), 5000);
  assert.equal(parseBpsInput('12.5'), 1250);
  assert.equal(parseBpsInput('100'), 10000);
  assert.equal(parseBpsInput('100.00'), 10000);
  assert.throws(() => parseBpsInput('101'), /100 percent/i);
  assert.throws(() => parseBpsInput('100.01'), /100 percent/i);
  assert.throws(() => parseUsdcInput('1.0000001'), /six fractional digits/i);
});
test('V136: authenticated users keep simulated portfolios in separate browser records', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const locks = { request: async (_name, _options, callback) => callback() };
  const userA = createYieldAgentStore({ storage, locks, key: 'falconos.yield.agent.simulation.v1:cf6c5a09-7d4f-45a3-9498-1fb2d6cd98a1' });
  const userB = createYieldAgentStore({ storage, locks, key: 'falconos.yield.agent.simulation.v1:9f2c4a45-1758-4c85-8a48-c5bcacbdd800' });
  const portfolioB = { ...initialPortfolio, totalUnits: '2000000000', reserveUnits: '300000000', idleUnits: '1700000000' };
  const policyB = { ...policy, investmentCapUnits: '1700000000' };

  await userA.initialize(initialPortfolio, policy);
  assert.equal(userB.load(), null);
  await userB.initialize(portfolioB, policyB);
  assert.equal(userA.load().portfolio.totalUnits, initialPortfolio.totalUnits);
  assert.equal(userB.load().portfolio.totalUnits, portfolioB.totalUnits);
});
