import { simulateAllocation } from './yield-domain.mjs';

export const YIELD_ENDPOINTS = Object.freeze({
  pools: 'https://yields.llama.fi/pools',
  protocols: 'https://api.llama.fi/protocols',
});
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAX_POOLS_BYTES = 16 * 1024 * 1024;
const MAX_PROTOCOLS_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60000;

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}
function canonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function percentToBps(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) return null;
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text)) return null;
  const [wholeText, fractionalText = ''] = text.split('.');
  let bps = BigInt(wholeText) * 100n + BigInt((fractionalText + '00').slice(0, 2));
  if ((fractionalText[2] ?? '0') >= '5') bps += 1n;
  return bps <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bps) : null;
}
function usdToCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER / 100) return null;
  return String(Math.round(value * 100));
}
function increment(counts, reason) { counts[reason] = (counts[reason] || 0) + 1; }

export function normalizeYieldCatalog({ pools, protocols, retrievedAt }) {
  if (!canonicalTime(retrievedAt)) throw new Error('Retrieval time must be a canonical UTC timestamp.');
  if (!Array.isArray(pools) || !Array.isArray(protocols)) throw new Error('Provider catalogs must be arrays.');
  const protocolBySlug = new Map();
  for (const protocol of protocols) {
    if (!isRecord(protocol) || typeof protocol.slug !== 'string' || typeof protocol.category !== 'string' || !Array.isArray(protocol.chains)) continue;
    if (protocol.chains.includes('Solana')) protocolBySlug.set(protocol.slug, { name: typeof protocol.name === 'string' ? protocol.name : protocol.slug, category: protocol.category });
  }
  const excludedCounts = {}, seen = new Set(), opportunities = [];
  for (const row of pools) {
    if (!isRecord(row)) { increment(excludedCounts, 'INVALID_ROW'); continue; }
    const reasons = [];
    if (row.chain !== 'Solana') reasons.push('WRONG_CHAIN');
    const protocol = typeof row.project === 'string' ? protocolBySlug.get(row.project) : null;
    if (!protocol) reasons.push('UNKNOWN_PROTOCOL');
    else if (protocol.category !== 'Lending') reasons.push('NOT_LENDING');
    if (!Array.isArray(row.underlyingTokens) || !row.underlyingTokens.includes(SOLANA_USDC_MINT)) reasons.push('WRONG_ASSET');
    if (row.stablecoin !== true) reasons.push('NOT_STABLECOIN');
    if (row.exposure !== 'single' || row.ilRisk !== 'no') reasons.push('MULTI_ASSET_OR_IL');
    if (row.outlier !== false) reasons.push('OUTLIER');
    if (typeof row.pool !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/.test(row.pool)) reasons.push('INVALID_POOL_ID');
    const baseApyBps = percentToBps(row.apyBase);
    const apyRewardBps = row.apyReward === null ? null : percentToBps(row.apyReward);
    const reportedApyBps = percentToBps(row.apy);
    const tvlUsdCents = usdToCents(row.tvlUsd);
    if (baseApyBps === null || reportedApyBps === null || (row.apyReward !== null && apyRewardBps === null) || tvlUsdCents === null) reasons.push('INVALID_METRIC');
    if (typeof row.symbol !== 'string' || !row.symbol.toUpperCase().includes('USDC')) reasons.push('INVALID_SYMBOL');
    if (reasons.length) { for (const reason of new Set(reasons)) increment(excludedCounts, reason); continue; }
    if (seen.has(row.pool)) { increment(excludedCounts, 'DUPLICATE_POOL_ID'); continue; }
    seen.add(row.pool);
    opportunities.push({
      provider: 'defillama', project: row.project, protocolName: protocol.name, category: protocol.category,
      poolId: row.pool, poolMeta: typeof row.poolMeta === 'string' ? row.poolMeta.slice(0, 160) : null,
      chain: 'Solana', assetMint: SOLANA_USDC_MINT, symbol: row.symbol,
      baseApyBps, apyRewardBps, reportedApyBps, tvlUsdCents,
      stablecoin: true, exposure: 'single', ilRisk: 'no', outlier: false,
      retrievedAt, providerAsOf: null, freshness: 'SOURCE_TIME_UNKNOWN',
    });
  }
  opportunities.sort((a, b) => a.poolId.localeCompare(b.poolId));
  const status = opportunities.length ? 'READY' : 'NO_DATA';
  return {
    status, provider: 'defillama', retrievedAt, providerAsOf: null, executionReady: false,
    coverage: { indexedPoolRows: pools.length, solanaLendingProjects: [...protocolBySlug.values()].filter(item => item.category === 'Lending').length, eligibleOpportunities: opportunities.length, excludedCounts, catalogCompleteness: 'PROVIDER_INDEXED_ONLY' },
    opportunities,
  };
}

async function responseJson(fetchImpl, url, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok || response.redirected || !response.body?.getReader) throw new Error('Provider response is unavailable.');
    const reader = response.body.getReader(), chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('Provider response exceeds the size limit.'); }
      chunks.push(Buffer.from(value));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

export function createYieldService({ fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), clock = () => Date.now(), cacheTtlMs = CACHE_TTL_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  let cached = null, cachedUntil = 0, pending = null;
  async function getOpportunities() {
    const current = clock();
    if (cached && current < cachedUntil) return structuredClone(cached);
    if (pending) return structuredClone(await pending);
    pending = (async () => {
      const retrievedAt = now();
      try {
        const [poolResponse, protocolResponse] = await Promise.all([
          responseJson(fetchImpl, YIELD_ENDPOINTS.pools, MAX_POOLS_BYTES),
          responseJson(fetchImpl, YIELD_ENDPOINTS.protocols, MAX_PROTOCOLS_BYTES),
        ]);
        const pools = Array.isArray(poolResponse?.data) ? poolResponse.data : null;
        if (!pools || !Array.isArray(protocolResponse)) throw new Error('Provider schema changed.');
        const result = normalizeYieldCatalog({ pools, protocols: protocolResponse, retrievedAt });
        if (result.status === 'READY') { cached = result; cachedUntil = clock() + cacheTtlMs; }
        return result;
      } catch {
        return { status: 'NO_DATA', provider: 'defillama', retrievedAt, providerAsOf: null, executionReady: false,
          coverage: { indexedPoolRows: 0, solanaLendingProjects: 0, eligibleOpportunities: 0, excludedCounts: { SOURCE_UNAVAILABLE: 1 }, catalogCompleteness: 'PROVIDER_UNAVAILABLE' }, opportunities: [] };
      } finally { pending = null; }
    })();
    return structuredClone(await pending);
  }
  async function simulate(input) {
    const catalog = await getOpportunities();
    return simulateAllocation({ ...input, opportunities: catalog.status === 'READY' ? catalog.opportunities : [], sourceSnapshot: catalog });
  }
  return { getOpportunities, simulate };
}
