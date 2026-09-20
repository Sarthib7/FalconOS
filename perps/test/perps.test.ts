import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createCanonicalSnapshot,
  createCanonicalSnapshotBundle,
  createCouncilAdviceRequest,
  createCouncilCopilotRequest,
  createHostTransportBoundary,
  createRiskReview,
  createTradeProposal,
  hashTradeProposal,
  invokeCouncilAdvice,
  invokeCouncilCopilot,
  publishCouncilAdvice,
  resolveContractRegistry,
  validateCanonicalSnapshotBundle,
  validateCouncilAdviceRequest,
  validateCouncilAdviceResponse,
  validateCouncilCopilotRequest,
  validateCouncilCopilotResponse,
  validateContractRegistry,
  validateTradeProposal,
  validateRiskReview,
  type CanonicalSnapshot,
  type CanonicalSnapshotBundle,
  type ContractRegistryEntry,
  type SnapshotEvidenceReference,
  type FieldCapture,
  type SourcePrecedence,
} from '../perps.ts';

const captureTime = '2026-09-11T00:00:00.000Z';
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function registry(venue: 'phoenix' | 'hyperliquid' = 'phoenix'): ContractRegistryEntry {
  return {
    schemaVersion: 1,
    registryVersion: 'fixture-registry-v1',
    venue,
    nativeMarketId: `fixture-${venue}-sol-perpetual`,
    underlying: 'SOL',
    instrumentType: 'perpetual',
    collateralAsset: 'fixture-collateral',
    settlementAsset: 'fixture-settlement',
    contractMultiplier: '1',
    precision: { priceDecimals: '2', quantityDecimals: '3', tickSize: '0.01', lotSize: '0.001' },
    limits: { minQuantity: '0.001', maxQuantity: '100', maxLeverage: '10' },
    fees: { maker: '0.001', taker: '0.002' },
    marketData: { indexSource: 'fixture-indexPrice-primary', markSource: 'fixture-markPrice-primary', fundingSource: 'fixture-fundingRate-primary', openInterestSource: 'fixture-openInterest-primary' },
    margin: { initial: '0.1', maintenance: '0.05', liquidation: '0.05' },
    capabilities: { funding: true, reduceOnly: true, nativeStop: false },
    provenance: { capturedAt: captureTime, effectiveFrom: null, effectiveTo: null, rawSha256: 'a'.repeat(64), adapterVersion: 'fixture-adapter-v1' },
  };
}

function precedence(ttl = 5_000, venue: 'phoenix' | 'hyperliquid' = 'phoenix'): SourcePrecedence {
  const fields = {} as SourcePrecedence['fields'];
  for (const field of ['indexPrice', 'markPrice', 'fundingRate', 'openInterest'] as const) {
    fields[field] = {
      primary: { sourceId: `fixture-${field}-primary`, adapterVersion: 'fixture-adapter-v1', semanticVersion: 'semantic-v1' },
      secondary: { sourceId: `fixture-${field}-secondary`, adapterVersion: 'fixture-adapter-v1', semanticVersion: 'semantic-v1' },
      freshnessTtlMs: ttl,
    };
  }
  return { schemaVersion: 1, venue, policyVersion: 'fixture-policy-v1', fields };
}

function captures(overrides: Partial<Record<string, Partial<FieldCapture>>> = {}): FieldCapture[] {
  const values: Record<string, string> = { indexPrice: '100', markPrice: '100.1', fundingRate: '0.001', openInterest: '50' };
  return (['indexPrice', 'markPrice', 'fundingRate', 'openInterest'] as const).map(field => {
    const override = overrides[field];
    const normalized: string | null = override?.normalizedValue === null ? null : (override?.normalizedValue ?? values[field] ?? null);
    return {
      field,
      sourceId: `fixture-${field}-primary`,
      sourceRole: 'primary' as const,
      status: 'ok' as const,
      capturedAt: captureTime,
      sequence: 1,
      continuity: 'continuous' as const,
      rawBytes: `raw-${field}`,
      adapterVersion: 'fixture-adapter-v1',
      semanticVersion: 'semantic-v1',
      equivalenceValidated: false,
      ...override,
      normalizedValue: normalized,
    };
  });
}
function marketSnapshot(venue: 'phoenix' | 'hyperliquid', overrides: Partial<Record<string, Partial<FieldCapture>>> = {}, options: Partial<{ capturedAt: string; coherenceCapMs: number; ttl: number }> = {}): CanonicalSnapshot {
  return createCanonicalSnapshot({ registry: registry(venue), precedence: precedence(options.ttl, venue), captures: captures(overrides), capturedAt: options.capturedAt ?? captureTime, coherenceCapMs: options.coherenceCapMs ?? 5_000, provenance: 'synthetic' });
}

function snapshot(overrides: Partial<Record<string, Partial<FieldCapture>>> = {}, options: Partial<{ capturedAt: string; coherenceCapMs: number; ttl: number }> = {}): CanonicalSnapshotBundle {
  const capturedAt = options.capturedAt ?? captureTime;
  const coherenceCapMs = options.coherenceCapMs ?? 5_000;
  const ttl = options.ttl;
  return createCanonicalSnapshotBundle({
    registries: { phoenix: registry('phoenix'), hyperliquid: registry('hyperliquid') },
    precedence: { phoenix: precedence(ttl, 'phoenix'), hyperliquid: precedence(ttl, 'hyperliquid') },
    captures: { phoenix: captures(overrides), hyperliquid: captures(overrides) },
    capturedAt,
    coherenceCapMs,
    provenance: 'synthetic',
  });
}

