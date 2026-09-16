import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAdapter, scaleDecimalToInteger } from '../adapters.ts';
import type { DashConfig } from '../adapters.ts';
import { runCentralAdvice, runLiveAdvice } from '../council.ts';
import { renderAdvice } from '../render.ts';
import type { FieldCapture } from '../../stocks/stocks.ts';
import type { PythPriceResult } from '../pyth.ts';

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

function pythOk(value: string, scale: number): FieldCapture {
  return { field: 'price', sourceId: 'pyth', sourceRole: 'primary', adapterVersion: 'pyth-hermes-v2', semanticVersion: 'core', status: 'ok', eventAt: AT, capturedAt: AT, sequence: 1, continuity: 'continuous', rawBytes: `pyth:${value}`, normalizedValue: scaleDecimalToInteger(value, scale), equivalenceValidated: false, failure: null };
}

function pythOutage(): FieldCapture {
  return { field: 'price', sourceId: 'pyth', sourceRole: 'primary', adapterVersion: 'pyth-hermes-v2', semanticVersion: 'core', status: 'outage', eventAt: AT, capturedAt: AT, sequence: 1, continuity: 'gap', rawBytes: 'outage', normalizedValue: null, equivalenceValidated: false, failure: { retryable: true, retryAfterMs: 1000, reason: 'hermes unavailable' } };
}

function dexFixture() {
  return fixtureAdapter({
    mintA: { price: '150.25', liquidity: '5000000', at: AT },
    mintB: { price: '400.10', liquidity: '3000000', at: AT },
  });
}

test('V57 V60: healthy Pyth is the selected primary price source', async () => {
  const pythResults = new Map<string, PythPriceResult>([
    ['mintA', { price: pythOk('150.00', 6), underlying: { feedId: `0x${'a'.repeat(64)}`, spot: '150.10', publishTime: AT } }],
    ['mintB', { price: pythOk('400.00', 6), underlying: { feedId: `0x${'b'.repeat(64)}`, spot: '400.00', publishTime: AT } }],
  ]);
  const { snapshot, advice, underlyingRefs } = await runCentralAdvice(config(), dexFixture(), pythResults);
  assert.equal(snapshot.envelope.status, 'READY');
  assert.equal(advice.status, 'PUBLISHED');
  const decision = snapshot.sourceDecisions.find(entry => entry.assetId === 'mintA' && entry.field === 'price');
  assert.equal(decision?.selectedSourceId, 'pyth');
  const rendered = renderAdvice(snapshot, advice, config(), underlyingRefs);
  assert.match(rendered, /underlying=\$150\.100000/);
  assert.match(rendered, /premium=[-+]\d+bps/);
});

test('V60: a Pyth outage fails over to the DEX secondary price', async () => {
  const pythResults = new Map<string, PythPriceResult>([
    ['mintA', { price: pythOutage(), underlying: null }],
    ['mintB', { price: pythOk('400.00', 6), underlying: null }],
  ]);
  const { snapshot, advice } = await runCentralAdvice(config(), dexFixture(), pythResults);
  assert.equal(snapshot.envelope.status, 'READY');
  assert.equal(advice.status, 'PUBLISHED');
  const decision = snapshot.sourceDecisions.find(entry => entry.assetId === 'mintA' && entry.field === 'price');
  assert.equal(decision?.selectedRole, 'secondary');
  assert.equal(decision?.selectedSourceId, 'fixture');
});

test('V65: a large token-vs-underlying dislocation is vetoed to BLOCKED', async () => {
  const pythResults = new Map<string, PythPriceResult>([
    ['mintA', { price: pythOk('150.00', 6), underlying: { feedId: `0x${'c'.repeat(64)}`, spot: '100.00', publishTime: AT } }],
    ['mintB', { price: pythOk('400.00', 6), underlying: null }],
  ]);
  const { advice } = await runCentralAdvice(config(), dexFixture(), pythResults);
  assert.equal(advice.status, 'BLOCKED');
  const review = advice.riskReview;
  assert.ok(review.kind === 'risk-review' && review.reasons.some(reason => reason.includes('dislocated')));
});
