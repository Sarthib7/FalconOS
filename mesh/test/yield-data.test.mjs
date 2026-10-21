import test from 'node:test';
import assert from 'node:assert/strict';
import { createYieldService, normalizeYieldCatalog, YIELD_ENDPOINTS } from '../yield-data.mjs';

const retrievedAt = '2026-10-03T12:00:00.000Z';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const protocols = [
  { slug: 'kamino-lend', name: 'Kamino Lend', category: 'Lending', chains: ['Solana'] },
  { slug: 'save', name: 'Save', category: 'Lending', chains: ['Solana'] },
  { slug: 'raydium-amm', name: 'Raydium', category: 'Dexes', chains: ['Solana'] },
  { slug: 'kamino-evm', name: 'Kamino EVM', category: 'Lending', chains: ['Ethereum'] },
];
const row = (overrides = {}) => ({
  chain: 'Solana', project: 'kamino-lend', symbol: 'USDC',
  underlyingTokens: [usdc], apy: 4.5, apyBase: 4.5, apyReward: null, tvlUsd: 1000000,
  stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false,
  pool: '11111111-1111-4111-8111-111111111111', poolMeta: 'USDC lending reserve',
  ...overrides,
});

test('V124/V154: eligible and excluded provider-indexed opportunities retain mainnet-only context', () => {
  const result = normalizeYieldCatalog({
    pools: [
      row(),
      row({ pool: '22222222-2222-4222-8222-222222222222', project: 'raydium-amm', symbol: 'USDC-SOL', underlyingTokens: [usdc, 'So11111111111111111111111111111111111111112'], exposure: 'multi', ilRisk: 'yes' }),
      row({ pool: '33333333-3333-4333-8333-333333333333', chain: 'Ethereum' }),
      row({ pool: '44444444-4444-4444-8444-444444444444', project: 'save', outlier: true }),
      row({ pool: '55555555-5555-4555-8555-555555555555', project: 'unknown-project' }),
      row({ pool: '66666666-6666-4666-8666-666666666666', underlyingTokens: ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'] }),
    ],
    protocols,
    retrievedAt,
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].poolId, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.opportunities[0].baseApyBps, 450);
  assert.equal(result.opportunities[0].apyRewardBps, null);
  assert.equal(result.opportunities[0].assetMint, usdc);
  assert.equal(result.opportunities[0].retrievedAt, retrievedAt);
  assert.deepEqual(result.discovery, { provider: 'defillama', network: 'mainnet-beta', kind: 'provider-indexed' });
  assert.deepEqual(result.execution, { network: 'devnet', supported: false });
  const opportunity = result.opportunities[0];
  assert.equal(opportunity.network, 'mainnet-beta');
  assert.equal(opportunity.executionSupported, false);
  assert.equal(opportunity.executionNetwork, null);
  assert.equal(opportunity.discoveryOnly, true);
  assert.equal(opportunity.providerAsOf, null);
  assert.equal(opportunity.freshness, 'SOURCE_TIME_UNKNOWN');
  assert.equal(Object.hasOwn(opportunity, 'devnetApyBps'), false);
  assert.equal(Object.hasOwn(opportunity, 'availableLiquidityUnits'), false);
  assert.equal(Object.hasOwn(opportunity, 'executableLiquidityUnits'), false);
  assert.ok(result.coverage.excludedCounts.WRONG_CHAIN > 0);
  assert.ok(result.coverage.excludedCounts.NOT_LENDING > 0);
  assert.ok(result.coverage.excludedCounts.MULTI_ASSET_OR_IL > 0);
  assert.ok(result.coverage.excludedCounts.OUTLIER > 0);
  assert.ok(result.coverage.excludedCounts.UNKNOWN_PROTOCOL > 0);
  assert.ok(result.coverage.excludedCounts.WRONG_ASSET > 0);
  const excludedOnly = normalizeYieldCatalog({ pools: [row({ chain: 'Ethereum' })], protocols, retrievedAt });
  assert.equal(excludedOnly.status, 'NO_DATA');
  assert.equal(excludedOnly.coverage.excludedCounts.WRONG_CHAIN, 1);
  assert.deepEqual(excludedOnly.discovery, { provider: 'defillama', network: 'mainnet-beta', kind: 'provider-indexed' });
  assert.deepEqual(excludedOnly.execution, { network: 'devnet', supported: false });
});

test('V125: provider service uses the allocator APY, TVL, and pool-ID order', async () => {
  const pools = [
    row({ pool: '11111111-1111-4111-8111-111111111111', apy: 4, apyBase: 4, tvlUsd: 4000000 }),
    row({ pool: '22222222-2222-4222-8222-222222222222', apy: 6, apyBase: 6, tvlUsd: 1000000 }),
    row({ pool: '33333333-3333-4333-8333-333333333333', apy: 6, apyBase: 6, tvlUsd: 2000000 }),
    row({ pool: '44444444-4444-4444-8444-444444444444', apy: 6, apyBase: 6, tvlUsd: 2000000 }),
  ];
  const service = createYieldService({
    now: () => retrievedAt,
    fetchImpl: async url => url === YIELD_ENDPOINTS.pools
      ? Response.json({ data: pools })
      : Response.json(protocols),
  });
  const catalog = await service.getOpportunities();

  assert.deepEqual(catalog.opportunities.map(item => item.poolId), [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
  ]);
});
test('V154: enriched discovery rows still simulate without Devnet execution claims', async () => {
  const service = createYieldService({
    now: () => retrievedAt,
    fetchImpl: async url => url === YIELD_ENDPOINTS.pools
      ? Response.json({ data: [row()] })
      : Response.json(protocols),
  });
  const result = await service.simulate({
    requestId: '00000000-0000-4000-8000-000000000001',
    simulatedAt: retrievedAt,
    portfolio: { totalUnits: '1000', reserveUnits: '0', undelegatedUnits: '0', idleUnits: '1000', positions: [] },
    policy: { investmentCapUnits: '1000', maxVenueConcentrationBps: 10000, maxVenues: 1 },
  });
  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.executionReady, false);
  assert.equal(result.sourceSnapshot.discovery.network, 'mainnet-beta');
  assert.deepEqual(result.sourceSnapshot.execution, { network: 'devnet', supported: false });
  assert.equal(result.sourceSnapshot.opportunities[0].executionNetwork, null);
  assert.equal(result.allocations[0].baseApyBps, 450);
  assert.equal(result.costs.status, 'UNKNOWN');
});

test('V130/V154: provider failure returns NO_DATA with explicit network context and no fallback opportunity', async () => {
  const service = createYieldService({
    now: () => retrievedAt,
    fetchImpl: async () => new Response('upstream unavailable', { status: 503 }),
  });
  const result = await service.getOpportunities();
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.opportunities.length, 0);
  assert.equal(result.retrievedAt, retrievedAt);
  assert.equal(result.executionReady, false);
  assert.deepEqual(result.discovery, { provider: 'defillama', network: 'mainnet-beta', kind: 'provider-indexed' });
  assert.deepEqual(result.execution, { network: 'devnet', supported: false });
  assert.deepEqual(result.coverage.excludedCounts, { SOURCE_UNAVAILABLE: 1 });
});

 test('V125: missing market time remains unknown while retrieval time is retained', () => {
  const result = normalizeYieldCatalog({ pools: [row()], protocols, retrievedAt });
  assert.equal(result.opportunities[0].providerAsOf, null);
  assert.equal(result.opportunities[0].retrievedAt, retrievedAt);
  assert.equal(result.opportunities[0].freshness, 'SOURCE_TIME_UNKNOWN');
});
