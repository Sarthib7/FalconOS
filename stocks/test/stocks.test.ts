import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasketProposal, createCanonicalBasketSnapshot, createHostTransportBoundary, createRiskReview, createStocksAdviceRequest, invokeStocksAdvice, validateCanonicalBasketSnapshot, STOCKS_SCHEMA_VERSION } from '../stocks.ts';
import type { AssetCaptureInput, AssetSourcePrecedence, BasketProposal, CanonicalBasketSnapshotInput, FieldCapture, SourceRole, SourceSpec, StockField, StockRegistryEntry } from '../stocks.ts';

const EVENT_AT = '2026-09-16T00:00:00.000Z';
const RECEIPT_AT = '2026-09-16T00:00:00.500Z';
const BASKET_AT = '2026-09-16T00:00:01.000Z';
const EXPIRES_AT = '2026-09-17T00:00:00.000Z';

function reg(assetId: string, underlying: string, maxWeightBps = 10000): StockRegistryEntry {
  return {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    registryVersion: 'reg-1',
    venue: 'solana',
    assetId,
    underlying,
    instrumentType: 'tokenized-equity',
    priceScale: 6,
    quantityScale: 6,
    limits: { minLiquidity: '1000000', maxWeightBps },
    fees: { takerBps: 10, makerBps: 5 },
    capabilities: { tradable: true, redeemable: true },
    corporateAction: { lastEventId: null, asOf: null },
    provenance: 'synthetic',
  };
}

function spec(sourceId: string): SourceSpec {
  return { sourceId, adapterVersion: 'a1', semanticVersion: 's1' };
}

function precedence(): AssetSourcePrecedence {
  return {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    policyVersion: 'pol-1',
    fields: [
      { field: 'price', primary: spec('px-primary'), secondary: spec('px-secondary') },
      { field: 'liquidity', primary: spec('lq-primary'), secondary: spec('lq-secondary') },
    ],
  };
}

interface CapOpts {
  sourceRole?: SourceRole;
  sourceId?: string;
  status?: FieldCapture['status'];
  eventAt?: string;
  capturedAt?: string;
  equivalenceValidated?: boolean;
  failure?: FieldCapture['failure'];
}

function cap(field: StockField, value: string | null, opts: CapOpts = {}): FieldCapture {
  const status = opts.status ?? 'ok';
  const sourceId = opts.sourceId ?? (field === 'price' ? 'px-primary' : 'lq-primary');
  return {
    field,
    sourceId,
    sourceRole: opts.sourceRole ?? 'primary',
    adapterVersion: 'a1',
    semanticVersion: 's1',
    status,
    eventAt: opts.eventAt ?? EVENT_AT,
    capturedAt: opts.capturedAt ?? RECEIPT_AT,
    sequence: 1,
    continuity: 'continuous',
    rawBytes: `${field}:${String(value)}:${sourceId}`,
    normalizedValue: value,
    equivalenceValidated: opts.equivalenceValidated ?? false,
    failure: opts.failure === undefined ? (status === 'ok' ? null : { retryable: true, retryAfterMs: 1000, reason: 'synthetic outage' }) : opts.failure,
  };
}

function asset(assetId: string, underlying: string, captures: FieldCapture[], maxWeightBps = 10000): AssetCaptureInput {
  return { registry: reg(assetId, underlying, maxWeightBps), precedence: precedence(), captures };
}

function baseInput(): CanonicalBasketSnapshotInput {
  return {
    assetIds: ['mintA', 'mintB'],
    assets: {
      mintA: asset('mintA', 'AAPLx', [cap('price', '150000000'), cap('liquidity', '5000000000')]),
      mintB: asset('mintB', 'MSFTx', [cap('price', '400000000'), cap('liquidity', '3000000000')]),
    },
    capturedAt: BASKET_AT,
    coherenceCapMs: 60000,
    provenance: 'synthetic',
  };
}

const legs = [
  { assetId: 'mintA', underlying: 'AAPLx', targetWeightBps: 6000 },
  { assetId: 'mintB', underlying: 'MSFTx', targetWeightBps: 4000 },
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

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
  return { snapshot, proposal: createBasketProposal({ proposalId, snapshot, legs, invalidations: ['price stale'], confidence: '7000', horizon: '30d', expiresAt: EXPIRES_AT }) };
}

