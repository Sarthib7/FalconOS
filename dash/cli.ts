import { dexScreenerAdapter } from '../stocks/adapters.ts';
import type { CanonicalBasketSnapshot, StocksAdviceResponse } from '../stocks/stocks.ts';
import type { DashConfig } from './adapters.ts';
import { evaluateMarketIntegrity } from '../stocks/integrity.ts';
import { STOCKS_DEMO_ASSETS, stocksDemoValues } from '../stocks/demo.ts';
import { fixtureAdapter } from '../stocks/adapters.ts';
import { runCentralAdvice, runLiveAdvice } from './council.ts';
import { fetchPreStocks, fetchScaledUiMultipliers, scaledPreStocksAdapter } from '../stocks/prestocks.ts';
import { PREIPO_ASSETS } from '../stocks/preipo.ts';
import { fetchPythPrices } from './pyth.ts';
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

const PREIPO_CONFIG: DashConfig = {
  assets: PREIPO_ASSETS,
  coherenceCapMs: 120_000,
  integrityMaxAgeMs: 900_000,
};

function reportFor(snapshot: CanonicalBasketSnapshot, advice: StocksAdviceResponse, config: DashConfig, checkedAt = new Date().toISOString()) {
  return evaluateMarketIntegrity({ snapshot, proposal: advice.proposal, checkedAt, maxAgeMs: config.integrityMaxAgeMs ?? 900_000 });
}

async function runStocksDemo(): Promise<void> {
  const capturedAt = new Date().toISOString();
  const config: DashConfig = { assets: STOCKS_DEMO_ASSETS, coherenceCapMs: 120_000, integrityMaxAgeMs: 900_000 };
  const healthy = await runLiveAdvice(config, fixtureAdapter(stocksDemoValues(capturedAt)));
  const blocked = await runLiveAdvice(config, fixtureAdapter(stocksDemoValues(capturedAt, true)));
  const staleAt = new Date(Date.parse(capturedAt) + 3_600_000).toISOString();

  process.stdout.write('STOCKS DEMO / HEALTHY\n');
  process.stdout.write(`${renderAdvice(healthy.snapshot, healthy.advice, config, undefined, reportFor(healthy.snapshot, healthy.advice, config, capturedAt))}\n\n`);
  process.stdout.write('STOCKS DEMO / LOW-LIQUIDITY\n');
  process.stdout.write(`${renderAdvice(blocked.snapshot, blocked.advice, config, undefined, reportFor(blocked.snapshot, blocked.advice, config, capturedAt))}\n\n`);
  process.stdout.write('STOCKS DEMO / STALE-REPLAY\n');
  process.stdout.write(`${renderAdvice(healthy.snapshot, healthy.advice, config, undefined, reportFor(healthy.snapshot, healthy.advice, config, staleAt))}\n`);
}

async function main(): Promise<void> {
  if (process.argv[2] === 'stocks-demo') {
    await runStocksDemo();
    return;
  }
  if (process.argv[2] === 'preipo') {
    const mints = PREIPO_CONFIG.assets.map(asset => asset.assetId);
    const [{ refs, issuerPrices }, multipliers] = await Promise.all([fetchPreStocks(mints), fetchScaledUiMultipliers(mints)]);
    const adapter = scaledPreStocksAdapter(dexScreenerAdapter(), multipliers, issuerPrices);
    const { snapshot, advice } = await runLiveAdvice(PREIPO_CONFIG, adapter, refs);
    process.stdout.write(`${renderAdvice(snapshot, advice, PREIPO_CONFIG, refs, reportFor(snapshot, advice, PREIPO_CONFIG))}\n`);
    return;
  }
  const pythAssets = SAMPLE_CONFIG.assets.flatMap(asset => asset.pyth === undefined ? [] : [{ assetId: asset.assetId, underlying: asset.underlying, priceScale: asset.priceScale, tokenizedFeedId: asset.pyth.tokenizedFeedId, underlyingFeedId: asset.pyth.underlyingFeedId }]);
  if (pythAssets.length > 0) {
    const pythResults = await fetchPythPrices(pythAssets);
    const { snapshot, advice, underlyingRefs } = await runCentralAdvice(SAMPLE_CONFIG, dexScreenerAdapter(), pythResults);
    process.stdout.write(`${renderAdvice(snapshot, advice, SAMPLE_CONFIG, underlyingRefs, reportFor(snapshot, advice, SAMPLE_CONFIG))}\n`);
    return;
  }
  const { snapshot, advice } = await runLiveAdvice(SAMPLE_CONFIG, dexScreenerAdapter());
  process.stdout.write(`${renderAdvice(snapshot, advice, SAMPLE_CONFIG, undefined, reportFor(snapshot, advice, SAMPLE_CONFIG))}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`dash error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
