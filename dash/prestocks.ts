import type { FieldCapture } from '../stocks/stocks.ts';
import type { AssetCaptures, DashAssetConfig, LiveEvidenceAdapter } from './adapters.ts';
import { scaleDecimalToInteger } from './adapters.ts';
import type { PythUnderlyingRef } from './pyth.ts';

// PreStocks public API (keyless), from the Stocklana track: https://prestocks.com/api/prestocks
// Rows carry real Solana mints (contract_address), the SPV markPrice per underlying share, and
// the issuer tokenPrice per *scaled* token unit. The mints are token-2022 with the scaled-UI-
// amount extension (verified on-chain 2026-09-16: OPENAI multiplier 1.4861347, SPACEX 5, both
// past their activation timestamps, plus a 50bps transfer fee). DEX pools and Jupiter price the
// RAW unit while wallets and the issuer price the SCALED unit, so raw pool evidence MUST be
// divided by the on-chain effective multiplier before any reference comparison (V66). The API
// response carries no source timestamp, so references attest local receipt time only.
const PRESTOCKS_URL = process.env.PRESTOCKS_URL ?? 'https://prestocks.com/api/prestocks';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const DECIMAL = /^\d+(\.\d+)?$/;

export interface PreStockEntry {
  mint: string;
  symbol: string;
  markPrice: string;
  tokenPrice: string;
}

export interface ScaledUiState {
  multiplier: string;
  newMultiplier: string | null;
  newMultiplierEffectiveTimestamp: number | null;
}

function positiveDecimal(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const text = value.toString();
  return DECIMAL.test(text) ? text : null;
}

// Pure and injectable so tests stay offline: validates untrusted API rows, keyed by mint.
export function parsePreStocks(value: unknown): Map<string, PreStockEntry> {
  const entries = new Map<string, PreStockEntry>();
  if (!Array.isArray(value)) return entries;
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const mint = row.contract_address;
    const symbol = row.symbol;
    const markPrice = positiveDecimal(row.markPrice);
    const tokenPrice = positiveDecimal(row.tokenPrice);
    if (typeof mint !== 'string' || mint.length === 0 || typeof symbol !== 'string' || symbol.length === 0) continue;
    if (markPrice === null || tokenPrice === null) continue;
    entries.set(mint, { mint, symbol, markPrice, tokenPrice });
  }
  return entries;
}

// The token-2022 scaled-UI-amount rule: the pending multiplier governs once its activation
// timestamp has passed; before that the current multiplier holds.
export function effectiveMultiplier(state: ScaledUiState, nowSeconds: number): string {
  if (state.newMultiplier !== null && state.newMultiplierEffectiveTimestamp !== null && nowSeconds >= state.newMultiplierEffectiveTimestamp) {
    return state.newMultiplier;
  }
  return state.multiplier;
}

// Exact integer-units ÷ decimal multiplier, floored. BigInt only, no floating point.
export function divideIntegerByDecimal(integerUnits: string, multiplier: string): string {
  if (!DECIMAL.test(multiplier)) throw new TypeError(`invalid multiplier: ${multiplier}`);
  const fracLength = multiplier.split('.')[1]?.length ?? 0;
  const denominator = BigInt(scaleDecimalToInteger(multiplier, fracLength));
  if (denominator === 0n) throw new TypeError('multiplier must be positive');
  const numerator = BigInt(integerUnits) * 10n ** BigInt(fracLength);
  return (numerator / denominator).toString();
}

const MULTIPLIER_PRECISION = 7;

// Derive the live scaled-UI multiplier from getTokenSupply: uiAmount / (raw / 10^decimals).
// RPC uiAmount is time-correct, so this cross-checks the extension time-gate path.
export function multiplierFromSupply(rawAmount: string, decimals: number, uiAmount: string, precision = MULTIPLIER_PRECISION): string | null {
  if (!/^\d+$/.test(rawAmount) || !Number.isInteger(decimals) || decimals < 0 || !DECIMAL.test(uiAmount)) return null;
  const raw = BigInt(rawAmount);
  if (raw === 0n) return null;
  const parts = uiAmount.split('.');
  const uiFracLen = parts[1]?.length ?? 0;
  const uiInt = BigInt(`${parts[0] ?? '0'}${parts[1] ?? ''}`);
  const numerator = uiInt * 10n ** BigInt(decimals);
  const denominator = raw * 10n ** BigInt(uiFracLen);
  const scaled = (numerator * 10n ** BigInt(precision)) / denominator;
  const intPart = scaled / 10n ** BigInt(precision);
  const fracPart = (scaled % 10n ** BigInt(precision)).toString().padStart(precision, '0').replace(/0+$/, '');
  return fracPart.length === 0 ? intPart.toString() : `${intPart}.${fracPart}`;
}

