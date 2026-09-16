import { dexScreenerAdapter } from './adapters.ts';
import type { DashConfig } from './adapters.ts';
import { runLiveAdvice } from './council.ts';
import { renderAdvice } from './render.ts';

// Verification config. `assetId` is a Solana token mint that is the BASE token in a liquid
// pool (DEX Screener reports price/liquidity for base tokens). Wrapped SOL proves the live
// keyless path end to end. Replace with tokenized-equity mints (e.g. xStocks) for the real
// basket; the Pyth-central slice adds the underlying-vs-tokenized comparison.
const SAMPLE_CONFIG: DashConfig = {
  assets: [
    {
      assetId: 'So11111111111111111111111111111111111111112',
      underlying: 'wSOL',
      targetWeightBps: 10_000,
      priceScale: 6,
      quantityScale: 2,
      minLiquidity: '100000',
      maxWeightBps: 10_000,
    },
  ],
  coherenceCapMs: 120_000,
};

async function main(): Promise<void> {
  const { snapshot, advice } = await runLiveAdvice(SAMPLE_CONFIG, dexScreenerAdapter());
  process.stdout.write(`${renderAdvice(snapshot, advice, SAMPLE_CONFIG)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`dash error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
