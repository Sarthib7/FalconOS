import { scaleDecimalToInteger } from './adapters.ts';
import type { FieldCapture } from '../stocks/stocks.ts';

// Pyth Hermes REST, verified against https://docs.pyth.network/price-feeds/core/fetch-price-updates
// GET /v2/updates/price/latest?ids[]=0x<feedId>  with  Authorization: Bearer $PYTH_API_KEY
// Response: { parsed: [{ id, price: { price, conf, expo, publish_time } }] }. Auth mandatory since 2026-08-26.
const HERMES_BASE = process.env.PYTH_HERMES_BASE ?? 'https://pyth.dourolabs.app/hermes';
const HEX_ID = /^0x[a-f0-9]{64}$/;
const UINT = /^\d+$/;

export interface PythAssetFeeds {
  assetId: string;
  underlying: string;
  priceScale: number;
  tokenizedFeedId: string;
  underlyingFeedId: string;
}

export interface PythUnderlyingRef {
  feedId: string;
  spot: string;
  publishTime: string;
}

export interface PythPriceResult {
  price: FieldCapture;
  underlying: PythUnderlyingRef | null;
}

interface HermesEntry {
  id: string;
  price: string;
  expo: number;
  publishTime: number;
}

// Fixed-point Pyth price (integer string + exponent) to an exact decimal string. No float.
export function pythToDecimal(price: string, expo: number): string {
  if (!UINT.test(price)) throw new Error(`invalid pyth price: ${price}`);
  if (expo === 0) return price;
  if (expo > 0) return `${price}${'0'.repeat(expo)}`;
  const shift = -expo;
  const padded = price.padStart(shift + 1, '0');
  const cut = padded.length - shift;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
}

function readEntry(value: unknown): HermesEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const object = value as Record<string, unknown>;
  const price = object.price;
  if (typeof object.id !== 'string' || typeof price !== 'object' || price === null) return null;
  const fields = price as Record<string, unknown>;
  if (typeof fields.price !== 'string' || !UINT.test(fields.price)) return null;
  if (typeof fields.expo !== 'number' || !Number.isInteger(fields.expo)) return null;
  if (typeof fields.publish_time !== 'number' || !Number.isFinite(fields.publish_time)) return null;
  return { id: `0x${object.id.toLowerCase().replace(/^0x/, '')}`, price: fields.price, expo: fields.expo, publishTime: fields.publish_time };
}

function priceCapture(normalizedValue: string, eventAt: string, capturedAt: string, raw: string): FieldCapture {
  return { field: 'price', sourceId: 'pyth', sourceRole: 'primary', adapterVersion: 'pyth-hermes-v2', semanticVersion: 'core', status: 'ok', eventAt, capturedAt, sequence: 1, continuity: 'continuous', rawBytes: raw, normalizedValue, equivalenceValidated: false, failure: null };
}

function priceFailure(at: string, reason: string, retryable: boolean): FieldCapture {
  return { field: 'price', sourceId: 'pyth', sourceRole: 'primary', adapterVersion: 'pyth-hermes-v2', semanticVersion: 'core', status: 'outage', eventAt: at, capturedAt: at, sequence: 1, continuity: 'gap', rawBytes: reason, normalizedValue: null, equivalenceValidated: false, failure: { retryable, retryAfterMs: retryable ? 3000 : null, reason } };
}

// Read-only: one GET fetches every tokenized + underlying feed. Missing key, stale publish
// time, or missing feed all yield a typed price outage so the caller can fail over to DEX Screener.
export async function fetchPythPrices(assets: readonly PythAssetFeeds[], maxAgeMs = 900_000): Promise<Map<string, PythPriceResult>> {
  const results = new Map<string, PythPriceResult>();
  const bootAt = new Date().toISOString();
  const ids = new Set<string>();
  for (const asset of assets) {
    if (!HEX_ID.test(asset.tokenizedFeedId) || !HEX_ID.test(asset.underlyingFeedId)) {
      results.set(asset.assetId, { price: priceFailure(bootAt, 'missing or malformed pyth feed id', false), underlying: null });
      continue;
    }
    ids.add(asset.tokenizedFeedId);
    ids.add(asset.underlyingFeedId);
  }
  const pending = assets.filter(asset => !results.has(asset.assetId));
  if (pending.length === 0) return results;
  const key = process.env.PYTH_API_KEY;
  if (key === undefined || key === '') {
    for (const asset of pending) results.set(asset.assetId, { price: priceFailure(bootAt, 'PYTH_API_KEY not set', true), underlying: null });
    return results;
  }
  try {
    const url = new URL(`${HERMES_BASE}/v2/updates/price/latest`);
    for (const id of ids) url.searchParams.append('ids[]', id);
    const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${key}` } });
    const at = new Date().toISOString();
    const nowMs = Date.now();
    if (!response.ok) {
      for (const asset of pending) results.set(asset.assetId, { price: priceFailure(at, `hermes http ${response.status}`, response.status >= 500 || response.status === 429), underlying: null });
      return results;
    }
    const body = (await response.json()) as { parsed?: unknown };
    const parsed = Array.isArray(body.parsed) ? body.parsed : [];
    const byId = new Map<string, HermesEntry>();
    for (const raw of parsed) {
      const entry = readEntry(raw);
      if (entry !== null) byId.set(entry.id, entry);
    }
    for (const asset of pending) {
      const underlyingEntry = byId.get(asset.underlyingFeedId);
      const underlying: PythUnderlyingRef | null = underlyingEntry === undefined ? null : { feedId: asset.underlyingFeedId, spot: pythToDecimal(underlyingEntry.price, underlyingEntry.expo), publishTime: new Date(underlyingEntry.publishTime * 1000).toISOString() };
      const tokenized = byId.get(asset.tokenizedFeedId);
      if (tokenized === undefined) {
        results.set(asset.assetId, { price: priceFailure(at, 'tokenized feed absent from hermes response', true), underlying });
        continue;
      }
      const ageMs = nowMs - tokenized.publishTime * 1000;
      if (ageMs > maxAgeMs) {
        results.set(asset.assetId, { price: priceFailure(at, `stale pyth price: age ${Math.round(ageMs / 1000)}s`, true), underlying });
        continue;
      }
      const decimal = pythToDecimal(tokenized.price, tokenized.expo);
      const eventAt = new Date(tokenized.publishTime * 1000).toISOString();
      const raw = JSON.stringify({ id: tokenized.id, price: tokenized.price, expo: tokenized.expo, publish_time: tokenized.publishTime });
      results.set(asset.assetId, { price: priceCapture(scaleDecimalToInteger(decimal, asset.priceScale), eventAt, at, raw), underlying });
    }
    return results;
  } catch (error) {
    const at = new Date().toISOString();
    for (const asset of pending) {
      if (!results.has(asset.assetId)) results.set(asset.assetId, { price: priceFailure(at, `hermes fetch failed: ${error instanceof Error ? error.message : String(error)}`, true), underlying: null });
    }
    return results;
  }
}
