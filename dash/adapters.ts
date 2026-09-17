import type { DataProvenance } from '../stocks/stocks.ts';
import type { StockAssetConfig } from '../stocks/live.ts';

export interface DashConfig {
  assets: readonly StockAssetConfig[];
  coherenceCapMs: number;
  maxDislocationBps?: number;
  integrityMaxAgeMs?: number;
  provenance?: DataProvenance;
}
