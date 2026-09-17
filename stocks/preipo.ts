import type { StockAssetConfig } from './live.ts';

export const PREIPO_ASSETS: readonly StockAssetConfig[] = [
  { assetId: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF', underlying: 'OPENAI', targetWeightBps: 6000, priceScale: 6, quantityScale: 2, minLiquidity: '500000', maxWeightBps: 8000 },
  { assetId: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', underlying: 'SPACEX', targetWeightBps: 4000, priceScale: 6, quantityScale: 2, minLiquidity: '500000', maxWeightBps: 8000 },
];