test('V57: complete synthetic basket is READY, frozen, and deterministically hashed', () => {
  const snapshot = createCanonicalBasketSnapshot(baseInput());
  assert.equal(snapshot.envelope.status, 'READY');
  assert.ok(Object.isFrozen(snapshot));
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.projections.mintA?.fields.price, '150000000');
  assert.equal(createCanonicalBasketSnapshot(baseInput()).hash, snapshot.hash);
  assert.equal(validateCanonicalBasketSnapshot(snapshot).envelope.status, 'READY');
});

test('V57: a missing required field fails closed to NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150000000')]) } });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.missing.includes('mintA.liquidity.primary-missing'));
});

test('V57: a non-integer normalized value is rejected at ingress', () => {
  const input = baseInput();
  assert.throws(() => createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150.5'), cap('liquidity', '5000000000')]) } }), /non-negative integer string/);
});

test('V61: a future capture yields NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150000000', { eventAt: '2026-09-16T00:00:09.000Z', capturedAt: '2026-09-16T00:00:10.000Z' }), cap('liquidity', '5000000000')]) } });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.conflicts.includes('mintA.price.future'));
});

test('V61: provider-event time after local-receipt time yields NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150000000', { eventAt: '2026-09-16T00:00:00.800Z', capturedAt: '2026-09-16T00:00:00.500Z' }), cap('liquidity', '5000000000')]) } });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.conflicts.includes('mintA.price.event-after-receipt'));
});

test('V61: a capture-time spread beyond the coherence cap yields NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    coherenceCapMs: 1000,
    capturedAt: '2026-09-16T00:00:20.000Z',
    assets: {
      mintA: asset('mintA', 'AAPLx', [cap('price', '150000000', { eventAt: '2026-09-16T00:00:00.000Z', capturedAt: '2026-09-16T00:00:00.000Z' }), cap('liquidity', '5000000000', { eventAt: '2026-09-16T00:00:00.000Z', capturedAt: '2026-09-16T00:00:00.000Z' })]),
      mintB: asset('mintB', 'MSFTx', [cap('price', '400000000', { eventAt: '2026-09-16T00:00:10.000Z', capturedAt: '2026-09-16T00:00:10.000Z' }), cap('liquidity', '3000000000', { eventAt: '2026-09-16T00:00:10.000Z', capturedAt: '2026-09-16T00:00:10.000Z' })]),
    },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.conflicts.includes('basket.coherence-cap'));
});

test('V60: a typed primary outage fails over to an equivalence-validated secondary', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: {
      ...input.assets,
      mintA: asset('mintA', 'AAPLx', [
        cap('price', null, { sourceRole: 'primary', sourceId: 'px-primary', status: 'outage' }),
        cap('price', '150000000', { sourceRole: 'secondary', sourceId: 'px-secondary', equivalenceValidated: true }),
        cap('liquidity', '5000000000'),
      ]),
    },
  });
  assert.equal(snapshot.envelope.status, 'READY');
  const decision = snapshot.sourceDecisions.find((entry) => entry.assetId === 'mintA' && entry.field === 'price');
  assert.equal(decision?.selectedRole, 'secondary');
  assert.equal(decision?.selectedSourceId, 'px-secondary');
});

test('V60: a secondary without equivalence validation cannot substitute a primary outage', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: {
      ...input.assets,
      mintA: asset('mintA', 'AAPLx', [
        cap('price', null, { sourceRole: 'primary', sourceId: 'px-primary', status: 'outage' }),
        cap('price', '150000000', { sourceRole: 'secondary', sourceId: 'px-secondary', equivalenceValidated: false }),
        cap('liquidity', '5000000000'),
      ]),
    },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.missing.includes('mintA.price.outage'));
});

test('V60: primary and secondary disagreement yields NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: {
      ...input.assets,
      mintA: asset('mintA', 'AAPLx', [
        cap('price', '150000000', { sourceRole: 'primary', sourceId: 'px-primary' }),
        cap('price', '999999999', { sourceRole: 'secondary', sourceId: 'px-secondary' }),
        cap('liquidity', '5000000000'),
      ]),
    },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.conflicts.includes('mintA.price.source-disagreement'));
});

test('V60: a source identity mismatch yields NO_DATA', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({
    ...input,
    assets: {
      ...input.assets,
      mintA: asset('mintA', 'AAPLx', [cap('price', '150000000', { sourceRole: 'primary', sourceId: 'rogue-source' }), cap('liquidity', '5000000000')]),
    },
  });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  assert.ok(snapshot.conflicts.includes('mintA.price.primary-identity'));
});

