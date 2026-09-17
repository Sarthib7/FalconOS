import type { StockAssetConfig } from './live.ts';

export const STOCKS_DEMO_ASSETS: readonly StockAssetConfig[] = [
  { assetId: 'demo-aaplx', underlying: 'AAPLx', targetWeightBps: 6000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 8000 },
  { assetId: 'demo-msftx', underlying: 'MSFTx', targetWeightBps: 4000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 8000 },
];

export function stocksDemoValues(at: string, lowLiquidity = false): Readonly<Record<string, { price: string; liquidity: string; at: string }>> {
  return {
    'demo-aaplx': { price: '150.25', liquidity: lowLiquidity ? '5' : '5000000', at },
    'demo-msftx': { price: '400.10', liquidity: '3000000', at },
  };
}