function proposalInput(current: CanonicalSnapshotBundle) {
  return {
    proposalId: 'fixture-proposal-1',
    snapshot: current,
    venue: 'phoenix' as const,
    stance: 'LONG' as const,
    suggestedSize: '2',
    suggestedLeverage: '3',
    estimatedRiskBounds: { maxLoss: '10', liquidationDistance: '0.2', marginAtRisk: '5' },
    scenarios: { base: 'range', upside: 'trend', downside: 'invalidated' },
    confidence: 0.7,
    horizon: 'intraday',
    invalidations: ['mark diverges from index'],
    expiresAt: '2026-09-11T00:05:00.000Z',
    policy: { policyId: 'fixture-policy', policyVersion: 'fixture-policy-v1', maxLeverage: '5', maxLoss: '20' },
    account: { accountId: 'fixture-account', availableCollateral: '100', currentExposure: '0' },
    provenance: 'synthetic' as const,
  };
}
function copilotResponse(request: { requestId: string; runId: string; snapshotEvidence: SnapshotEvidenceReference }, status: 'EXPLAINED' | 'NO_DATA' = 'NO_DATA', explanation: string | null = null) {
  return { schemaVersion: 1 as const, kind: 'council.copilot' as const, requestId: request.requestId, runId: request.runId, status, explanation, snapshotEvidence: request.snapshotEvidence, authority: 'explanation-only' as const, canCreateTradeProposal: false as const, executionReady: false as const };
}
function freezeForTest<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeForTest(child);
    Object.freeze(value);
  }
  return value;
}

test('registry is versioned, exact, and rejects duplicate venue definitions', () => {
  assert.deepEqual(resolveContractRegistry([registry()]), { status: 'READY', entry: registry(), missing: [], conflicts: [] });
  assert.equal(resolveContractRegistry([registry(), registry()]).status, 'NO_DATA');
  assert.throws(() => validateContractRegistry({ ...registry(), unexpected: true }), /unexpected keys/);
});

test('canonical snapshot retains raw bytes, hashes, freezes content, and records provenance', () => {
  const current = snapshot();
  assert.equal(current.envelope.status, 'READY');
  assert.equal(current.envelope.provenance, 'synthetic');
  assert.deepEqual(current.envelope.venues, ['phoenix', 'hyperliquid']);
  assert.equal(current.sourcePrecedence.phoenix.policyVersion, 'fixture-policy-v1');
  assert.equal(current.sourcePrecedence.hyperliquid.policyVersion, 'fixture-policy-v1');
  assert.equal(current.registries.phoenix.venue, 'phoenix');
  assert.equal(current.registries.hyperliquid.venue, 'hyperliquid');
  assert.equal(current.hash, hash(current.bytes));
  assert.equal(current.frozen, true);
  assert.equal(Object.isFrozen(current), true);
  assert.equal(current.rawManifest.entries.filter(entry => entry.venue === 'phoenix').length, 4);
  assert.equal(current.rawManifest.entries.filter(entry => entry.venue === 'hyperliquid').length, 4);
  assert.throws(() => { (current.normalized.markets.phoenix.fields as Record<string, string | null>).indexPrice = '999'; }, TypeError);
  assert.doesNotThrow(() => validateCanonicalSnapshotBundle(current));
  const forged = JSON.parse(JSON.stringify(current)) as unknown as CanonicalSnapshotBundle;
  forged.registries.phoenix.nativeMarketId = 'forged-market-id';
  const forgedPayload = {
    envelope: forged.envelope,
    registries: forged.registries,
    sourcePrecedence: forged.sourcePrecedence,
    markets: forged.markets,
    rawManifest: forged.rawManifest,
    normalized: forged.normalized,
    sourceDecisions: forged.sourceDecisions,
    missing: forged.missing,
    conflicts: forged.conflicts,
  };
  forged.bytes = canonical(forgedPayload);
  forged.hash = hash(forged.bytes);
  assert.throws(() => validateCanonicalSnapshotBundle(forged), /deeply frozen|registry binding mismatch/);
  const rebuilt = snapshot();
  assert.equal(rebuilt.hash, current.hash);
  assert.equal(rebuilt.bytes, current.bytes);
});

test('secondary source replaces primary only for typed outage and equivalence', () => {
  const current = marketSnapshot('phoenix', { indexPrice: { status: 'outage', normalizedValue: null } });
  assert.equal(current.envelope.status, 'NO_DATA');
  const failover = marketSnapshot('phoenix', { indexPrice: { status: 'outage', normalizedValue: null }, markPrice: { sourceRole: 'secondary', sourceId: 'fixture-markPrice-secondary', equivalenceValidated: true } });
  assert.equal(failover.envelope.status, 'NO_DATA');
  const failoverCaptures = captures({ indexPrice: { status: 'outage', normalizedValue: null } });
  failoverCaptures.push({ field: 'indexPrice', sourceId: 'fixture-indexPrice-secondary', sourceRole: 'secondary', status: 'ok', capturedAt: captureTime, sequence: 2, continuity: 'continuous', rawBytes: 'secondary-raw', normalizedValue: '100', adapterVersion: 'fixture-adapter-v1', semanticVersion: 'semantic-v1', equivalenceValidated: true });
  const ready = createCanonicalSnapshot({ registry: registry(), precedence: precedence(), captures: failoverCaptures, capturedAt: captureTime, coherenceCapMs: 5_000, provenance: 'synthetic' });
  assert.equal(ready.normalized.fields.indexPrice, '100');
  assert.equal(ready.sourceDecisions.find(decision => decision.field === 'indexPrice')?.outcome, 'SECONDARY_FAILOVER');
});

