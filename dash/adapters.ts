import type { FieldCapture, StockField } from '../stocks/stocks.ts';

// Per-asset dashboard configuration. assetId is the Solana token mint.
export interface DashAssetConfig {
  assetId: string;
  underlying: string;
  targetWeightBps: number;
  priceScale: number;
  quantityScale: number;
  minLiquidity: string;
  maxWeightBps: number;
  pyth?: { tokenizedFeedId: string; underlyingFeedId: string };
}

export interface DashConfig {
  assets: readonly DashAssetConfig[];
  coherenceCapMs: number;
  maxDislocationBps?: number;
}

export interface AssetCaptures {
  price: FieldCapture;
  liquidity: FieldCapture;
}

// A read-only live evidence source. One HTTP call yields both fields for an asset.
export interface LiveEvidenceAdapter {
  readonly sourceId: string;
  readonly adapterVersion: string;
  readonly semanticVersion: string;
  fetchAsset(asset: DashAssetConfig): Promise<AssetCaptures>;
}

const DECIMAL = /^\d+(\.\d+)?$/;

// Exact decimal-string -> integer-units string at `scale` decimals. No floating point.
export function scaleDecimalToInteger(value: string, scale: number): string {
  if (!DECIMAL.test(value)) throw new Error(`invalid decimal: ${value}`);
  const parts = value.split('.');
  const intPart = parts[0] ?? '0';
  const fracPart = parts[1] ?? '';
  const frac = `${fracPart}${'0'.repeat(scale)}`.slice(0, scale);
  const combined = `${intPart}${frac}`.replace(/^0+(?=\d)/, '');
  return combined;
}

function readDecimal(value: unknown): string | null {
  if (typeof value === 'string' && DECIMAL.test(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const text = value.toString();
    return DECIMAL.test(text) ? text : null;
  }
  return null;
}

function okCapture(field: StockField, source: LiveEvidenceAdapter, normalizedValue: string, at: string, rawBytes: string): FieldCapture {
  return {
    field,
    sourceId: source.sourceId,
    sourceRole: 'primary',
    adapterVersion: source.adapterVersion,
    semanticVersion: source.semanticVersion,
    status: 'ok',
    eventAt: at,
    capturedAt: at,
    sequence: 1,
    continuity: 'continuous',
    rawBytes,
    normalizedValue,
    equivalenceValidated: false,
    failure: null,
  };
}

function failedCapture(field: StockField, source: LiveEvidenceAdapter, at: string, reason: string, retryable: boolean): FieldCapture {
  return {
    field,
    sourceId: source.sourceId,
    sourceRole: 'primary',
    adapterVersion: source.adapterVersion,
    semanticVersion: source.semanticVersion,
    status: 'outage',
    eventAt: at,
    capturedAt: at,
    sequence: 1,
    continuity: 'gap',
    rawBytes: reason,
    normalizedValue: null,
    equivalenceValidated: false,
    failure: { retryable, retryAfterMs: retryable ? 2000 : null, reason },
  };
}

interface DexPair {
  chainId?: unknown;
  pairAddress?: unknown;
  baseToken?: { address?: unknown } | null;
  priceUsd?: unknown;
  liquidity?: { usd?: unknown } | null;
}

function baseMatches(pair: DexPair, mint: string): boolean {
  return pair.chainId === 'solana' && typeof pair.baseToken?.address === 'string' && pair.baseToken.address === mint;
}

// Keyless DEX Screener token-pairs adapter: https://docs.dexscreener.com/api/reference
// Returns aggregate pool price + liquidity for the deepest Solana pool where the mint is the base token.
export function dexScreenerAdapter(baseUrl = 'https://api.dexscreener.com'): LiveEvidenceAdapter {
  const adapter: LiveEvidenceAdapter = {
    sourceId: 'dexscreener',
    adapterVersion: 'dexscreener-token-pairs-v1',
    semanticVersion: 'usd-pool',
    async fetchAsset(asset: DashAssetConfig): Promise<AssetCaptures> {
      const fail = (at: string, reason: string, retryable: boolean): AssetCaptures => ({
        price: failedCapture('price', adapter, at, reason, retryable),
        liquidity: failedCapture('liquidity', adapter, at, reason, retryable),
      });
      try {
        const response = await fetch(`${baseUrl}/token-pairs/v1/solana/${encodeURIComponent(asset.assetId)}`, { method: 'GET', headers: { accept: 'application/json' } });
        const at = new Date().toISOString();
        if (!response.ok) return fail(at, `http ${response.status}`, response.status >= 500 || response.status === 429);
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) return fail(at, 'response was not a pair array', false);
        const pools = (body as DexPair[]).filter(pair => baseMatches(pair, asset.assetId));
        if (pools.length === 0) return fail(at, 'no indexed solana pool for mint', true);
        let deepest = pools[0]!;
        let deepestLiquidity = readDecimal(deepest.liquidity?.usd);
        for (const pool of pools) {
          const candidate = readDecimal(pool.liquidity?.usd);
          if (candidate !== null && (deepestLiquidity === null || BigInt(scaleDecimalToInteger(candidate, 0)) > BigInt(scaleDecimalToInteger(deepestLiquidity, 0)))) {
            deepest = pool;
            deepestLiquidity = candidate;
          }
        }
        const priceUsd = readDecimal(deepest.priceUsd);
        if (priceUsd === null || deepestLiquidity === null) return fail(at, 'null price or liquidity in deepest pool', true);
        const raw = JSON.stringify({ pairAddress: deepest.pairAddress, priceUsd, liquidityUsd: deepestLiquidity });
        return {
          price: okCapture('price', adapter, scaleDecimalToInteger(priceUsd, asset.priceScale), at, raw),
          liquidity: okCapture('liquidity', adapter, scaleDecimalToInteger(deepestLiquidity, asset.quantityScale), at, raw),
        };
      } catch (error) {
        return fail(new Date().toISOString(), `fetch failed: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
  };
  return adapter;
}

// Deterministic offline adapter for tests: fixed prices/liquidity, no network.
export function fixtureAdapter(values: Readonly<Record<string, { price: string; liquidity: string; at: string }>>): LiveEvidenceAdapter {
  const adapter: LiveEvidenceAdapter = {
    sourceId: 'fixture',
    adapterVersion: 'fixture-v1',
    semanticVersion: 'test',
    async fetchAsset(asset: DashAssetConfig): Promise<AssetCaptures> {
      const value = values[asset.assetId];
      if (value === undefined) {
        const at = new Date().toISOString();
        return { price: failedCapture('price', adapter, at, 'no fixture', false), liquidity: failedCapture('liquidity', adapter, at, 'no fixture', false) };
      }
      const raw = JSON.stringify({ assetId: asset.assetId, price: value.price, liquidity: value.liquidity });
      return {
        price: okCapture('price', adapter, scaleDecimalToInteger(value.price, asset.priceScale), value.at, raw),
        liquidity: okCapture('liquidity', adapter, scaleDecimalToInteger(value.liquidity, asset.quantityScale), value.at, raw),
      };
    },
  };
  return adapter;
}
