import { dexScreenerAdapter } from '../dash/adapters.ts';
import { runLiveAdvice } from '../dash/council.ts';
import { renderAdvice } from '../dash/render.ts';
import { fetchPreStocks, fetchScaledUiMultipliers, scaledPreStocksAdapter } from './prestocks.ts';
import type { DashConfig } from '../dash/adapters.ts';

export const PREIPO_CONFIG: DashConfig = {
  assets: [
    { assetId: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF', underlying: 'OPENAI', targetWeightBps: 6000, priceScale: 6, quantityScale: 2, minLiquidity: '500000', maxWeightBps: 8000 },
    { assetId: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', underlying: 'SPACEX', targetWeightBps: 4000, priceScale: 6, quantityScale: 2, minLiquidity: '500000', maxWeightBps: 8000 },
  ],
  coherenceCapMs: 120_000,
};

export async function runPreIpo(): Promise<void> {
  const mints = PREIPO_CONFIG.assets.map(asset => asset.assetId);
  const [{ refs, issuerPrices }, multipliers] = await Promise.all([fetchPreStocks(mints), fetchScaledUiMultipliers(mints)]);
  const adapter = scaledPreStocksAdapter(dexScreenerAdapter(), multipliers, issuerPrices);
  const { snapshot, advice } = await runLiveAdvice(PREIPO_CONFIG, adapter, refs);
  process.stdout.write(`${renderAdvice(snapshot, advice, PREIPO_CONFIG, refs)}\n`);
}

if (process.argv[1]?.endsWith('/stocks/cli.ts')) {
  runPreIpo().catch((error: unknown) => {
    process.stderr.write(`stocks error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