export function multipliersAgree(a: string, b: string, maxGapBps = 5): boolean {
  if (!DECIMAL.test(a) || !DECIMAL.test(b)) return false;
  const aUnits = BigInt(scaleDecimalToInteger(a, MULTIPLIER_PRECISION));
  const bUnits = BigInt(scaleDecimalToInteger(b, MULTIPLIER_PRECISION));
  if (bUnits === 0n) return false;
  const gap = aUnits > bUnits ? aUnits - bUnits : bUnits - aUnits;
  return (gap * 10000n) / bUnits <= BigInt(maxGapBps);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseScaledState(value: unknown): ScaledUiState | null {
  const root = readRecord(value);
  const result = readRecord(root?.result);
  const account = result?.value;
  if (account === null || account === undefined) return null;
  const accountRecord = readRecord(account);
  const data = readRecord(accountRecord?.data);
  const program = readString(data?.program);
  if (program !== 'spl-token-2022') return program === 'spl-token' ? { multiplier: '1', newMultiplier: null, newMultiplierEffectiveTimestamp: null } : null;
  const parsed = readRecord(data?.parsed);
  const info = readRecord(parsed?.info);
  const extensions = info?.extensions;
  const rows = Array.isArray(extensions) ? extensions : [];
  const scaled = rows.find(row => readRecord(row)?.extension === 'scaledUiAmountConfig');
  if (scaled === undefined) return { multiplier: '1', newMultiplier: null, newMultiplierEffectiveTimestamp: null };
  const state = readRecord(readRecord(scaled)?.state);
  const multiplier = readString(state?.multiplier);
  if (multiplier === null || !DECIMAL.test(multiplier)) return null;
  const pendingRaw = readString(state?.newMultiplier);
  const pending = pendingRaw !== null && DECIMAL.test(pendingRaw) ? pendingRaw : null;
  const activation = readNumber(state?.newMultiplierEffectiveTimestamp);
  return { multiplier, newMultiplier: pending, newMultiplierEffectiveTimestamp: activation };
}

function parseTokenSupply(value: unknown): { amount: string; decimals: number; uiAmount: string } | null {
  const root = readRecord(value);
  const result = readRecord(root?.result);
  const supply = readRecord(result?.value);
  const amount = readString(supply?.amount);
  const decimals = readNumber(supply?.decimals);
  const uiAmount = readString(supply?.uiAmountString);
  if (amount === null || decimals === null || uiAmount === null || !/^\d+$/.test(amount)) return null;
  return { amount, decimals, uiAmount };
}

async function rpcPost(rpcUrl: string, method: string, params: readonly unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  return response.json();
}

// Read-only RPC lookups. Extension time-gate and getTokenSupply must agree; otherwise null
// for that mint and the wrapping adapter fails the price capture closed (V66).
export async function fetchScaledUiMultipliers(mints: readonly string[], rpcUrl = RPC_URL): Promise<Map<string, string | null>> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const results = await Promise.all(mints.map(async (mint): Promise<[string, string | null]> => {
    try {
      const [accountJson, supplyJson] = await Promise.all([
        rpcPost(rpcUrl, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }]),
        rpcPost(rpcUrl, 'getTokenSupply', [mint]),
      ]);
      const state = parseScaledState(accountJson);
      const supply = parseTokenSupply(supplyJson);
      if (state === null || supply === null) return [mint, null];
      const fromExtension = effectiveMultiplier(state, nowSeconds);
      const fromSupply = multiplierFromSupply(supply.amount, supply.decimals, supply.uiAmount);
      if (fromSupply === null || !multipliersAgree(fromExtension, fromSupply)) return [mint, null];
      return [mint, fromExtension];
    } catch {
      return [mint, null];
    }
  }));
  return new Map(results);
}

