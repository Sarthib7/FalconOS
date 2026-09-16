import type { PythUnderlyingRef } from './pyth.ts';

// PreStocks public API (keyless), from the Stocklana track: https://prestocks.com/api/prestocks
// Returns tokenized pre-IPO stocks with real Solana mints (contract_address), the on-chain
// tokenPrice, and the SPV markPrice of the underlying private company. The response carries no
// source timestamp, so references attest local receipt time only. markPrice becomes the
// underlying reference for the dislocation veto; price/liquidity evidence for these mints comes
// from DEX Screener pools.
const PRESTOCKS_URL = process.env.PRESTOCKS_URL ?? 'https://prestocks.com/api/prestocks';
const DECIMAL = /^\d+(\.\d+)?$/;

export interface PreStockEntry {
  mint: string;
  symbol: string;
  markPrice: string;
  tokenPrice: string;
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

// Read-only GET. On any failure the map holds null refs, so the dashboard degrades to
// evidence-only rendering with no dislocation check instead of fabricating references.
export async function fetchPreStocksRefs(mints: readonly string[]): Promise<Map<string, PythUnderlyingRef | null>> {
  const refs = new Map<string, PythUnderlyingRef | null>();
  for (const mint of mints) refs.set(mint, null);
  try {
    const response = await fetch(PRESTOCKS_URL, { method: 'GET', headers: { accept: 'application/json' } });
    if (!response.ok) return refs;
    const receivedAt = new Date().toISOString();
    const entries = parsePreStocks(await response.json());
    for (const mint of mints) {
      const entry = entries.get(mint);
      if (entry !== undefined) refs.set(mint, { feedId: `prestocks:${entry.symbol}`, spot: entry.markPrice, publishTime: receivedAt });
    }
    return refs;
  } catch {
    return refs;
  }
}
