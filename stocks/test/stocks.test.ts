import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasketProposal, createCanonicalBasketSnapshot, createHostTransportBoundary, createRiskReview, createStocksAdviceRequest, invokeStocksAdvice, validateCanonicalBasketSnapshot, validateStocksAdviceResponse, STOCKS_SCHEMA_VERSION } from '../stocks.ts';
import type { AssetCaptureInput, BasketProposal, CanonicalBasketSnapshotInput, FieldCapture, StockField, StockRegistryEntry } from '../stocks.ts';

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

const legs = [
  { assetId: 'mintA', underlying: 'AAPLx', targetWeightBps: 6000 },
  { assetId: 'mintB', underlying: 'MSFTx', targetWeightBps: 4000 },
];

function councilBoundary(
  proposal: BasketProposal | null,
  risk: { status: 'PASS' | 'BLOCK' | 'NO_DATA'; critical?: boolean },
  opts: { leadSnapshotHash?: string } = {},
) {
  return createHostTransportBoundary({
    async lead(req) {
      return { schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'stocks.lead-response', role: 'lead-specialist', requestId: req.requestId, runId: req.runId, snapshotHash: opts.leadSnapshotHash ?? req.snapshotHash, status: proposal ? proposal.status : 'NO_DATA', proposal };
    },
    async riskReview(req) {
      return { schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'stocks.risk-response', role: 'independent-risk-reviewer', requestId: req.requestId, runId: req.runId, reviewId: 'rev1', status: risk.status, critical: risk.critical ?? false, reasons: [], snapshotHash: req.snapshotHash, leadProposalHash: req.leadProposalHash };
    },
  });
}

function readyProposal(proposalId = 'p1') {
  const snapshot = createCanonicalBasketSnapshot(baseInput());
  return { snapshot, proposal: createBasketProposal({ proposalId, snapshot, legs, invalidations: ['price stale'], confidence: '7000', horizon: '30d', expiresAt: '2026-09-17T00:00:00.000Z' }) };
}

test('V56 V59: a passing council run publishes the basket advice', async () => {
  const { snapshot, proposal } = readyProposal();
  assert.equal(proposal.status, 'PROPOSED');
  assert.equal(proposal.legs.length, 2);
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'PASS' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'PUBLISHED');
  assert.equal(advice.proposal?.proposalId, 'p1');
  assert.deepEqual(advice.proposal?.invalidations, ['price stale']);
  assert.equal(advice.proposal?.expiresAt, '2026-09-17T00:00:00.000Z');
  assert.equal(advice.authority, 'advisory-only');
  assert.equal(advice.executionReady, false);
  assert.ok(Object.isFrozen(advice));
  validateStocksAdviceResponse(advice);
});

test('V58: a blocking risk review yields BLOCKED with no proposal', async () => {
  const { snapshot, proposal } = readyProposal();
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'BLOCK' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'BLOCKED');
  assert.equal(advice.proposal, null);
});

test('V58: a NO_DATA risk review yields NO_DATA', async () => {
  const { snapshot, proposal } = readyProposal();
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'NO_DATA' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'NO_DATA');
  assert.equal(advice.proposal, null);
});

test('V58: a forged critical PASS is rejected and yields NO_DATA', async () => {
  const { snapshot, proposal } = readyProposal();
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'PASS', critical: true }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'NO_DATA');
});

test('V56: a NO_DATA snapshot forces a NO_DATA proposal and advice', async () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', null, 'outage'), cap('liquidity', '5000000000')]) },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  const proposal = createBasketProposal({ proposalId: 'p2', snapshot, legs, invalidations: [], confidence: null, horizon: null, expiresAt: '2026-09-17T00:00:00.000Z' });
  assert.equal(proposal.status, 'NO_DATA');
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'PASS' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'NO_DATA');
});

test('V58: a lead snapshot-hash binding mismatch yields NO_DATA', async () => {
  const { snapshot, proposal } = readyProposal();
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'PASS' }, { leadSnapshotHash: 'a'.repeat(64) }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'NO_DATA');
});

test('V56: basket leg weights must sum to 10000 bps', () => {
  const snapshot = createCanonicalBasketSnapshot(baseInput());
  assert.throws(() => createBasketProposal({
    proposalId: 'p3',
    snapshot,
    legs: [{ assetId: 'mintA', underlying: 'AAPLx', targetWeightBps: 6000 }, { assetId: 'mintB', underlying: 'MSFTx', targetWeightBps: 3000 }],
    invalidations: [],
    confidence: null,
    horizon: null,
    expiresAt: '2026-09-17T00:00:00.000Z',
  }), /sum to 10000/);
});

test('V58: a critical risk review cannot pass', () => {
  assert.throws(() => createRiskReview({ reviewId: 'rev', requestId: 'r1', runId: 'run1', status: 'PASS', critical: true, reasons: [], snapshotHash: 'b'.repeat(64), proposalHash: null }), /cannot pass/);
});

test('V58: validateStocksAdviceResponse rejects a forged published advice', async () => {
  const { snapshot, proposal } = readyProposal();
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'PASS' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'PUBLISHED');
  const forged = structuredClone(advice) as { proposal: unknown };
  forged.proposal = null;
  deepFreeze(forged);
  assert.throws(() => validateStocksAdviceResponse(forged), /requires a proposal/);
});

test('V59: published advice cites per-leg evidence and non-published cites nothing', async () => {
  const { snapshot, proposal } = readyProposal();
  const published = await invokeStocksAdvice(councilBoundary(proposal, { status: 'PASS' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(published.citations.length, 4);
  for (const citation of published.citations) assert.match(citation.rawSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual([...new Set(published.citations.map((entry) => entry.assetId))].sort(), ['mintA', 'mintB']);
  const blocked = await invokeStocksAdvice(councilBoundary(proposal, { status: 'BLOCK' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(blocked.citations.length, 0);
});
