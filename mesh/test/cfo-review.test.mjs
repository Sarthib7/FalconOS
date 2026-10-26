import { Keypair } from '@solana/web3.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBytes, sha256 } from '../council/evidence.ts';
import { COUNCIL_MODEL, COUNCIL_POLICY_VERSION, COUNCIL_REASONING_EFFORT } from '../council/host.mjs';
import { runCfoReview } from '../cfo/review.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REVISION_ID = '22222222-2222-4222-8222-222222222222';
const AT = '2026-10-26T12:00:00.000Z';
const WALLET_KEY = Keypair.fromSeed(Buffer.alloc(32));
const WALLET = WALLET_KEY.publicKey.toBase58();
const SIGNER = WALLET_KEY.publicKey.toBuffer().toString('hex');
const REF = { revisionId: REVISION_ID, sha256: 'a'.repeat(64) };
const proposal = {
  action: 'invest',
  sourceAssetId: 'reserve-usdc',
  targetAssetId: 'receipt-token',
  inputBaseUnits: '1000000',
  reason: 'Within current reserve and mandate caps.',
  expiresAt: '2026-10-26T12:10:00.000Z',
};

function snapshot({ action = 'invest', status = 'REVIEW' } = {}) {
  const nextProposal = { ...proposal, action };
  return {
    schemaVersion: 1,
    domain: 'cfo',
    capturedAt: AT,
    portfolio: { status: 'OBSERVED', wallet: WALLET, signerId: SIGNER },
    mandate: { schemaVersion: 1, wallet: WALLET },
    mandateHash: 'b'.repeat(64),
    request: { requestId: RUN_ID, action, sourceAssetId: proposal.sourceAssetId, targetAssetId: proposal.targetAssetId, inputBaseUnits: proposal.inputBaseUnits },
    quotes: [],
    proposal: nextProposal,
    checks: [{ id: 'policy', status: 'PASS', detail: 'Deterministic checks passed.' }],
    reasons: [],
    status,
  };
}

function preflight() {
  return {
    schemaVersion: 2,
    policyVersion: COUNCIL_POLICY_VERSION,
    status: 'VERIFIED',
    checkedAt: AT,
    sdkVersion: '18.12.5',
    provider: 'openai-codex',
    modelId: COUNCIL_MODEL,
    api: 'openai-codex-responses',
    effort: COUNCIL_REASONING_EFFORT,
    endpoint: 'https://chatgpt.com/backend-api/codex/responses',
    transportMode: 'sse-only',
    bodyAudit: 'PASS',
    payloadObservationCount: 1,
    fetchFenceCallCount: 0,
    providerDispatchCount: 0,
    reasons: [],
  };
}

function citation() {
  return { revisionId: REF.revisionId, sha256: REF.sha256, supports: 'The retained CFO record supports this bounded review.' };
}

function lead(request, overrides = {}) {
  return {
    schemaVersion: 1,
    role: 'lead',
    runId: request.runId,
    callId: request.callId,
    snapshotHash: request.snapshotHash,
    proposalHash: request.proposal.hash,
    status: 'PROPOSED',
    thesis: 'The deterministic purchase fits the supplied mandate and evidence.',
    counterCase: 'The receipt asset retains protocol and liquidity risk.',
    citations: [citation()],
    missingEvidence: [],
    executionReady: false,
    ...overrides,
  };
}

function risk(request, overrides = {}) {
  return {
    schemaVersion: 1,
    role: 'risk',
    runId: request.runId,
    callId: request.callId,
    snapshotHash: request.snapshotHash,
    proposalHash: request.proposal.hash,
    status: 'PASS',
    reason: 'No cited risk veto applies to the deterministic proposal.',
    citations: [citation()],
    missingEvidence: [],
    executionReady: false,
    ...overrides,
  };
}

function setup({ action = 'invest', onCall } = {}) {
  const frozen = snapshot({ action });
  const snapshotHash = sha256(canonicalBytes(frozen));
  const calls = [];
  const transport = {
    async preflight({ auditRequest }) {
      calls.push({ operation: 'preflight', request: auditRequest });
      return preflight();
    },
    async call(request) {
      calls.push({ operation: 'call', request });
      if (onCall) return onCall(request, calls.filter(call => call.operation === 'call').length);
      return request.role === 'lead' ? lead(request) : risk(request);
    },
  };
  return { snapshot: frozen, snapshotHash, calls, transport };
}

function options(fixture) {
  return { runId: RUN_ID, snapshot: fixture.snapshot, snapshotHash: fixture.snapshotHash, sourceRefs: [REF], transport: fixture.transport, now: () => AT };
}

test('CFO Lead and Risk bind the same snapshot and immutable proposal on distinct calls', async () => {
  const fixture = setup();
  const result = await runCfoReview(options(fixture));
  const modelCalls = fixture.calls.filter(call => call.operation === 'call').map(call => call.request);
  assert.equal(result.status, 'REVIEW');
  assert.deepEqual(result.proposal, fixture.snapshot.proposal);
  assert.equal(modelCalls.length, 2);
  assert.notEqual(modelCalls[0].callId, modelCalls[1].callId);
  for (const request of modelCalls) {
    assert.equal(request.snapshotHash, fixture.snapshotHash);
    assert.deepEqual(request.snapshot, fixture.snapshot);
    assert.deepEqual(request.proposal, { hash: sha256(canonicalBytes(fixture.snapshot.proposal)), value: fixture.snapshot.proposal });
  }
  assert.equal(result.executionReady, false);
});

test('CFO review rejects output bound to another snapshot', async () => {
  const fixture = setup({ onCall: request => request.role === 'lead'
    ? lead(request, { snapshotHash: 'f'.repeat(64) })
    : risk(request) });
  const result = await runCfoReview(options(fixture));
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.proposal, null);
});

test('Risk veto blocks without changing the deterministic financial proposal', async () => {
  const fixture = setup({ onCall: (request, count) => request.role === 'lead'
    ? lead(request)
    : risk(request, { status: 'BLOCKED', reason: 'The retained evidence shows a concrete redemption-liquidity failure.' }) });
  const result = await runCfoReview(options(fixture));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.proposal, null);
  assert.equal(result.risk.status, 'BLOCKED');
});

test('deterministic exit does not need a model grant or host', async () => {
  const fixture = setup({ action: 'redeem' });
  const result = await runCfoReview({ ...options(fixture), transport: null });
  assert.equal(result.status, 'REVIEW');
  assert.deepEqual(result.proposal, fixture.snapshot.proposal);
  assert.equal(result.lead, null);
  assert.equal(result.risk, null);
});

test('buy review without a trusted host remains NO_DATA', async () => {
  const fixture = setup();
  const result = await runCfoReview({ ...options(fixture), transport: null });
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.proposal, null);
});
