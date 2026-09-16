import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanonicalBasketSnapshot, validateCanonicalBasketSnapshot, STOCKS_SCHEMA_VERSION } from '../stocks.ts';
import type { AssetCaptureInput, CanonicalBasketSnapshotInput, FieldCapture, StockField, StockRegistryEntry } from '../stocks.ts';

function reg(assetId: string, underlying: string): StockRegistryEntry {
  return { schemaVersion: STOCKS_SCHEMA_VERSION, venue: 'solana', assetId, underlying, precision: 6 };
}

function cap(field: StockField, value: string | null, status: FieldCapture['status'] = 'ok', capturedAt = '2026-09-16T00:00:00.000Z'): FieldCapture {
  return { field, status, capturedAt, sequence: 1, rawBytes: `${field}:${String(value)}`, normalizedValue: value };
}

function asset(assetId: string, underlying: string, captures: FieldCapture[]): AssetCaptureInput {
  return { registry: reg(assetId, underlying), captures };
}

function baseInput(): CanonicalBasketSnapshotInput {
  return {
    assetIds: ['mintA', 'mintB'],
    assets: {
      mintA: asset('mintA', 'AAPLx', [cap('price', '150000000'), cap('liquidity', '5000000000')]),
      mintB: asset('mintB', 'MSFTx', [cap('price', '400000000'), cap('liquidity', '3000000000')]),
    },
    capturedAt: '2026-09-16T00:00:01.000Z',
    coherenceCapMs: 60000,
    provenance: 'synthetic',
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('V57: complete synthetic basket is READY, frozen, and deterministically hashed', () => {
  const snapshot = createCanonicalBasketSnapshot(baseInput());
  assert.equal(snapshot.envelope.status, 'READY');
  assert.equal(snapshot.envelope.provenance, 'synthetic');
  assert.equal(snapshot.frozen, true);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.projections.mintA));
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.projections.mintA?.fields.price, '150000000');
  const again = createCanonicalBasketSnapshot(baseInput());
  assert.equal(again.hash, snapshot.hash);
  assert.deepEqual(validateCanonicalBasketSnapshot(snapshot).envelope.status, 'READY');
});

test('V57: a missing required field fails closed to NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150000000')]) },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.missing.includes('mintA.liquidity.missing'));
});

test('V57: an outage capture fails closed to NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: { ...input.assets, mintB: asset('mintB', 'MSFTx', [cap('price', null, 'outage'), cap('liquidity', '3000000000')]) },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.missing.includes('mintB.price.outage'));
});

test('V57: a non-integer normalized value is rejected at ingress', () => {
  const input = baseInput();
  assert.throws(() => createCanonicalBasketSnapshot({
    ...input,
    assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150.5'), cap('liquidity', '5000000000')]) },
  }), /non-negative integer string/);
});

test('V57: a future capture breaches coherence and yields NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150000000', 'ok', '2026-09-16T00:00:10.000Z'), cap('liquidity', '5000000000')]) },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.conflicts.includes('mintA.price.future'));
});

test('V57: a capture-time spread beyond the coherence cap yields NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    coherenceCapMs: 1000,
    capturedAt: '2026-09-16T00:00:20.000Z',
    assets: {
      mintA: asset('mintA', 'AAPLx', [cap('price', '150000000', 'ok', '2026-09-16T00:00:00.000Z'), cap('liquidity', '5000000000', 'ok', '2026-09-16T00:00:00.000Z')]),
      mintB: asset('mintB', 'MSFTx', [cap('price', '400000000', 'ok', '2026-09-16T00:00:10.000Z'), cap('liquidity', '3000000000', 'ok', '2026-09-16T00:00:10.000Z')]),
    },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.conflicts.includes('basket.coherence-cap'));
});

test('V57: validate rejects a tampered snapshot and a non-frozen object', () => {
  const snapshot = createCanonicalBasketSnapshot(baseInput());
  const tampered = structuredClone(snapshot) as { hash: string };
  tampered.hash = 'a'.repeat(64);
  deepFreeze(tampered);
  assert.throws(() => validateCanonicalBasketSnapshot(tampered), /hash does not match bytes/);
  assert.throws(() => validateCanonicalBasketSnapshot({ ...snapshot }), /deeply frozen/);
});