test('critical source disagreement, stale data, and coherence breach produce NO_DATA', () => {
  const conflicting = marketSnapshot('phoenix', { indexPrice: { normalizedValue: '101' } });
  const conflictingCaptures = captures();
  conflictingCaptures.push({ field: 'indexPrice', sourceId: 'fixture-indexPrice-secondary', sourceRole: 'secondary', status: 'ok', capturedAt: captureTime, sequence: 2, continuity: 'continuous', rawBytes: 'secondary-raw', normalizedValue: '101', adapterVersion: 'fixture-adapter-v1', semanticVersion: 'semantic-v1', equivalenceValidated: true });
  const conflictResult = createCanonicalSnapshot({ registry: registry(), precedence: precedence(), captures: conflictingCaptures, capturedAt: captureTime, coherenceCapMs: 5_000, provenance: 'synthetic' });
  assert.equal(conflictResult.envelope.status, 'NO_DATA');
  assert.ok(conflictResult.conflicts.includes('indexPrice.primary-secondary'));
  assert.equal(conflicting.envelope.status, 'READY');
  assert.equal(snapshot({}, { capturedAt: '2026-09-11T00:00:30.000Z', ttl: 10 }).envelope.status, 'NO_DATA');
  assert.equal(snapshot({ markPrice: { capturedAt: '2026-09-11T00:00:04.000Z' } }, { coherenceCapMs: 1_000, ttl: 1_000 }).envelope.status, 'NO_DATA');
});

test('missing policy or account keeps every numeric suggestion null', () => {
  const current = snapshot();
  const proposal = createTradeProposal({ ...proposalInput(current), policy: null });
  assert.equal(proposal.status, 'PROPOSED');
  assert.equal(proposal.suggestedSize, null);
  assert.equal(proposal.suggestedLeverage, null);
  assert.deepEqual(proposal.estimatedRiskBounds, { maxLoss: null, liquidationDistance: null, marginAtRisk: null });
  assert.equal(proposal.confidence, null);
  assert.equal(proposal.authority, 'non-binding-advisory');
  assert.equal(proposal.executionReady, false);
  assert.doesNotThrow(() => validateTradeProposal(proposal));
});

test('proposal preserves snapshot evidence and NO_DATA status without authority', () => {
  const missing = snapshot({ indexPrice: { status: 'invalid', normalizedValue: null } });
  const proposal = createTradeProposal({ ...proposalInput(missing), policy: null, account: null });
  assert.equal(proposal.status, 'NO_DATA');
  assert.equal(proposal.stance, 'NO_DATA');
  assert.equal(proposal.snapshotEvidence.snapshotHash, missing.hash);
  assert.equal(proposal.authority, 'non-binding-advisory');
  assert.equal(proposal.executionReady, false);
});
test('V25: lead and risk council calls share exact request-scoped bundle identity', async () => {
  const current = snapshot();
  const proposalArgs = proposalInput(current);
  const proposal = createTradeProposal(proposalArgs);
  const adviceRequest = createCouncilAdviceRequest({ requestId: 'advice-1', runId: 'run-1', snapshot: current, policy: proposalArgs.policy, account: proposalArgs.account });
  const calls: { lead: unknown; risk: unknown } = { lead: null, risk: null };
  const boundary = createHostTransportBoundary({
    lead: async request => {
      calls.lead = request;
      return { schemaVersion: 1, kind: 'council.lead-response', role: 'lead-specialist', requestId: request.requestId, runId: request.runId, snapshotHash: request.snapshotEvidence.snapshotHash, proposal, status: 'PROPOSED' };
    },
    riskReview: async request => {
      calls.risk = request;
      return { schemaVersion: 1, kind: 'council.risk-response', role: 'independent-risk-reviewer', requestId: request.requestId, runId: request.runId, reviewId: 'review-pass', status: 'PASS', critical: false, reasons: [], policyVersion: proposalArgs.policy.policyVersion, snapshotHash: request.snapshotEvidence.snapshotHash, leadProposalHash: request.leadProposalHash };
    },
    copilot: async request => copilotResponse(request, 'EXPLAINED', 'Existing proposal only.'),
  });
  const advice = await invokeCouncilAdvice(boundary, adviceRequest);
  assert.equal(advice.status, 'PUBLISHED');
  assert.equal(advice.proposal?.proposalId, proposal.proposalId);
  assert.doesNotThrow(() => validateCouncilAdviceResponse(advice));
  const lead = calls.lead as { role: string; requestId: string; runId: string; snapshot: CanonicalSnapshotBundle; snapshotEvidence: { bytes: string; snapshotHash: string }; policy: unknown; account: unknown };
  const risk = calls.risk as { role: string; requestId: string; runId: string; snapshot: CanonicalSnapshotBundle; snapshotEvidence: { bytes: string; snapshotHash: string }; policy: unknown; account: unknown; leadProposalHash: string | null };
  assert.equal(lead.role, 'lead-specialist');
  assert.equal(risk.role, 'independent-risk-reviewer');
  assert.equal(lead.requestId, risk.requestId);
  assert.equal(lead.runId, risk.runId);
  assert.equal(lead.snapshotEvidence.bytes, risk.snapshotEvidence.bytes);
  assert.equal(lead.snapshotEvidence.snapshotHash, risk.snapshotEvidence.snapshotHash);
  assert.equal(lead.snapshot.bytes, risk.snapshot.bytes);
  assert.equal(lead.snapshot.hash, risk.snapshot.hash);
  assert.deepEqual(lead.policy, proposalArgs.policy);
  assert.deepEqual(lead.account, proposalArgs.account);
  assert.equal(risk.leadProposalHash, hashTradeProposal(proposal));
  assert.equal(Object.isFrozen(lead), true);
  assert.equal(Object.isFrozen(risk), true);
  assert.equal(Object.isFrozen(lead.snapshot), true);

  const copilotRequest = createCouncilCopilotRequest({ requestId: 'copilot-1', runId: 'run-1', snapshot: current, subjectKind: 'proposal', subject: proposal, question: 'Explain invalidation.' });
  assert.deepEqual(Object.keys(copilotRequest).sort(), ['kind', 'question', 'requestId', 'runId', 'schemaVersion', 'snapshot', 'snapshotEvidence', 'subject', 'subjectKind']);
  assert.doesNotThrow(() => validateCouncilCopilotRequest(copilotRequest));
  const invokedCopilot = await invokeCouncilCopilot(boundary, copilotRequest);
  assert.equal(invokedCopilot.runId, 'run-1');
  assert.equal(invokedCopilot.canCreateTradeProposal, false);
});