// Read-only GET. On any failure both maps hold nulls: references disappear (no dislocation
// check) and the wrapping adapter refuses to publish uncorroborated pool prices.
export async function fetchPreStocks(mints: readonly string[]): Promise<{ refs: Map<string, PythUnderlyingRef | null>; issuerPrices: Map<string, string | null> }> {
  const refs = new Map<string, PythUnderlyingRef | null>();
  const issuerPrices = new Map<string, string | null>();
  for (const mint of mints) {
    refs.set(mint, null);
    issuerPrices.set(mint, null);
  }
  try {
    const response = await fetch(PRESTOCKS_URL, { method: 'GET', headers: { accept: 'application/json' } });
    if (!response.ok) return { refs, issuerPrices };
    const receivedAt = new Date().toISOString();
    const entries = parsePreStocks(await response.json());
    for (const mint of mints) {
      const entry = entries.get(mint);
      if (entry === undefined) continue;
      refs.set(mint, { feedId: `prestocks:${entry.symbol}`, spot: entry.markPrice, publishTime: receivedAt });
      issuerPrices.set(mint, entry.tokenPrice);
    }
    return { refs, issuerPrices };
  } catch {
    return { refs, issuerPrices };
  }
}

// Wraps a raw-unit evidence adapter (DEX Screener) for scaled-UI mints: divides the price
// capture by the on-chain multiplier, then requires the normalized price to agree with the
// issuer's own scaled-unit price within `sanityBps`. Missing multiplier, missing issuer
// corroboration, or disagreement all fail the capture closed (-> NO_DATA downstream, V66).
// Liquidity is USD-denominated and unit-independent, so it passes through restamped only.
export function scaledPreStocksAdapter(inner: LiveEvidenceAdapter, multipliers: ReadonlyMap<string, string | null>, issuerPrices: ReadonlyMap<string, string | null>, sanityBps = 500): LiveEvidenceAdapter {
  const adapter: LiveEvidenceAdapter = {
    sourceId: inner.sourceId,
    adapterVersion: `${inner.adapterVersion}+scaled-ui`,
    semanticVersion: 'usd-pool-scaled',
    async fetchAsset(asset: DashAssetConfig): Promise<AssetCaptures> {
      const captures = await inner.fetchAsset(asset);
      const stamp = { adapterVersion: adapter.adapterVersion, semanticVersion: adapter.semanticVersion };
      const liquidity: FieldCapture = { ...captures.liquidity, ...stamp };
      const price: FieldCapture = { ...captures.price, ...stamp };
      if (price.status !== 'ok' || price.normalizedValue === null) return { price, liquidity };
      const outage = (reason: string, retryable: boolean): FieldCapture => ({
        ...price,
        status: 'outage',
        continuity: 'gap',
        normalizedValue: null,
        rawBytes: reason,
        failure: { retryable, retryAfterMs: retryable ? 2000 : null, reason },
      });
      const multiplier = multipliers.get(asset.assetId) ?? null;
      if (multiplier === null) return { price: outage('scaled-ui multiplier unavailable; cannot normalize raw pool price', true), liquidity };
      const normalized = divideIntegerByDecimal(price.normalizedValue, multiplier);
      const issuer = issuerPrices.get(asset.assetId) ?? null;
      if (issuer === null) return { price: outage('issuer price unavailable; cannot corroborate normalized pool price', true), liquidity };
      const issuerUnits = BigInt(scaleDecimalToInteger(issuer, asset.priceScale));
      if (issuerUnits === 0n) return { price: outage('issuer price is zero; cannot corroborate normalized pool price', false), liquidity };
      const poolUnits = BigInt(normalized);
      const gap = poolUnits > issuerUnits ? poolUnits - issuerUnits : issuerUnits - poolUnits;
      const gapBps = (gap * 10000n) / issuerUnits;
      if (gapBps > BigInt(sanityBps)) {
        return { price: outage(`source-disagreement: normalized pool ${normalized} vs issuer ${issuerUnits.toString()} units differs by ${gapBps.toString()}bps (bound ${sanityBps})`, false), liquidity };
      }
      return {
        price: { ...price, normalizedValue: normalized, rawBytes: JSON.stringify({ inner: price.rawBytes, scaledUiMultiplier: multiplier, issuerPrice: issuer }) },
        liquidity,
      };
    },
  };
  return adapter;
}
