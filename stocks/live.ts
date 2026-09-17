import type { FieldCapture } from './stocks.ts';

export interface StockAssetConfig {
  assetId: string;
  underlying: string;
  targetWeightBps: number;
  priceScale: number;
  quantityScale: number;
  minLiquidity: string;
  maxWeightBps: number;
  pyth?: { tokenizedFeedId: string; underlyingFeedId: string };
}

export interface AssetCaptures {
  price: FieldCapture;
  liquidity: FieldCapture;
}

export interface LiveEvidenceAdapter {
  readonly sourceId: string;
  readonly adapterVersion: string;
  readonly semanticVersion: string;
  fetchAsset(asset: StockAssetConfig): Promise<AssetCaptures>;
}

export interface UnderlyingReference {
  feedId: string;
  spot: string;
  publishTime: string;
}

const DECIMAL = /^\d+(\.\d+)?$/;

export function scaleDecimalToInteger(value: string, scale: number): string {
  if (!DECIMAL.test(value)) throw new Error(`invalid decimal: ${value}`);
  const parts = value.split('.');
  const intPart = parts[0] ?? '0';
  const fracPart = parts[1] ?? '';
  const frac = `${fracPart}${'0'.repeat(scale)}`.slice(0, scale);
  const combined = `${intPart}${frac}`.replace(/^0+(?=\d)/, '');
  return combined;
}