test('V28: council binding mismatches fail closed and single-callback transport is rejected', async () => {
  const current = snapshot();
  const proposalArgs = proposalInput(current);
  const proposal = createTradeProposal(proposalArgs);
  const adviceRequest = createCouncilAdviceRequest({ requestId: 'advice-bind', runId: 'run-bind', snapshot: current, policy: proposalArgs.policy, account: proposalArgs.account });
  const validLead = async (request: Parameters<NonNullable<Parameters<typeof createHostTransportBoundary>[0]['lead']>>[0]) => ({ schemaVersion: 1 as const, kind: 'council.lead-response' as const, role: 'lead-specialist' as const, requestId: request.requestId, runId: request.runId, snapshotHash: request.snapshotEvidence.snapshotHash, proposal, status: 'PROPOSED' as const });
  const mismatchBoundary = createHostTransportBoundary({
    lead: validLead,
    riskReview: async request => ({ schemaVersion: 1, kind: 'council.risk-response', role: 'independent-risk-reviewer', requestId: request.requestId, runId: 'wrong-run', reviewId: 'review', status: 'PASS', critical: false, reasons: [], policyVersion: null, snapshotHash: request.snapshotEvidence.snapshotHash, leadProposalHash: request.leadProposalHash }),
    copilot: async request => copilotResponse(request),
  });
  const mismatch = await invokeCouncilAdvice(mismatchBoundary, adviceRequest);
  assert.equal(mismatch.status, 'NO_DATA');
  assert.equal(mismatch.proposal, null);
  const wrongRoleBoundary = createHostTransportBoundary({
    lead: async request => ({ ...await validLead(request), role: 'wrong-role' as never }),
    riskReview: async request => ({ schemaVersion: 1, kind: 'council.risk-response', role: 'independent-risk-reviewer', requestId: request.requestId, runId: request.runId, reviewId: 'review', status: 'PASS', critical: false, reasons: [], policyVersion: null, snapshotHash: request.snapshotEvidence.snapshotHash, leadProposalHash: request.leadProposalHash }),
    copilot: async request => copilotResponse(request),
  });
  assert.equal((await invokeCouncilAdvice(wrongRoleBoundary, adviceRequest)).status, 'NO_DATA');
  const wrongHashBoundary = createHostTransportBoundary({
    lead: validLead,
    riskReview: async request => ({ schemaVersion: 1, kind: 'council.risk-response', role: 'independent-risk-reviewer', requestId: request.requestId, runId: request.runId, reviewId: 'review', status: 'PASS', critical: false, reasons: [], policyVersion: null, snapshotHash: request.snapshotEvidence.snapshotHash, leadProposalHash: 'b'.repeat(64) }),
    copilot: async request => copilotResponse(request),
  });
  assert.equal((await invokeCouncilAdvice(wrongHashBoundary, adviceRequest)).status, 'NO_DATA');
  assert.throws(() => createHostTransportBoundary({ advice: async () => { throw new Error('legacy'); }, copilot: async () => { throw new Error('legacy'); } } as never), /lead, riskReview, and copilot/);

  const forgedProposal = { ...proposal, nativeMarketId: 'wrong-native-id' };
  const review = createRiskReview({ reviewId: 'review-pass', requestId: adviceRequest.requestId, runId: adviceRequest.runId, status: 'PASS', critical: false, reasons: [], policyVersion: null, snapshotHash: current.hash, leadProposalHash: hashTradeProposal(proposal) });
  const forged = publishCouncilAdvice({ requestId: adviceRequest.requestId, runId: adviceRequest.runId, snapshot: current, policy: proposalArgs.policy, account: proposalArgs.account, proposal: forgedProposal, riskReview: review });
  assert.equal(forged.status, 'NO_DATA');
  assert.equal(forged.proposal, null);
});

