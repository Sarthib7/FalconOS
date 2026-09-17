import type { StockAssetConfig } from '../stocks/live.ts';

export interface DashConfig {
  assets: readonly StockAssetConfig[];
  coherenceCapMs: number;
  maxDislocationBps?: number;
}
