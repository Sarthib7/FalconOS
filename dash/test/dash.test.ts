import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAdapter } from '../adapters.ts';
import type { DashConfig } from '../adapters.ts';
import { runLiveAdvice } from '../council.ts';
import { renderAdvice } from '../render.ts';

const AT = '2026-09-16T00:00:00.000Z';

function config(): DashConfig {
  return {
    assets: [
      { assetId: 'mintA', underlying: 'AAPLx', targetWeightBps: 6000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 8000 },
      { assetId: 'mintB', underlying: 'MSFTx', targetWeightBps: 4000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 8000 },
    ],
    coherenceCapMs: 120_000,
  };
}

test('I11: live fixture evidence publishes an advisory basket with citations', async () => {
  const adapter = fixtureAdapter({
    mintA: { price: '150.25', liquidity: '5000000', at: AT },
    mintB: { price: '400.10', liquidity: '3000000', at: AT },
  });
  const { snapshot, advice } = await runLiveAdvice(config(), adapter);
  assert.equal(snapshot.envelope.provenance, 'live');
  assert.equal(snapshot.envelope.status, 'READY');
  assert.equal(advice.status, 'PUBLISHED');
  assert.equal(advice.executionReady, false);
  assert.equal(advice.proposal?.legs.length, 2);
  assert.equal(advice.citations.length, 4);
  const rendered = renderAdvice(snapshot, advice, config());
  assert.match(rendered, /advisory-only/);
  assert.match(rendered, /AAPLx/);
  assert.match(rendered, /PUBLISHED/);
});

test('V64: a provider outage fails closed to NO_DATA advice', async () => {
  const { snapshot, advice } = await runLiveAdvice(config(), fixtureAdapter({}));
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.equal(advice.status, 'NO_DATA');
  assert.equal(advice.proposal, null);
});

test('V65: a pool below the liquidity floor is vetoed to BLOCKED', async () => {
  const adapter = fixtureAdapter({
    mintA: { price: '150.25', liquidity: '5', at: AT },
    mintB: { price: '400.10', liquidity: '3000000', at: AT },
  });
  const { advice } = await runLiveAdvice(config(), adapter);
  assert.equal(advice.status, 'BLOCKED');
  assert.equal(advice.proposal, null);
});