test('V25: lead or risk transport failure never falls back to one callback or execution', async () => {
  const current = snapshot();
  const adviceRequest = createCouncilAdviceRequest({ requestId: 'advice-failure', runId: 'run-failure', snapshot: current, policy: null, account: null });
  let riskCalls = 0;
  const leadFailure = createHostTransportBoundary({
    lead: async () => { throw new Error('lead failure'); },
    riskReview: async () => { riskCalls += 1; throw new Error('risk must not run'); },
    copilot: async request => copilotResponse(request),
  });
  const leadResult = await invokeCouncilAdvice(leadFailure, adviceRequest);
  assert.equal(leadResult.status, 'NO_DATA');
  assert.equal(riskCalls, 0);
  const riskFailure = createHostTransportBoundary({
    lead: async request => ({ schemaVersion: 1, kind: 'council.lead-response', role: 'lead-specialist', requestId: request.requestId, runId: request.runId, snapshotHash: request.snapshotEvidence.snapshotHash, proposal: null, status: 'NO_DATA' }),
    riskReview: async () => { throw new Error('risk failure'); },
    copilot: async request => copilotResponse(request),
  });
  const riskResult = await invokeCouncilAdvice(riskFailure, adviceRequest);
  assert.equal(riskResult.status, 'NO_DATA');
  assert.equal(riskResult.proposal, null);
});