test('V62: non-ok captures require typed failure metadata and carry no value', () => {
  const input = baseInput();
  const okWithFailure = cap('price', '150000000', { failure: { retryable: false, retryAfterMs: null, reason: 'unexpected' } });
  assert.throws(() => createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [okWithFailure, cap('liquidity', '5000000000')]) } }), /must not carry a failure/);
  const outageNoFailure: FieldCapture = { field: 'price', sourceId: 'px-primary', sourceRole: 'primary', adapterVersion: 'a1', semanticVersion: 's1', status: 'outage', eventAt: EVENT_AT, capturedAt: RECEIPT_AT, sequence: 1, continuity: 'continuous', rawBytes: 'x', normalizedValue: null, equivalenceValidated: false, failure: null };
  assert.throws(() => createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [outageNoFailure, cap('liquidity', '5000000000')]) } }), /failure must be an object/);
  const failingWithValue: FieldCapture = { ...outageNoFailure, normalizedValue: '1', failure: { retryable: true, retryAfterMs: 1000, reason: 'x' } };
  assert.throws(() => createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [failingWithValue, cap('liquidity', '5000000000')]) } }), /must not carry a normalized value/);
});

test('V63: a registry with an invalid max-weight cap is rejected', () => {
  const input = baseInput();
  assert.throws(() => createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150000000'), cap('liquidity', '5000000000')], 0) } }), /maxWeightBps must be at least 1/);
});

test('V63: a leg weight above the registry cap is rejected', () => {
  const input = baseInput();
  const snapshot = createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', '150000000'), cap('liquidity', '5000000000')], 5000) } });
  assert.throws(() => createBasketProposal({ proposalId: 'p1', snapshot, legs, invalidations: [], confidence: null, horizon: null, expiresAt: EXPIRES_AT }), /exceeds registry max-weight cap/);
});

test('V57: validate rejects a tampered snapshot and a non-frozen object', () => {
  const snapshot = createCanonicalBasketSnapshot(baseInput());
  const tampered = structuredClone(snapshot) as { hash: string };
  tampered.hash = 'a'.repeat(64);
  deepFreeze(tampered);
  assert.throws(() => validateCanonicalBasketSnapshot(tampered), /hash does not match bytes/);
  assert.throws(() => validateCanonicalBasketSnapshot({ ...snapshot }), /deeply frozen/);
});

test('V56 V59: a passing council run publishes advice with source-bound citations', async () => {
  const { snapshot, proposal } = readyProposal();
  assert.equal(proposal.status, 'PROPOSED');
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'PASS' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'PUBLISHED');
  assert.equal(advice.proposal?.proposalId, 'p1');
  assert.equal(advice.authority, 'advisory-only');
  assert.equal(advice.executionReady, false);
  assert.equal(advice.citations.length, 4);
  assert.deepEqual([...new Set(advice.citations.map((entry) => entry.sourceId))].sort(), ['lq-primary', 'px-primary']);
  for (const citation of advice.citations) assert.match(citation.rawSha256, /^[a-f0-9]{64}$/);
});

test('V58: a blocking risk review yields BLOCKED with no proposal or citations', async () => {
  const { snapshot, proposal } = readyProposal();
  const advice = await invokeStocksAdvice(councilBoundary(proposal, { status: 'BLOCK' }), createStocksAdviceRequest({ requestId: 'r1', runId: 'run1', snapshot }));
  assert.equal(advice.status, 'BLOCKED');
  assert.equal(advice.proposal, null);
  assert.equal(advice.citations.length, 0);
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
  const snapshot = createCanonicalBasketSnapshot({ ...input, assets: { ...input.assets, mintA: asset('mintA', 'AAPLx', [cap('price', null, { status: 'outage' }), cap('liquidity', '5000000000')]) } });
  assert.equal(snapshot.envelope.status, 'NO_DATA');
  const proposal = createBasketProposal({ proposalId: 'p2', snapshot, legs, invalidations: [], confidence: null, horizon: null, expiresAt: EXPIRES_AT });
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
  assert.throws(() => createBasketProposal({ proposalId: 'p3', snapshot, legs: [{ assetId: 'mintA', underlying: 'AAPLx', targetWeightBps: 6000 }, { assetId: 'mintB', underlying: 'MSFTx', targetWeightBps: 3000 }], invalidations: [], confidence: null, horizon: null, expiresAt: EXPIRES_AT }), /sum to 10000/);
});

test('V58: a critical risk review cannot pass', () => {
  assert.throws(() => createRiskReview({ reviewId: 'rev', requestId: 'r1', runId: 'run1', status: 'PASS', critical: true, reasons: [], snapshotHash: 'b'.repeat(64), proposalHash: null }), /cannot pass/);
});
