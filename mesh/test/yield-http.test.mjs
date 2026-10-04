import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createApi, parseTokenHashes } from '../http.mjs';
import { createYieldService, YIELD_ENDPOINTS } from '../yield-data.mjs';

const token = 'test-yield-agent-token-00000000000000000000';
const hash = createHash('sha256').update(token).digest('hex');
const tokenHashes = parseTokenHashes(JSON.stringify({ [hash]: 'yield_owner' }));
const retrievedAt = '2026-10-03T12:00:00.000Z';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const protocols = [
  { slug: 'kamino-lend', name: 'Kamino Lend', category: 'Lending', chains: ['Solana'] },
  { slug: 'save', name: 'Save', category: 'Lending', chains: ['Solana'] },
];
const pool = (id, project, apyBase, tvlUsd) => ({
  chain: 'Solana', project, symbol: 'USDC', underlyingTokens: [usdc], apy: apyBase,
  apyBase, apyReward: null, tvlUsd, stablecoin: true, exposure: 'single', ilRisk: 'no',
  outlier: false, pool: id, poolMeta: 'USDC lending',
});
const pools = { data: [pool('pool-kamino', 'kamino-lend', 6.4, 6000000), pool('pool-save', 'save', 4.5, 2000000)] };

async function serve(t, yieldService, options = {}) {
  const server = createApi({ store: {}, yieldService, tokenHashes, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port;
}

function service() {
  return createYieldService({
    now: () => retrievedAt,
    fetchImpl: async url => new Response(JSON.stringify(url === YIELD_ENDPOINTS.pools ? pools : protocols), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
}

test('V128-V132: authenticated chat client gets real-shaped opportunities and simulation-only flow receipt', async t => {
  const base = await serve(t, service());
  const headers = { authorization: 'Bearer ' + token };
  const catalogResponse = await fetch(base + '/v1/yield/opportunities', { headers });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.status, 'READY');
  assert.equal(catalog.opportunities.length, 2);
  assert.equal(catalog.executionReady, false);

  const simulationResponse = await fetch(base + '/v1/yield/simulations', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(), simulatedAt: retrievedAt,
      portfolio: { totalUnits: '1000000000', reserveUnits: '100000000', undelegatedUnits: '0', idleUnits: '900000000', positions: [] },
      policy: { investmentCapUnits: '900000000', maxVenueConcentrationBps: 5000, maxVenues: 2 },
    }),
  });
  assert.equal(simulationResponse.status, 200);
  const result = await simulationResponse.json();
  assert.equal(result.plan.status, 'SIMULATED');
  assert.equal(result.plan.executionReady, false);
  assert.deepEqual(result.plan.allocations.map(x => x.poolId), ['pool-kamino', 'pool-save']);
  assert.deepEqual(result.plan.allocations.map(x => x.units), ['450000000', '450000000']);
  assert.deepEqual(result.plan.flows.map(x => [x.type, x.from.kind, x.to.poolId]), [
    ['SUPPLY', 'idle', 'pool-kamino'], ['SUPPLY', 'idle', 'pool-save'],
  ]);
  assert.equal(result.plan.after.totalUnits, '1000000000');
  assert.equal(result.plan.after.reserveUnits, '100000000');
  assert.equal(result.plan.after.idleUnits, '0');
});

test('V129,V132: unauthorized agent cannot read yield data or simulate funds', async t => {
  const base = await serve(t, service());
  const response = await fetch(base + '/v1/yield/opportunities');
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('V130: invalid simulation request is rejected without a portfolio receipt', async t => {
  const base = await serve(t, service());
  const response = await fetch(base + '/v1/yield/simulations', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), portfolio: { totalUnits: '1000000' } }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'INVALID_INPUT');
});
test('V135: verified Supabase user IDs scope yield request limits; invalid sessions never reach the provider', async t => {
  const userA = 'cf6c5a09-7d4f-45a3-9498-1fb2d6cd98a1';
  const userB = '9f2c4a45-1758-4c85-8a48-c5bcacbdd800';
  const tokenA = 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(500) + '.sig';
  const tokenB = 'eyJhbGciOiJIUzI1NiJ9.' + 'b'.repeat(500) + '.sig';
  const invalid = 'eyJhbGciOiJIUzI1NiJ9.' + 'c'.repeat(500) + '.sig';
  const owners = new Map([[tokenA, userA], [tokenB, userB]]);
  let reads = 0;
  const yieldService = { getOpportunities: async () => { reads += 1; return { status: 'NO_DATA', opportunities: [] }; } };
  const base = await serve(t, yieldService, { verifySupabaseToken: async token => owners.get(token) ?? null, rateMaxPerOwner: 1 });
  const get = token => fetch(base + '/v1/yield/opportunities', { headers: { authorization: 'Bearer ' + token } });

  assert.equal((await get(tokenA)).status, 200, 'long Supabase access token reaches user-scoped endpoint');
  const limited = await get(tokenA);
  assert.equal(limited.status, 429, 'same verified user hits its own rate limit');
  assert.equal((await get(tokenB)).status, 200, 'second verified user has separate rate allowance');
  assert.equal((await get(invalid)).status, 401, 'unverified token is rejected');
  assert.equal(reads, 2, 'invalid user never reaches yield provider');
});

test('V135: missing Auth config or verifier outage fails closed with no provider read', async t => {
  let reads = 0;
  const yieldService = { getOpportunities: async () => { reads += 1; return { status: 'NO_DATA', opportunities: [] }; } };
  const base = await serve(t, yieldService);
  const token = 'eyJhbGciOiJIUzI1NiJ9.' + 'd'.repeat(500) + '.sig';
  const headers = { authorization: 'Bearer ' + token };
  const missing = await fetch(base + '/v1/yield/opportunities', { headers });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, 'AUTH_UNAVAILABLE');
  assert.equal(reads, 0);

  const outageBase = await serve(t, yieldService, { verifySupabaseToken: async () => { throw new Error('private upstream detail'); } });
  const outage = await fetch(outageBase + '/v1/yield/opportunities', { headers });
  assert.equal(outage.status, 503);
  assert.equal((await outage.json()).error.message, 'User authentication is unavailable.');
  assert.equal(reads, 0);
});
test('V139: Auth verification throttling stays a 429 and never reaches yield service', async t => {
  let reads = 0;
  const yieldService = { getOpportunities: async () => { reads += 1; return { status: 'NO_DATA', opportunities: [] }; } };
  const base = await serve(t, yieldService, { verifySupabaseToken: async () => { const error = new Error('SUPABASE_AUTH_RATE_LIMITED'); error.code = 'SUPABASE_AUTH_RATE_LIMITED'; error.retryAfter = 17; throw error; } });
  const token = 'eyJhbGciOiJIUzI1NiJ9.' + 'e'.repeat(500) + '.sig';
  const response = await fetch(base + '/v1/yield/opportunities', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '17');
  assert.equal((await response.json()).error.code, 'RATE_LIMITED');
  assert.equal(reads, 0);
});