test('bundle hardening enforces cross-venue coherence, source identity, signed funding, and deep ingress', () => {
  const negativeFunding = marketSnapshot('phoenix', { fundingRate: { normalizedValue: '-0.001' } });
  assert.equal(negativeFunding.normalized.fields.fundingRate, '-0.001');
  const fundingEntry = negativeFunding.rawManifest.entries.find(entry => entry.field === 'fundingRate');
  assert.equal(fundingEntry?.adapterVersion, 'fixture-adapter-v1');
  assert.equal(fundingEntry?.semanticVersion, 'semantic-v1');
  assert.equal(fundingEntry?.equivalenceValidated, false);

  const duplicateCaptures = captures();
  duplicateCaptures.push({ ...duplicateCaptures[0]! });
  const duplicate = createCanonicalSnapshot({ registry: registry(), precedence: precedence(), captures: duplicateCaptures, capturedAt: captureTime, coherenceCapMs: 5_000, provenance: 'synthetic' });
  assert.equal(duplicate.envelope.status, 'NO_DATA');
  assert.ok(duplicate.conflicts.includes('indexPrice.duplicate-source'));

  const mismatchedAdapter = marketSnapshot('phoenix', { indexPrice: { adapterVersion: 'fixture-adapter-v2' } });
  assert.equal(mismatchedAdapter.envelope.status, 'NO_DATA');

  const crossVenue = createCanonicalSnapshotBundle({
    registries: { phoenix: registry('phoenix'), hyperliquid: registry('hyperliquid') },
    precedence: { phoenix: precedence(1_000, 'phoenix'), hyperliquid: precedence(1_000, 'hyperliquid') },
    captures: {
      phoenix: captures({ indexPrice: { capturedAt: captureTime }, markPrice: { capturedAt: captureTime }, fundingRate: { capturedAt: captureTime }, openInterest: { capturedAt: captureTime } }),
      hyperliquid: captures({ indexPrice: { capturedAt: '2026-09-11T00:00:02.000Z' }, markPrice: { capturedAt: '2026-09-11T00:00:02.000Z' }, fundingRate: { capturedAt: '2026-09-11T00:00:02.000Z' }, openInterest: { capturedAt: '2026-09-11T00:00:02.000Z' } }),
    },
    capturedAt: '2026-09-11T00:00:03.000Z',
    coherenceCapMs: 1_000,
    provenance: 'synthetic',
  });
  assert.equal(crossVenue.markets.phoenix.envelope.status, 'NO_DATA');
  assert.equal(crossVenue.markets.hyperliquid.envelope.status, 'READY');
  assert.equal(crossVenue.envelope.status, 'NO_DATA');
  assert.ok(crossVenue.missing.some(missing => missing.includes('coherence-age')));

  assert.throws(() => createCanonicalSnapshotBundle({
    registries: { phoenix: registry('hyperliquid'), hyperliquid: registry('hyperliquid') },
    precedence: { phoenix: precedence(5_000, 'phoenix'), hyperliquid: precedence(5_000, 'hyperliquid') },
    captures: { phoenix: captures(), hyperliquid: captures() },
    capturedAt: captureTime,
    coherenceCapMs: 5_000,
    provenance: 'synthetic',
  }), /venue mismatch/);
  assert.throws(() => validateCanonicalSnapshotBundle(JSON.parse(JSON.stringify(snapshot()))), /deeply frozen/);
});
test('adversarial ingress binds raw bytes, sequence continuity, policy state, provenance, Copilot evidence, and audit records', async () => {
  const current = snapshot();
  assert.equal(marketSnapshot('phoenix', { indexPrice: { continuity: 'gap' } }).envelope.status, 'NO_DATA');
  assert.throws(() => marketSnapshot('phoenix', {}, { ttl: 5_001 }), /freshnessTtlMs exceeds coherenceCapMs/);

  const rebuild = (forged: CanonicalSnapshotBundle): CanonicalSnapshotBundle => {
    for (const venue of ['phoenix', 'hyperliquid'] as const) {
      const market = forged.markets[venue];
      market.envelope.rawManifestSha256 = hash(canonical(market.rawManifest));
      market.envelope.normalizedProjectionSha256 = hash(canonical(market.normalized));
      market.bytes = canonical({ envelope: market.envelope, registry: market.registry, sourcePrecedence: market.sourcePrecedence, rawManifest: market.rawManifest, normalized: market.normalized, sourceDecisions: market.sourceDecisions, missing: market.missing, conflicts: market.conflicts });
      market.hash = hash(market.bytes);
    }
    forged.envelope.rawManifestSha256 = hash(canonical(forged.rawManifest));
    forged.envelope.normalizedProjectionSha256 = hash(canonical(forged.normalized));
    forged.bytes = canonical({ envelope: forged.envelope, registries: forged.registries, sourcePrecedence: forged.sourcePrecedence, markets: forged.markets, rawManifest: forged.rawManifest, normalized: forged.normalized, sourceDecisions: forged.sourceDecisions, missing: forged.missing, conflicts: forged.conflicts });
    forged.hash = hash(forged.bytes);
    return freezeForTest(forged);
  };
  const rawForged = JSON.parse(JSON.stringify(current)) as CanonicalSnapshotBundle;
  const rawEntry = rawForged.markets.phoenix.rawManifest.entries[0]!;
  rawEntry.rawBytesBase64 = Buffer.from('tampered').toString('base64');
  const topEntry = rawForged.rawManifest.entries.find(entry => entry.venue === 'phoenix' && entry.field === rawEntry.field)!;
  topEntry.rawBytesBase64 = rawEntry.rawBytesBase64;
  assert.throws(() => validateCanonicalSnapshotBundle(rebuild(rawForged)), /raw hash mismatch/);

  const projectionForged = JSON.parse(JSON.stringify(current)) as CanonicalSnapshotBundle;
  projectionForged.markets.phoenix.sourceDecisions[0]!.selectedValue = '999';
  assert.throws(() => validateCanonicalSnapshotBundle(rebuild(projectionForged)), /derived projection mismatch/);

  const args = proposalInput(current);
  const proposal = createTradeProposal(args);
  const mismatch = publishCouncilAdvice({ requestId: 'advice-policy', runId: 'run-policy', snapshot: current, policy: null, account: null, proposal, riskReview: null });
  assert.equal(mismatch.status, 'NO_DATA');
  const liveProposal = createTradeProposal({ ...args, provenance: 'live' });
  assert.equal(publishCouncilAdvice({ requestId: 'advice-live', runId: 'run-live', snapshot: current, policy: args.policy, account: args.account, proposal: liveProposal, riskReview: null }).status, 'NO_DATA');

  const advice = publishCouncilAdvice({ requestId: 'advice-audit', runId: 'run-audit', snapshot: current, policy: args.policy, account: args.account, proposal, riskReview: createRiskReview({ reviewId: 'review-no-data', requestId: 'advice-audit', runId: 'run-audit', status: 'NO_DATA', critical: false, reasons: ['missing evidence'], policyVersion: args.policy.policyVersion, snapshotHash: current.hash, leadProposalHash: hashTradeProposal(proposal) }) });
  assert.equal(advice.status, 'NO_DATA');
  assert.equal(advice.proposal, null);
  assert.equal(advice.audit.lead.proposalHash, hashTradeProposal(proposal));
  assert.equal(Object.isFrozen(advice.audit), true);
  const blocked = publishCouncilAdvice({ requestId: 'advice-block', runId: 'run-block', snapshot: current, policy: args.policy, account: args.account, proposal, riskReview: createRiskReview({ reviewId: 'review-block', requestId: 'advice-block', runId: 'run-block', status: 'BLOCK', critical: false, reasons: ['blocked'], policyVersion: args.policy.policyVersion, snapshotHash: current.hash, leadProposalHash: hashTradeProposal(proposal) }) });
  const forgedNoDataBlock = structuredClone(blocked) as typeof blocked;
  forgedNoDataBlock.status = 'NO_DATA';
  assert.throws(() => validateCouncilAdviceResponse(freezeForTest(forgedNoDataBlock)), /blocking risk review requires BLOCKED/);

  const copilot = createCouncilCopilotRequest({ requestId: 'copilot-bind', runId: 'run-bind', snapshot: current, subjectKind: 'proposal', subject: proposal, question: 'Explain.' });
  const forgedEvidence = structuredClone(copilot) as typeof copilot;
  forgedEvidence.snapshotEvidence.rawManifestSha256 = 'f'.repeat(64);
  assert.throws(() => validateCouncilCopilotRequest(freezeForTest(forgedEvidence)), /copilot request snapshot evidence mismatch/);
  const noDataSnapshot = snapshot({ indexPrice: { status: 'invalid', normalizedValue: null } });
  const noDataProposal = createTradeProposal(proposalInput(noDataSnapshot));
  const forgedReadyProposal = { ...noDataProposal, status: 'PROPOSED' as const, stance: 'LONG' as const };
  assert.throws(() => createCouncilCopilotRequest({ requestId: 'copilot-readiness', runId: 'run-readiness', snapshot: noDataSnapshot, subjectKind: 'proposal', subject: forgedReadyProposal, question: 'Explain.' }), /proposal status must be NO_DATA|PROPOSED proposal requires ready snapshot and market/);
  const forgedNoDataProposal = structuredClone(proposal) as typeof proposal;
  forgedNoDataProposal.status = 'NO_DATA';
  forgedNoDataProposal.stance = 'NO_DATA';
  forgedNoDataProposal.suggestedSize = null;
  forgedNoDataProposal.suggestedLeverage = null;
  forgedNoDataProposal.estimatedRiskBounds.maxLoss = null;
  forgedNoDataProposal.estimatedRiskBounds.liquidationDistance = null;
  forgedNoDataProposal.estimatedRiskBounds.marginAtRisk = null;
  forgedNoDataProposal.confidence = null;
  forgedNoDataProposal.horizon = null;
  assert.throws(() => createCouncilCopilotRequest({ requestId: 'copilot-ready-no-data', runId: 'run-ready-no-data', snapshot: current, subjectKind: 'proposal', subject: forgedNoDataProposal, question: 'Explain.' }), /ready snapshot and market require PROPOSED proposal/);
  const boundary = createHostTransportBoundary({ lead: async () => { throw new Error('unused'); }, riskReview: async () => { throw new Error('unused'); }, copilot: async request => copilotResponse(request) });

  const adviceFailure = await invokeCouncilAdvice(boundary, {} as never);
  assert.equal(adviceFailure.status, 'NO_DATA');
  assert.equal(adviceFailure.snapshotEvidence, null);
  assert.equal(adviceFailure.audit.snapshotEvidence, null);
  assert.equal(Object.isFrozen(adviceFailure), true);
  assert.equal(Object.isFrozen(adviceFailure.audit), true);
  assert.equal(Object.isFrozen(adviceFailure.audit.lead), true);
  assert.doesNotThrow(() => validateCouncilAdviceResponse(adviceFailure));
  const copilotFailure = await invokeCouncilCopilot(boundary, {} as never);
  assert.equal(Object.isFrozen(copilotFailure), true);
  assert.equal(copilotFailure.snapshotEvidence, null);
  assert.equal(copilotFailure.status, 'NO_DATA');
  assert.doesNotThrow(() => validateCouncilCopilotResponse(copilotFailure));
});
test('proposal and response ingress reject malformed nullable fields and NO_DATA publication over ready-state contracts', async () => {
  const current = snapshot();
  const args = proposalInput(current);
  const proposal = createTradeProposal(args);
  for (const field of ['liquidationDistance', 'marginAtRisk'] as const) {
    const malformed = structuredClone(proposal) as unknown as Record<string, unknown>;
    const bounds = malformed.estimatedRiskBounds as Record<string, unknown>;
    bounds[field] = 'not-a-decimal';
    assert.throws(() => validateTradeProposal(malformed), /decimal/);
  }
  const badScenario = structuredClone(proposal) as unknown as Record<string, unknown>;
  (badScenario.scenarios as Record<string, unknown>).base = 7;
  assert.throws(() => validateTradeProposal(badScenario), /scenarios\.base/);
  const malformedExpiry = structuredClone(proposal) as unknown as Record<string, unknown>;
  malformedExpiry.expiresAt = null;
  assert.throws(() => validateTradeProposal(malformedExpiry), /expiresAt must be non-empty/);
  const malformedHorizon = structuredClone(proposal) as unknown as Record<string, unknown>;
  malformedHorizon.horizon = 15;
  assert.throws(() => validateTradeProposal(malformedHorizon), /horizon must be non-empty/);
  const malformedInvalidations = structuredClone(proposal) as unknown as Record<string, unknown>;
  malformedInvalidations.invalidations = ['valid', 15];
  assert.throws(() => validateTradeProposal(malformedInvalidations), /invalidations\[1\] must be non-empty/);
  const malformedProvenance = structuredClone(proposal) as unknown as Record<string, unknown>;
  malformedProvenance.provenance = 'fixture';
  assert.throws(() => validateTradeProposal(malformedProvenance), /provenance must be live, synthetic, or historical/);
  const validReview = createRiskReview({ reviewId: 'review-policy', requestId: 'risk-policy', runId: 'run-policy', status: 'PASS', critical: false, reasons: [], policyVersion: args.policy.policyVersion, snapshotHash: current.hash, leadProposalHash: hashTradeProposal(proposal) });
  const malformedReview = structuredClone(validReview) as unknown as Record<string, unknown>;
  malformedReview.policyVersion = 42;
  assert.throws(() => validateRiskReview(malformedReview), /policyVersion/);
  assert.throws(() => createRiskReview({ ...validReview, status: 'PASS', critical: true }), /critical/);
  const badProjectionHash = structuredClone(proposal) as unknown as Record<string, unknown>;
  (badProjectionHash.snapshotEvidence as Record<string, unknown>).normalizedProjectionSha256 = 'x'.repeat(64);
  assert.throws(() => validateTradeProposal(badProjectionHash), /normalizedProjectionSha256/);
  const directEmpty = publishCouncilAdvice({ requestId: 'direct-empty', runId: 'run-direct-empty', snapshot: current, policy: args.policy, account: args.account, proposal: null, riskReview: null });
  assert.equal(directEmpty.status, 'NO_DATA');
  assert.equal(directEmpty.audit.lead.status, 'NOT_CALLED');
  assert.equal(directEmpty.audit.lead.outcome, 'FAILED');
  assert.doesNotThrow(() => validateCouncilAdviceResponse(directEmpty));
  const directPass = publishCouncilAdvice({ requestId: 'direct-pass', runId: 'run-direct-pass', snapshot: current, policy: args.policy, account: args.account, proposal: null, riskReview: createRiskReview({ reviewId: 'review-direct-pass', requestId: 'direct-pass', runId: 'run-direct-pass', status: 'PASS', critical: false, reasons: [], policyVersion: args.policy.policyVersion, snapshotHash: current.hash, leadProposalHash: null }) });
  assert.equal(directPass.status, 'NO_DATA');
  assert.equal(directPass.proposal, null);
  assert.equal(directPass.audit.lead.status, 'NOT_CALLED');
  assert.equal(directPass.audit.lead.outcome, 'FAILED');
  assert.doesNotThrow(() => validateCouncilAdviceResponse(directPass));
  const directBlock = publishCouncilAdvice({ requestId: 'direct-block', runId: 'run-direct-block', snapshot: current, policy: args.policy, account: args.account, proposal: null, riskReview: createRiskReview({ reviewId: 'review-direct-block', requestId: 'direct-block', runId: 'run-direct-block', status: 'BLOCK', critical: false, reasons: ['blocked'], policyVersion: args.policy.policyVersion, snapshotHash: current.hash, leadProposalHash: null }) });
  assert.equal(directBlock.status, 'BLOCKED');
  assert.equal(directBlock.proposal, null);
  assert.equal(directBlock.audit.lead.status, 'NOT_CALLED');
  assert.equal(directBlock.audit.lead.outcome, 'FAILED');
  assert.doesNotThrow(() => validateCouncilAdviceResponse(directBlock));
  const noDataBundle = snapshot({ indexPrice: { status: 'invalid', normalizedValue: null } });
  const noDataProposal = createTradeProposal(proposalInput(noDataBundle));
  const forgedReady = { ...noDataProposal, status: 'PROPOSED' as const, stance: 'LONG' as const };
  const rejectedReady = publishCouncilAdvice({ requestId: 'advice-no-data-ready', runId: 'run-no-data-ready', snapshot: noDataBundle, policy: proposalInput(noDataBundle).policy, account: proposalInput(noDataBundle).account, proposal: forgedReady, riskReview: null });
  assert.equal(rejectedReady.status, 'NO_DATA');
  assert.equal(rejectedReady.audit.lead.status, 'INVALID');
  assert.equal(rejectedReady.audit.lead.outcome, 'FAILED');
  assert.equal(rejectedReady.audit.lead.proposal, null);
  assert.doesNotThrow(() => validateCouncilAdviceResponse(rejectedReady));
  const forgedNoDataOnReady = structuredClone(proposal) as typeof proposal;
  forgedNoDataOnReady.status = 'NO_DATA';
  forgedNoDataOnReady.stance = 'NO_DATA';
  forgedNoDataOnReady.suggestedSize = null;
  forgedNoDataOnReady.suggestedLeverage = null;
  forgedNoDataOnReady.estimatedRiskBounds.maxLoss = null;
  forgedNoDataOnReady.estimatedRiskBounds.liquidationDistance = null;
  forgedNoDataOnReady.estimatedRiskBounds.marginAtRisk = null;
  forgedNoDataOnReady.confidence = null;
  forgedNoDataOnReady.horizon = null;
  const rejectedNoData = publishCouncilAdvice({ requestId: 'advice-ready-no-data', runId: 'run-ready-no-data', snapshot: current, policy: args.policy, account: args.account, proposal: forgedNoDataOnReady, riskReview: null });
  assert.equal(rejectedNoData.status, 'NO_DATA');
  assert.equal(rejectedNoData.audit.lead.status, 'INVALID');
  assert.equal(rejectedNoData.audit.lead.outcome, 'FAILED');
  assert.equal(rejectedNoData.audit.lead.proposal, null);
  assert.doesNotThrow(() => validateCouncilAdviceResponse(rejectedNoData));

  const failureBoundary = createHostTransportBoundary({
    lead: async request => ({ schemaVersion: 1, kind: 'council.lead-response', role: 'lead-specialist', requestId: request.requestId, runId: request.runId, snapshotHash: request.snapshot.hash, proposal, status: 'PROPOSED' }),
    riskReview: async () => { throw new Error('risk transport failed'); },
    copilot: async request => copilotResponse(request),
  });
  const response = await invokeCouncilAdvice(failureBoundary, createCouncilAdviceRequest({ requestId: 'risk-failure-preserve', runId: 'run-risk-failure', snapshot: current, policy: args.policy, account: args.account }));
  assert.equal(response.status, 'NO_DATA');
  assert.equal(response.audit.lead.outcome, 'PROPOSED');
  assert.equal(response.audit.lead.proposalHash, hashTradeProposal(proposal));
  assert.doesNotThrow(() => validateCouncilAdviceResponse(response));
  const forgedAuditIdentity = structuredClone(response) as typeof response;
  forgedAuditIdentity.requestId = 'other-request';
  assert.throws(() => validateCouncilAdviceResponse(freezeForTest(forgedAuditIdentity)), /advice audit identity mismatch/);
});
