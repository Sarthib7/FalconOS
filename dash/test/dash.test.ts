import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureAdapter, scaleDecimalToInteger } from '../adapters.ts';
import type { DashConfig } from '../adapters.ts';
import { runCentralAdvice, runLiveAdvice } from '../council.ts';
import { renderAdvice } from '../render.ts';
import type { FieldCapture } from '../../stocks/stocks.ts';
import type { PythPriceResult } from '../pyth.ts';
import { divideIntegerByDecimal, effectiveMultiplier, multiplierFromSupply, multipliersAgree, parsePreStocks, scaledPreStocksAdapter } from '../prestocks.ts';

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

test('V64: parsePreStocks maps only valid rows by mint', () => {
  const entries = parsePreStocks([
    { name: 'OpenAI PreStocks', symbol: 'OPENAI', contract_address: 'PreMint1', markPrice: 967.4994641333656, tokenPrice: 983.5880055787931, supply: 1 },
    { symbol: 'NOMINT', markPrice: 10, tokenPrice: 10 },
    { symbol: 'BADPRICE', contract_address: 'PreMint2', markPrice: -5, tokenPrice: 10 },
    'garbage',
  ]);
  assert.equal(entries.size, 1);
  const entry = entries.get('PreMint1');
  assert.equal(entry?.symbol, 'OPENAI');
  assert.equal(entry?.markPrice, '967.4994641333656');
  assert.equal(entry?.tokenPrice, '983.5880055787931');
});

test('V66: effectiveMultiplier picks the pending multiplier once its timestamp has passed', () => {
  const before = effectiveMultiplier({ multiplier: '1', newMultiplier: '5', newMultiplierEffectiveTimestamp: 1781065800 }, 1781065799);
  const after = effectiveMultiplier({ multiplier: '1', newMultiplier: '1.4861347', newMultiplierEffectiveTimestamp: 1784305800 }, 1784305800);
  assert.equal(before, '1');
  assert.equal(after, '1.4861347');
});

test('V66: multiplierFromSupply matches the live OPENAI and SPACEX mint ratios', () => {
  assert.equal(multiplierFromSupply('1901951695078', 9, '2826.556411779'), '1.4861346');
  assert.equal(multiplierFromSupply('8742515849291', 9, '43712.579246455'), '5');
});

test('V66: multipliersAgree rejects extension vs supply drift beyond 5bps', () => {
  assert.equal(multipliersAgree('1.4861347', '1.4861346'), true);
  assert.equal(multipliersAgree('5', '5.01'), false);
});

test('V66: divideIntegerByDecimal normalizes raw pool units to scaled units', () => {
  assert.equal(divideIntegerByDecimal('1477000000', '1.4861347'), '993853383');
  assert.equal(divideIntegerByDecimal('605000000', '5'), '121000000');
});

test('V66: scaledPreStocksAdapter fails closed when issuer corroboration disagrees', async () => {
  const inner = fixtureAdapter({ mintA: { price: '1477.00', liquidity: '5000000', at: AT } });
  const adapter = scaledPreStocksAdapter(inner, new Map([['mintA', '1.4861347']]), new Map([['mintA', '900.00']]), 500);
  const captures = await adapter.fetchAsset({ assetId: 'mintA', underlying: 'OPENAI', targetWeightBps: 10_000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 10_000 });
  assert.equal(captures.price.status, 'outage');
  assert.equal(captures.price.normalizedValue, null);
  assert.match(captures.price.failure?.reason ?? '', /source-disagreement/);
});

test('V66: scaledPreStocksAdapter publishes normalized price when issuer agrees', async () => {
  const inner = fixtureAdapter({ mintA: { price: '1477.00', liquidity: '5000000', at: AT } });
  const adapter = scaledPreStocksAdapter(inner, new Map([['mintA', '1.4861347']]), new Map([['mintA', '993.853383']]), 500);
  const captures = await adapter.fetchAsset({ assetId: 'mintA', underlying: 'OPENAI', targetWeightBps: 10_000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 10_000 });
  assert.equal(captures.price.status, 'ok');
  assert.equal(captures.price.normalizedValue, '993853383');
});
