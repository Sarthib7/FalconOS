import assert from 'node:assert/strict';
import test from 'node:test';
import { createBasketProposal, createCanonicalBasketSnapshot, STOCKS_SCHEMA_VERSION } from '../stocks.ts';
import type { AssetCaptureInput, CanonicalBasketSnapshot, FieldCapture, StockRegistryEntry } from '../stocks.ts';
import { evaluateMarketIntegrity } from '../integrity.ts';

const CAPTURED_AT = '2026-09-17T10:00:00.000Z';
const RECEIVED_AT = '2026-09-17T10:00:00.500Z';

function registry(assetId: string, underlying: string): StockRegistryEntry {
  return { schemaVersion: STOCKS_SCHEMA_VERSION, registryVersion: 'integrity-test', venue: 'solana', assetId, underlying, instrumentType: 'tokenized-equity', priceScale: 6, quantityScale: 6, limits: { minLiquidity: '1000000', maxWeightBps: 10000 }, fees: { takerBps: 10, makerBps: 5 }, capabilities: { tradable: true, redeemable: true }, corporateAction: { lastEventId: null, asOf: null }, provenance: 'synthetic' };
}

function capture(field: 'price' | 'liquidity', sourceId: string, value: string, options: { status?: FieldCapture['status']; eventAt?: string } = {}): FieldCapture {
  const status = options.status ?? 'ok';
  return { field, sourceId, sourceRole: 'primary', adapterVersion: 'integrity-test', semanticVersion: '1', status, eventAt: options.eventAt ?? CAPTURED_AT, capturedAt: RECEIVED_AT, sequence: 1, continuity: status === 'ok' ? 'continuous' : 'gap', rawBytes: `${field}:${value}`, normalizedValue: status === 'ok' ? value : null, equivalenceValidated: false, failure: status === 'ok' ? null : { retryable: true, retryAfterMs: 1000, reason: 'test failure' } };
}

function snapshot(mode: 'ready' | 'conflict' | 'missing' | 'different' = 'ready'): CanonicalBasketSnapshot {
  const makeAsset = (assetId: string, underlying: string): AssetCaptureInput => ({
    registry: registry(assetId, underlying),
    precedence: { schemaVersion: STOCKS_SCHEMA_VERSION, policyVersion: 'integrity-test', fields: [{ field: 'price', primary: { sourceId: 'price-source', adapterVersion: 'integrity-test', semanticVersion: '1' }, secondary: null }, { field: 'liquidity', primary: { sourceId: 'liquidity-source', adapterVersion: 'integrity-test', semanticVersion: '1' }, secondary: null }] },
    captures: [
      capture('price', 'price-source', mode === 'different' && assetId === 'asset-a' ? '110000000' : '100000000', mode === 'conflict' && assetId === 'asset-a' ? { eventAt: '2026-09-17T10:01:00.000Z' } : mode === 'missing' && assetId === 'asset-a' ? { status: 'outage' } : undefined),
      capture('liquidity', 'liquidity-source', '5000000000')
    ],
  });
  return createCanonicalBasketSnapshot({ assetIds: ['asset-a', 'asset-b'], assets: { 'asset-a': makeAsset('asset-a', 'AAPLx'), 'asset-b': makeAsset('asset-b', 'MSFTx') }, capturedAt: '2026-09-17T10:00:01.000Z', coherenceCapMs: 60000, provenance: 'synthetic' });
}

function proposalFor(value: CanonicalBasketSnapshot, expiresAt = '2026-09-18T10:00:00.000Z') {
  return createBasketProposal({ proposalId: 'proposal-1', snapshot: value, legs: [{ assetId: 'asset-a', underlying: 'AAPLx', targetWeightBps: 6000 }, { assetId: 'asset-b', underlying: 'MSFTx', targetWeightBps: 4000 }], invalidations: ['evidence expires'], confidence: null, horizon: null, expiresAt });
}

test('integrity report verifies a ready snapshot and binds hashes', () => {
  const value = snapshot();
  const report = evaluateMarketIntegrity({ snapshot: value, proposal: proposalFor(value), checkedAt: '2026-09-17T10:05:00.000Z', maxAgeMs: 900000 });
  assert.equal(report.status, 'VERIFIED');
  assert.equal(report.snapshotHash, value.hash);
  assert.notEqual(report.proposalHash, null);
  assert.equal(report.refusalCodes.length, 0);
});

test('integrity report rejects a proposal from another snapshot', () => {
  const value = snapshot();
  const other = snapshot('different');
  assert.throws(() => evaluateMarketIntegrity({ snapshot: value, proposal: proposalFor(other), checkedAt: '2026-09-17T10:05:00.000Z', maxAgeMs: 900000 }), /snapshot hash mismatch/);
});

test('integrity report marks an expired proposal stale', () => {
  const value = snapshot();
  const report = evaluateMarketIntegrity({ snapshot: value, proposal: proposalFor(value, '2026-09-17T10:04:59.000Z'), checkedAt: '2026-09-17T10:05:00.000Z', maxAgeMs: 900000 });
  assert.equal(report.status, 'STALE');
  assert.ok(report.refusalCodes.includes('proposal-expired'));
});

test('integrity report marks an old snapshot stale', () => {
  const report = evaluateMarketIntegrity({ snapshot: snapshot(), proposal: null, checkedAt: '2026-09-17T12:00:00.000Z', maxAgeMs: 900000 });
  assert.equal(report.status, 'STALE');
  assert.deepEqual(report.refusalCodes, ['snapshot-stale']);
});

test('integrity report marks canonical conflicts divergent', () => {
  const report = evaluateMarketIntegrity({ snapshot: snapshot('conflict'), proposal: null, checkedAt: '2026-09-17T10:00:02.000Z', maxAgeMs: 900000 });
  assert.equal(report.status, 'DIVERGENT');
  assert.deepEqual(report.refusalCodes, ['canonical-conflict']);
});

test('integrity report returns NO_DATA for missing evidence', () => {
  const report = evaluateMarketIntegrity({ snapshot: snapshot('missing'), proposal: null, checkedAt: CAPTURED_AT, maxAgeMs: 900000 });
  assert.equal(report.status, 'NO_DATA');
  assert.ok(report.refusalCodes.includes('required-evidence-missing'));
});
