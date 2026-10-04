import test from 'node:test';
import assert from 'node:assert/strict';
import { createYieldService, normalizeYieldCatalog } from '../yield-data.mjs';

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

test('V124: catalog normalization keeps only native-USDC single-asset Solana lending opportunities', () => {
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
  assert.ok(result.coverage.excludedCounts.WRONG_CHAIN > 0);
  assert.ok(result.coverage.excludedCounts.NOT_LENDING > 0);
  assert.ok(result.coverage.excludedCounts.MULTI_ASSET_OR_IL > 0);
  assert.ok(result.coverage.excludedCounts.OUTLIER > 0);
  assert.ok(result.coverage.excludedCounts.UNKNOWN_PROTOCOL > 0);
  assert.ok(result.coverage.excludedCounts.WRONG_ASSET > 0);
});

test('V130: provider failure returns NO_DATA rather than a fallback opportunity', async () => {
  const service = createYieldService({
    now: () => retrievedAt,
    fetchImpl: async () => new Response('upstream unavailable', { status: 503 }),
  });
  const result = await service.getOpportunities();
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.opportunities.length, 0);
  assert.equal(result.retrievedAt, retrievedAt);
  assert.equal(result.executionReady, false);
});

 test('V125: missing market time remains unknown while retrieval time is retained', () => {
  const result = normalizeYieldCatalog({ pools: [row()], protocols, retrievedAt });
  assert.equal(result.opportunities[0].providerAsOf, null);
  assert.equal(result.opportunities[0].retrievedAt, retrievedAt);
  assert.equal(result.opportunities[0].freshness, 'SOURCE_TIME_UNKNOWN');
});
