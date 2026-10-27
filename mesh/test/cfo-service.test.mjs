import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Keypair, PublicKey } from '@solana/web3.js';
import { MeshError } from '../domain.mjs';
import { deriveWalletOwnerId } from '../wallet-auth.mjs';
import { canonicalBytes, sha256 } from '../council/evidence.ts';
import { createCfoStore } from '../cfo/store.mjs';
import { createCfoService } from '../cfo/service.mjs';
import { COUNCIL_POLICY_VERSION } from '../council/host.mjs';
import { evaluatePlan } from '../cfo/policy.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const RESERVE_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RESERVE = 'nep141:solana:usdc-fixture';
const GT = 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near';
const TLO = 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near';
const GT_BALANCE = '1000000000000000000';
const USDC_BALANCE = '1000000';
const code = expected => error => error instanceof MeshError && error.code === expected;

const assets = [
  { assetId: RESERVE, symbol: 'USDC', decimals: 6, blockchain: 'sol', contractAddress: RESERVE_MINT, kind: 'reserve', protocol: null },
  { assetId: GT, symbol: 'gtUSDCp', decimals: 18, blockchain: 'base', contractAddress: '0x0bb69b79bc829e1cfcc34a740110886d98d2bd14', kind: 'receipt', protocol: null },
  { assetId: TLO, symbol: 'TLO', decimals: 8, blockchain: 'eth', contractAddress: '0x0f38f1ce62776d4a0038bc6cac66877a5687383b', kind: 'receipt', protocol: null },
];

function ownerPortfolio(wallet, blockHeight = 10) {
  return {
    schemaVersion: 1,
    chain: 'near',
    network: 'mainnet',
    wallet,
    signerId: Buffer.from(new PublicKey(wallet).toBytes()).toString('hex'),
    capturedAt: new Date().toISOString(),
    blockHash: 'finalized-fixture-block-' + blockHeight,
    blockHeight,
    assets,
    balances: [
      { assetId: RESERVE, balanceBaseUnits: USDC_BALANCE },
      { assetId: GT, balanceBaseUnits: GT_BALANCE },
      { assetId: TLO, balanceBaseUnits: '0' },
    ],
    status: 'OBSERVED',
    reasons: [],
  };
}
function mandate(wallet, overrides = {}) {
  return {
    schemaVersion: 1,
    wallet,
    reserveAssetId: RESERVE,
    reserveFloorBaseUnits: '0',
    maxActionReserveBaseUnits: '5000000',
    maxPositionBps: 10000,
    slippageBps: 50,
    maxFeeBps: 100,
    maxEvidenceAgeSeconds: 300,
    targets: [{ assetId: GT, weightBps: 10000 }],
    monitorIntervalSeconds: 1,
    maxMonitorCycles: 1,
    ...overrides,
  };
}
function quoteFor(input, signerId) {
  const deadline = input.deadline;
  const amountIn = BigInt(input.amount);
  const origin = assets.find(asset => asset.assetId === input.originAsset);
  const destination = assets.find(asset => asset.assetId === input.destinationAsset);
  const amountOut = amountIn * 10n ** BigInt(destination.decimals) / 10n ** BigInt(origin.decimals);
  if (amountOut <= 0n) throw new Error('Fixture quote amount must be positive.');
  const capturedAt = new Date().toISOString();
  const raw = {
    timestamp: capturedAt,
    quoteRequest: {
      dry: false,
      swapType: 'EXACT_INPUT',
      slippageTolerance: input.slippageBps,
      originAsset: input.originAsset,
      depositType: 'INTENTS',
      destinationAsset: input.destinationAsset,
      amount: input.amount,
      refundTo: signerId,
      refundType: 'INTENTS',
      recipient: signerId,
      recipientType: 'INTENTS',
      deadline,
    },
    quote: {
      amountIn: amountIn.toString(),
      minAmountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      minAmountOut: amountOut.toString(),
      deadline,
      depositAddress: 'fixture-near-deposit-address',
      refundFee: '0',
      withdrawFee: '0',
      signature: 'public-provider-quote-signature',
    },
  };
  return {
    schemaVersion: 1,
    capturedAt,
    raw,
    sha256: sha256(canonicalBytes(raw)),
    signatureVerified: true,
  };
}
function testAdapter(calls) {
  return {
    async assets() { calls.assets += 1; return assets; },
    async capturePortfolio(wallet) { calls.capture += 1; return ownerPortfolio(wallet, 10 + calls.capture); },
    async quote(input) { calls.quote += 1; return quoteFor(input, input.signerId); },
    async generateIntent(quote, signerId) {
      calls.generate += 1;
      return { standard: 'raw_ed25519', payload: JSON.stringify({ signerId, quoteHash: quote.sha256 }) };
    },
    async validateSigned(intent, wallet, signatureBase64) {
      calls.validateSigned += 1;
      return {
        standard: intent.standard,
        payload: intent.payload,
        public_key: 'ed25519:' + Buffer.from(new PublicKey(wallet).toBytes()).toString('hex'),
        signature: 'ed25519:' + signatureBase64,
      };
    },
    async submitIntent() { calls.submit += 1; throw new Error('fixture lost submit reply'); },
    async status() { calls.status += 1; return { status: 'PROCESSING', swapDetails: { nearTxHashes: [] } }; },
    async reconcile() {
      calls.reconcile += 1;
      return { status: 'UNVERIFIED', reason: 'Fixture has no finalized receipt.', providerStatus: null, intentHash: null, nearTxHashes: [], portfolio: null, amounts: null };
    },
  };
}
function fixture(pool) {
  const store = createCfoStore(pool);
  const wallet = Keypair.generate().publicKey.toBase58();
  const owner = deriveWalletOwnerId(wallet);
  const calls = { assets: 0, capture: 0, quote: 0, generate: 0, validateSigned: 0, submit: 0, status: 0, reconcile: 0, review: 0 };
  const adapter = testAdapter(calls);
  const service = options => createCfoService({ store, adapter, ...options });
  return { store, wallet, owner, calls, adapter, service };
}
async function saveMandateAndCapture(service, wallet, inputMandate = mandate(wallet)) {
  await service.saveMandate(deriveWalletOwnerId(wallet), wallet, { requestId: randomUUID(), mandate: inputMandate });
  const capture = await service.capturePortfolio(deriveWalletOwnerId(wallet), wallet, { requestId: randomUUID() });
  assert.equal(capture.data.status, 'OBSERVED');
}
async function waitFor(predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for retained CFO monitor state.');
}
async function retainedFixtureProof(store, owner, wallet) {
  const at = new Date().toISOString();
  const proof = await store.append(owner, {
    requestId: randomUUID(),
    kind: 'devnet-proof',
    data: {
      wallet,
      supplyIntentId: randomUUID(),
      redeemIntentId: randomUUID(),
      explorerEvidence: [
        { signature: 'fixture-supply-signature', url: 'https://nearblocks.io/txns/fixture-supply', capturedAt: at, slot: 10, status: 'finalized', contentSha256: 'a'.repeat(64) },
        { signature: 'fixture-redeem-signature', url: 'https://nearblocks.io/txns/fixture-redeem', capturedAt: at, slot: 11, status: 'finalized', contentSha256: 'b'.repeat(64) },
      ],
    },
  });
  return proof.record;
}

function boundReviewTransport(roles) {
  return {
    async preflight() {
      return {
        schemaVersion: 2, policyVersion: COUNCIL_POLICY_VERSION, status: 'VERIFIED',
        checkedAt: new Date().toISOString(), sdkVersion: '18.12.5', provider: 'openai-codex',
        modelId: 'gpt-6-luna', api: 'openai-codex-responses', effort: 'max',
        endpoint: 'https://chatgpt.com/backend-api/codex/responses', transportMode: 'sse-only',
        bodyAudit: 'PASS', payloadObservationCount: 1, fetchFenceCallCount: 0, providerDispatchCount: 0, reasons: [],
      };
    },
    async call(request) {
      roles.push(request.role);
      const base = {
        schemaVersion: 1, role: request.role, runId: request.runId, callId: request.callId,
        snapshotHash: request.snapshotHash, proposalHash: request.proposal.hash,
        citations: request.sourceRefs.map(ref => ({ ...ref, supports: 'Retained test evidence.' })),
        missingEvidence: [], executionReady: false,
      };
      return request.role === 'lead'
        ? { ...base, status: 'PROPOSED', thesis: 'The fixed test proposal meets the retained limits.', counterCase: 'Protocol and liquidity risks remain.' }
        : { ...base, status: 'PASS', reason: 'The fixed test proposal passes the independent bound review.' };
    },
  };
}

async function reviewedPlan(service, owner, wallet, fields) {
  const input = { requestId: randomUUID(), ...fields };
  let result = await service.planCycle(owner, wallet, input);
  if (result.review?.state === 'PENDING') {
    result = await waitFor(async () => {
      const retained = await service.planCycle(owner, wallet, input);
      return retained.review?.state !== 'PENDING' ? retained : null;
    });
  }
  assert.equal(result.review?.state, 'COMPLETE', JSON.stringify(result.review?.result));
  assert.equal(result.review.result.status, 'REVIEW', JSON.stringify(result.review.result.reasons));
  return result;
}

test('V211/V213: CFO trace preserves same-evidence review, freshness and immutable history', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const f = fixture(pool);
  const roles = [];
  const service = f.service({ reviewOwners: [f.owner], reviewTransport: boundReviewTransport(roles) });
  t.after(async () => { await service.close(); await pool.end(); });
  await saveMandateAndCapture(service, f.wallet);
  const plan = await reviewedPlan(service, f.owner, f.wallet, {
    action: 'invest', sourceAssetId: RESERVE, targetAssetId: GT, inputBaseUnits: '100000',
  });
  assert.equal(plan.review.result.lead.snapshotHash, plan.plan.data.snapshotHash);
  assert.equal(plan.review.result.risk.proposalHash, plan.review.result.lead.proposalHash);
  assert.deepEqual(roles, ['lead', 'risk']);
  const reviewRecord = await service.getRecord(f.owner, f.wallet, plan.review.recordId);
  const beforeTrace = { ...f.calls };
  const traced = await service.getDecisionTrace(f.owner, f.wallet, reviewRecord.id);
  assert.deepEqual(traced.trace.nodes.map(node => node.kind).sort(),
    ['lead', 'mandate', 'plan', 'portfolio', 'quotes', 'review', 'risk']);
  assert.equal(traced.trace.nodes.find(node => node.kind === 'plan').facts.snapshotHash, plan.plan.data.snapshotHash);
  assert.equal(traced.trace.nodes.find(node => node.kind === 'risk').facts.proposalHash, plan.review.result.lead.proposalHash);
  assert.equal(traced.freshness.status, 'FRESH');
  assert.equal(traced.freshness.evidence.find(source => source.kind === 'portfolio').sourceTime, null,
    'capture time cannot stand in for an unavailable chain-event timestamp');
  assert.deepEqual((await service.getDecisionTrace(f.owner, f.wallet, reviewRecord.id)).trace, traced.trace);
  assert.deepEqual(f.calls, beforeTrace, 'trace reads cannot restart provider or model work');
  const serializedTrace = JSON.stringify(traced);
  assert.equal(serializedTrace.includes('public-provider-quote-signature'), false);
  assert.equal(serializedTrace.includes('fixture-near-deposit-address'), false);
  const historical = await service.getDecisionTrace(f.owner, f.wallet, plan.plan.id);
  assert.equal(historical.trace.nodes.some(node => node.kind === 'review'), false,
    'a plan revision cannot adopt a review appended after its cutoff');
  const prepared = await service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: plan.plan.id });
  const preparedRecord = (await service.overview(f.owner, f.wallet)).actions.find(record => record.data.actionId === prepared.actionId);
  const preparedTrace = await service.getDecisionTrace(f.owner, f.wallet, preparedRecord.id);
  assert.equal(preparedTrace.trace.nodes.find(node => node.kind === 'risk').status, 'PASS');
  const retainedReview = await f.store.get(f.owner, reviewRecord.id);
  await f.store.append(f.owner, { requestId: randomUUID(), kind: 'review',
    data: { ...retainedReview.data, state: 'UNKNOWN', phase: 'TERMINAL', result: null, workerId: null, leaseUntil: null } });
  assert.deepEqual((await service.getDecisionTrace(f.owner, f.wallet, preparedRecord.id)).trace, preparedTrace.trace,
    'a later review revision cannot change the review bound to an earlier prepared action');
  // Seed a historical decision with the actual policy evaluator, not a fake database clock.
  const oldAt = '2026-01-01T00:00:00.000Z';
  const oldDeadline = '2026-01-01T00:01:00.000Z';
  const oldSnapshot = structuredClone(plan.plan.data.snapshot);
  oldSnapshot.capturedAt = oldAt;
  oldSnapshot.portfolio.capturedAt = oldAt;
  oldSnapshot.request.requestId = randomUUID();
  const quoteHashes = new Map();
  for (const quote of oldSnapshot.quotes) {
    const priorHash = quote.sha256;
    quote.capturedAt = oldAt;
    quote.raw.timestamp = oldAt;
    quote.raw.quote.deadline = oldDeadline;
    quote.raw.quoteRequest.deadline = oldDeadline;
    quote.sha256 = sha256(canonicalBytes(quote.raw));
    quoteHashes.set(priorHash, quote.sha256);
  }
  const evaluated = evaluatePlan({ portfolio: oldSnapshot.portfolio, mandate: oldSnapshot.mandate,
    request: oldSnapshot.request, quotes: oldSnapshot.quotes, at: oldAt });
  assert.equal(evaluated.status, 'REVIEW');
  Object.assign(oldSnapshot, evaluated);
  const oldRefs = [];
  for (const ref of plan.plan.data.sourceRefs) {
    const source = await f.store.get(f.owner, ref.revisionId);
    if (source.kind === 'mandate') { oldRefs.push(ref); continue; }
    const data = source.kind === 'portfolio' ? oldSnapshot.portfolio
      : { ...source.data, quotes: oldSnapshot.quotes };
    const saved = await f.store.append(f.owner, { requestId: randomUUID(), kind: source.kind, data });
    oldRefs.push({ revisionId: saved.record.id, sha256: saved.record.contentHash });
  }
  const { record: oldPlan } = await f.store.append(f.owner, {
    requestId: oldSnapshot.request.requestId, kind: 'plan',
    data: { ...plan.plan.data, request: oldSnapshot.request, snapshot: oldSnapshot,
      snapshotHash: sha256(canonicalBytes(oldSnapshot)), sourceRefs: oldRefs, reviewJobId: null,
      quoteBindings: plan.plan.data.quoteBindings.map(binding => ({ ...binding, quoteHash: quoteHashes.get(binding.quoteHash) })) },
  });
  const staleTrace = await service.getDecisionTrace(f.owner, f.wallet, oldPlan.id);
  assert.equal(staleTrace.trace.nodes.find(node => node.kind === 'plan').status, 'REVIEW',
    'historical policy is separate from current evidence freshness');
  assert.equal(staleTrace.freshness.status, 'STALE');
  assert.deepEqual((await service.getDecisionTrace(f.owner, f.wallet, reviewRecord.id)).trace, traced.trace,
    'new unavailable observations cannot replace the historical decision evidence');
  await service.overview(f.owner, f.wallet);
  await service.getRecord(f.owner, f.wallet, plan.plan.id);
  assert.deepEqual(roles, ['lead', 'risk'], 'retained reads must not incur another review');
});

test('CFO lifecycle retains an owner-bound deterministic exit and never retries an uncertain relay', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  let firstService;
  let proofRejectedService;
  let executionService;
  t.after(async () => {
    await firstService?.close();
    await proofRejectedService?.close();
    await executionService?.close();
    await pool.end();
  });
  await pool.query('SELECT 1 FROM falcon_mesh.analyses LIMIT 1');
  const f = fixture(pool);
  const otherWallet = Keypair.generate().publicKey.toBase58();
  firstService = f.service({ review: async () => { f.calls.review += 1; throw new Error('Default-deny test must not call reviewers.'); } });
  await saveMandateAndCapture(firstService, f.wallet);

  const beforeOverview = { ...f.calls };
  const overview = await firstService.overview(f.owner, f.wallet);
  assert.equal(overview.readiness.status, 'BLOCKED');
  assert.ok(overview.readiness.reasons.includes('T82_PROOF_UNVERIFIED'));
  assert.deepEqual(f.calls, beforeOverview, 'overview is read-only and makes no provider/model calls');
  await assert.rejects(firstService.overview(f.owner, otherWallet), code('UNAUTHORIZED'));
  const buyPlan = await firstService.planCycle(f.owner, f.wallet, {
    requestId: randomUUID(), action: 'invest', sourceAssetId: RESERVE, targetAssetId: GT, inputBaseUnits: '100000',
  });
  assert.equal(buyPlan.plan.data.status, 'REVIEW', JSON.stringify({ checks: buyPlan.plan.data.snapshot.checks, reasons: buyPlan.plan.data.snapshot.reasons }));
  assert.equal(buyPlan.review.state, 'UNKNOWN', 'a buy without a trusted Lead/Risk grant is retained as NO_DATA');
  assert.equal(buyPlan.review.result.status, 'NO_DATA');
  assert.equal(f.calls.review, 0, 'default-deny reviewer configuration never launches a model call');
  await assert.rejects(firstService.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: buyPlan.plan.id }), code('CONFLICT'));
  assert.equal(f.calls.generate, 0, 'a buy without a bound Lead/Risk PASS cannot be prepared');

  const planResponse = await firstService.planCycle(f.owner, f.wallet, {
    requestId: randomUUID(), action: 'redeem', sourceAssetId: GT, targetAssetId: RESERVE, inputBaseUnits: GT_BALANCE,
  });
  assert.equal(planResponse.plan.data.status, 'REVIEW');
  assert.equal(planResponse.review, null, 'owner-requested deterministic exit has no Lead/Risk dependency');
  const planId = planResponse.plan.id;
  const prepared = await firstService.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId });
  assert.equal(prepared.standard, 'raw_ed25519');
  assert.equal(typeof prepared.payload, 'string');
  const signed = await firstService.registerSignedAction(f.owner, f.wallet, {
    requestId: randomUUID(), actionId: prepared.actionId, signatureBase64: Buffer.alloc(64, 3).toString('base64'),
  });
  assert.equal(signed.status, 'SIGNED');

  await assert.rejects(firstService.relaySignedAction(f.owner, f.wallet, { requestId: randomUUID(), actionId: prepared.actionId }), code('UNAUTHORIZED'));
  assert.equal((await f.store.latestAction(f.owner, prepared.actionId)).data.status, 'SIGNED');
  assert.equal(f.calls.submit, 0);

  // This retained shape is an isolated adapter-boundary fixture only; it is not a real T82 proof or a production readiness signal.
  const proof = await retainedFixtureProof(f.store, f.owner, f.wallet);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const action = await f.store.latestAction(f.owner, prepared.actionId);
  const grants = [{ ownerId: f.owner, wallet: f.wallet, maxReserveBaseUnits: '5000000', expiresAt, devnetProofId: proof.id }];
  const trials = [{
    ownerId: f.owner, wallet: f.wallet, actionId: prepared.actionId, quoteHash: action.data.quote.sha256,
    sourceAssetId: action.data.sourceAssetId, targetAssetId: action.data.targetAssetId,
    inputBaseUnits: action.data.inputBaseUnits, expiresAt, devnetProofId: proof.id,
  }];
  proofRejectedService = f.service({ executionGrants: grants, executionTrials: trials, verifyDevnetProof: async () => false });
  await assert.rejects(
    proofRejectedService.relaySignedAction(f.owner, f.wallet, { requestId: randomUUID(), actionId: prepared.actionId }),
    error => code('UNAUTHORIZED')(error) && error.message.includes('T82_PROOF_UNVERIFIED'),
  );
  assert.equal((await f.store.latestAction(f.owner, prepared.actionId)).data.status, 'SIGNED', 'invalid retained proof cannot advance the action to SUBMISSION_UNKNOWN');
  assert.equal(f.calls.submit, 0, 'false or throwing T82 verifiers deny before the relay call');
  await proofRejectedService.close();
  proofRejectedService = null;
  executionService = f.service({
    executionGrants: grants,
    executionTrials: trials,
    verifyDevnetProof: async ({ owner, wallet, proofId }) => {
      const retained = await f.store.get(owner, proofId);
      return retained?.kind === 'devnet-proof' && retained.data.wallet === wallet;
    },
  });
  const relayRequestId = randomUUID();
  const sent = await executionService.relaySignedAction(f.owner, f.wallet, { requestId: relayRequestId, actionId: prepared.actionId });
  assert.equal(sent.status, 'SUBMISSION_UNKNOWN');
  assert.equal(f.calls.submit, 1);
  assert.equal((await executionService.relaySignedAction(f.owner, f.wallet, { requestId: relayRequestId, actionId: prepared.actionId })).status, 'SUBMISSION_UNKNOWN');
  assert.equal(f.calls.submit, 1, 'a duplicate request never redispatches the signed bytes');
  const uncertainRecord = await f.store.latestAction(f.owner, prepared.actionId);
  const beforeTrace = { ...f.calls };
  const uncertainTrace = await executionService.getDecisionTrace(f.owner, f.wallet, uncertainRecord.id);
  const actionNode = uncertainTrace.trace.nodes.find(node => node.kind === 'action');
  assert.equal(actionNode.status, 'SUBMISSION_UNKNOWN');
  assert.equal(actionNode.facts.signatureRecorded, true);
  assert.equal(actionNode.facts.settlementAmounts, null);
  assert.deepEqual(f.calls, beforeTrace, 'reading uncertain funds cannot reconcile or redispatch');
  assert.equal(JSON.stringify(uncertainTrace).includes(Buffer.alloc(64, 3).toString('base64')), false);

  const reconciliation = await executionService.reconcileAction(f.owner, f.wallet, { requestId: randomUUID(), actionId: prepared.actionId });
  assert.equal(reconciliation.status, 'UNVERIFIED', 'provider status without the exact relay hash cannot confirm settlement');
  assert.equal((await f.store.latestAction(f.owner, prepared.actionId)).data.status, 'UNVERIFIED');
  assert.equal(f.calls.submit, 1);

  const nextPlan = await executionService.planCycle(f.owner, f.wallet, {
    requestId: randomUUID(), action: 'redeem', sourceAssetId: GT, targetAssetId: RESERVE, inputBaseUnits: GT_BALANCE,
  });
  const callsBeforeBlockedPrepare = f.calls.generate;
  await assert.rejects(executionService.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: nextPlan.plan.id }), code('CONFLICT'));
  assert.equal(f.calls.generate, callsBeforeBlockedPrepare, 'unknown funds retain the only owner action slot');
  const after = await executionService.overview(f.owner, f.wallet);
  assert.ok(after.readiness.reasons.includes('SUBMISSION_UNKNOWN_FUNDS_REMAIN_RESERVED') || after.actions[0].data.status === 'UNVERIFIED');
});

test('CFO monitor is explicit, bounded, read-only, and does not resume after service restart', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  let firstService;
  let restartedService;
  t.after(async () => {
    await firstService?.close();
    await restartedService?.close();
    await pool.end();
  });
  await pool.query('SELECT 1 FROM falcon_mesh.analyses LIMIT 1');
  const f = fixture(pool);
  firstService = f.service();
  await saveMandateAndCapture(firstService, f.wallet, mandate(f.wallet, { monitorIntervalSeconds: 1, maxMonitorCycles: 1 }));
  const started = await firstService.setMonitor(f.owner, f.wallet, { requestId: randomUUID(), enabled: true });
  assert.equal(started.enabled, true);
  const complete = await waitFor(async () => {
    const value = await firstService.overview(f.owner, f.wallet);
    return value.monitor.status === 'COMPLETE' ? value : null;
  });
  assert.equal(complete.monitor.cyclesCompleted, 1);
  assert.equal(f.calls.capture, 2, 'one explicit capture plus the single bounded monitor cycle');
  assert.equal(f.calls.generate, 0);
  assert.equal(f.calls.submit, 0);
  assert.equal(f.calls.status, 0);
  assert.equal(f.calls.reconcile, 0);

  await firstService.saveMandate(f.owner, f.wallet, {
    requestId: randomUUID(), mandate: mandate(f.wallet, { monitorIntervalSeconds: 60, maxMonitorCycles: 2 }),
  });
  await firstService.setMonitor(f.owner, f.wallet, { requestId: randomUUID(), enabled: true });
  restartedService = f.service();
  const restartedOverview = await restartedService.overview(f.owner, f.wallet);
  assert.equal(restartedOverview.monitor.enabled, true, 'another live worker may still own the retained lease');
  assert.equal(restartedOverview.monitor.status, 'UNKNOWN', 'a retained lease alone cannot attest to process liveness');
  assert.equal(f.calls.generate, 0);
  assert.equal(f.calls.submit, 0);
});

test('V207: monitor history cannot hide the current mandate, portfolio, plan or prepared action', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const f = fixture(pool);
  const service = f.service();
  t.after(async () => { await service.close(); await pool.end(); });
  await saveMandateAndCapture(service, f.wallet);
  const expectedMandate = await f.store.latest(f.owner, 'mandate');
  const expectedPortfolio = await f.store.latest(f.owner, 'portfolio');
  const plan = await service.planCycle(f.owner, f.wallet, {
    requestId: randomUUID(), action: 'redeem', sourceAssetId: GT, targetAssetId: RESERVE, inputBaseUnits: GT_BALANCE,
  });
  const prepared = await service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: plan.plan.id });
  for (let index = 0; index < 220; index += 1) {
    await f.store.append(f.owner, { requestId: randomUUID(), kind: 'monitor', data: {
      schemaVersion: 1, wallet: f.wallet, enabled: false, processId: randomUUID(),
      cyclesCompleted: 0, maxCycles: 1, intervalSeconds: 1, nextRunAt: null, leaseUntil: null, status: 'STOPPED',
    } });
  }
  const view = await service.overview(f.owner, f.wallet);
  assert.equal(view.mandate?.id, expectedMandate.id);
  assert.equal(view.portfolio?.id, expectedPortfolio.id);
  assert.equal(view.plans.some(record => record.id === plan.plan.id), true);
  assert.equal(view.actions.some(record => record.data.actionId === prepared.actionId), true);
  const repeated = await service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: plan.plan.id });
  assert.equal(repeated.actionId, prepared.actionId);
  assert.equal(f.calls.generate, 1, 'retained preparation must survive unrelated history growth without another generated intent');
});

test('V208: a changed mandate invalidates a previously reviewed buy before intent generation', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const f = fixture(pool);
  const service = f.service({ reviewOwners: [f.owner], reviewTransport: boundReviewTransport([]) });
  t.after(async () => { await service.close(); await pool.end(); });
  await saveMandateAndCapture(service, f.wallet);
  const plan = await reviewedPlan(service, f.owner, f.wallet, {
    action: 'invest', sourceAssetId: RESERVE, targetAssetId: GT, inputBaseUnits: '100000',
  });
  await service.saveMandate(f.owner, f.wallet, { requestId: randomUUID(),
    mandate: mandate(f.wallet, { maxActionReserveBaseUnits: '1' }) });
  await assert.rejects(service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: plan.plan.id }), code('CONFLICT'));
  assert.equal(f.calls.generate, 0);
  assert.equal(f.calls.submit, 0);
});

test('V209: an expired unsigned payload releases its slot without releasing any signed intent', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const f = fixture(pool);
  const service = f.service();
  let laterService;
  t.after(async () => { await service.close(); await laterService?.close(); await pool.end(); });
  await saveMandateAndCapture(service, f.wallet, mandate(f.wallet, { maxEvidenceAgeSeconds: 60 }));
  const plan = await service.planCycle(f.owner, f.wallet, {
    requestId: randomUUID(), action: 'redeem', sourceAssetId: GT, targetAssetId: RESERVE, inputBaseUnits: GT_BALANCE,
  });
  const prepared = await service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: plan.plan.id });
  const expiredAt = new Date(Date.parse(prepared.expiresAt) + 1).toISOString();
  laterService = createCfoService({ store: { ...f.store, clock: async () => expiredAt }, adapter: f.adapter });
  await laterService.overview(f.owner, f.wallet);
  const ended = await f.store.latestAction(f.owner, prepared.actionId);
  assert.equal(ended.data.status, 'FAILED');
  assert.equal(ended.data.signedData, null);
  assert.equal(f.calls.submit, 0);
  assert.equal(f.calls.validateSigned, 0);
});

test('retained reserve-floor alerts use observed units and never launch financial work', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const f = fixture(pool);
  const service = f.service();
  t.after(async () => { await service.close(); await pool.end(); });
  await saveMandateAndCapture(service, f.wallet, mandate(f.wallet, { reserveFloorBaseUnits: '500000' }));
  assert.deepEqual((await service.overview(f.owner, f.wallet)).monitor.alerts, []);
  f.adapter.capturePortfolio = async wallet => {
    const result = ownerPortfolio(wallet);
    result.balances[0].balanceBaseUnits = '200000';
    return result;
  };
  const capture = await service.capturePortfolio(f.owner, f.wallet, { requestId: randomUUID() });
  const view = await service.overview(f.owner, f.wallet);
  assert.deepEqual(view.monitor.alerts.map(alert => alert.code), ['RESERVE_BELOW_FLOOR']);
  assert.equal(view.monitor.alerts[0].portfolioId, capture.id);
  assert.equal(f.calls.generate, 0);
  assert.equal(f.calls.submit, 0);
  assert.equal(f.calls.review, 0);
});

async function rotationAfterExit(t, { failEntryQuote = false, reviewAllowed = true } = {}) {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const f = fixture(pool);
  const roles = [];
  let exited = false;
  f.adapter.capturePortfolio = async wallet => {
    f.calls.capture += 1;
    const portfolio = ownerPortfolio(wallet, exited ? 20 : 10);
    portfolio.balances[0].balanceBaseUnits = exited ? '15000000' : '10000000';
    portfolio.balances[1].balanceBaseUnits = exited ? '0' : '5000000000000000000';
    return portfolio;
  };
  const quote = f.adapter.quote;
  f.adapter.quote = async input => {
    if (exited && failEntryQuote) throw new Error('The entry route is unavailable.');
    return quote(input);
  };
  const service = f.service({
    reviewOwners: reviewAllowed ? [f.owner] : [],
    reviewTransport: boundReviewTransport(roles),
  });
  t.after(async () => { await service.close(); await pool.end(); });
  await saveMandateAndCapture(service, f.wallet, mandate(f.wallet, {
    reserveFloorBaseUnits: '5000000', targets: [{ assetId: TLO, weightBps: 10000 }],
  }));
  const plan = await service.planCycle(f.owner, f.wallet, {
    requestId: randomUUID(), action: 'rotate', sourceAssetId: GT, targetAssetId: TLO, inputBaseUnits: '5000000000000000000',
  });
  assert.equal(plan.plan.data.status, 'REVIEW', JSON.stringify(plan.plan.data.snapshot.checks));
  const prepared = await service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: plan.plan.id });
  await service.registerSignedAction(f.owner, f.wallet, {
    requestId: randomUUID(), actionId: prepared.actionId, signatureBase64: Buffer.alloc(64, 7).toString('base64'),
  });
  const signed = await f.store.latestAction(f.owner, prepared.actionId);
  // Isolated adapter-boundary receipt fixture. Real dispatch authorization is covered separately.
  await f.store.append(f.owner, { requestId: randomUUID(), kind: 'action', expectedHeadId: signed.id, data: { ...signed.data, status: 'SUBMISSION_UNKNOWN' } });
  exited = true;
  f.adapter.reconcile = async () => ({
    status: 'CONFIRMED', intentHash: 'fixture-confirmed-exit', providerStatus: null,
    nearTxHashes: ['fixture-finalized-exit'], portfolio: await f.adapter.capturePortfolio(f.wallet),
    amounts: { debit: { assetId: GT, baseUnits: '5000000000000000000' }, credit: { assetId: RESERVE, baseUnits: '5000000' } },
  });
  await service.reconcileAction(f.owner, f.wallet, { requestId: randomUUID(), actionId: prepared.actionId });
  return { ...f, service, roles, plan, prepared };
}

test('V209: rotation requires a fresh reviewed and separately signed entry after a confirmed exit', { skip: !databaseUrl }, async t => {
  const f = await rotationAfterExit(t);
  let action = await f.store.latestAction(f.owner, f.prepared.actionId);
  assert.equal(action.data.status, 'AWAITING_NEXT_LEG');
  await waitFor(async () => (await f.service.overview(f.owner, f.wallet)).plans.find(plan => plan.id === action.data.nextPlanId)?.review?.state === 'COMPLETE');
  assert.deepEqual(f.roles, ['lead', 'risk']);
  const prepared = await f.service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: f.plan.plan.id });
  action = await f.store.latestAction(f.owner, prepared.actionId);
  assert.equal(action.data.leg, 1);
  assert.equal(action.data.sourceAssetId, RESERVE);
  assert.equal(action.data.targetAssetId, TLO);
  assert.equal(action.data.inputBaseUnits, '5000000');
  assert.equal(action.data.signatureBase64, null, 'an exit signature cannot authorize the entry');
  assert.equal(f.calls.submit, 0);
  await f.service.registerSignedAction(f.owner, f.wallet, {
    requestId: randomUUID(), actionId: prepared.actionId, signatureBase64: Buffer.alloc(64, 8).toString('base64'),
  });
  action = await f.store.latestAction(f.owner, prepared.actionId);
  await f.store.append(f.owner, { requestId: randomUUID(), kind: 'action', expectedHeadId: action.id, data: { ...action.data, status: 'SUBMISSION_UNKNOWN' } });
  f.adapter.reconcile = async () => {
    const portfolio = ownerPortfolio(f.wallet, 30);
    portfolio.balances = [{ assetId: RESERVE, balanceBaseUnits: '10000000' }, { assetId: GT, balanceBaseUnits: '0' }, { assetId: TLO, balanceBaseUnits: '500000000' }];
    return {
      status: 'CONFIRMED', intentHash: 'fixture-confirmed-entry', providerStatus: null, nearTxHashes: ['fixture-finalized-entry'], portfolio,
      amounts: { debit: { assetId: RESERVE, baseUnits: '5000000' }, credit: { assetId: TLO, baseUnits: '500000000' } },
    };
  };
  await f.service.reconcileAction(f.owner, f.wallet, { requestId: randomUUID(), actionId: prepared.actionId });
  action = await f.store.latestAction(f.owner, prepared.actionId);
  assert.equal(action.data.status, 'CONFIRMED');
  assert.equal(action.data.rotationState, 'COMPLETE');
});

test('V208/V209: rotation cannot spend a reviewed five units after reserve falls from fifteen to seven with a five-unit floor', { skip: !databaseUrl }, async t => {
  const f = await rotationAfterExit(t);
  const action = await f.store.latestAction(f.owner, f.prepared.actionId);
  await waitFor(async () => (await f.service.overview(f.owner, f.wallet)).plans.find(plan => plan.id === action.data.nextPlanId)?.review?.state === 'COMPLETE');
  const portfolio = ownerPortfolio(f.wallet, 25);
  portfolio.balances = [{ assetId: RESERVE, balanceBaseUnits: '7000000' }, { assetId: GT, balanceBaseUnits: '0' }, { assetId: TLO, balanceBaseUnits: '0' }];
  await f.store.append(f.owner, { requestId: randomUUID(), kind: 'portfolio', data: portfolio });
  const generatedBefore = f.calls.generate;
  await assert.rejects(f.service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: f.plan.plan.id }), code('CONFLICT'));
  assert.equal(f.calls.generate, generatedBefore);
  const closed = await f.store.latestAction(f.owner, f.prepared.actionId);
  assert.equal(closed.data.status, 'FAILED');
  assert.equal(closed.data.rotationState, 'INCOMPLETE');
  assert.equal(closed.data.intentHash, 'fixture-confirmed-exit', 'closing the workflow must preserve the confirmed exit receipt');
});

for (const options of [{ failEntryQuote: true }, { reviewAllowed: false }]) {
  test(`confirmed exit closes an unusable unsigned entry without locking the owner slot: ${JSON.stringify(options)}`, { skip: !databaseUrl }, async t => {
    const f = await rotationAfterExit(t, options);
    const overview = await f.service.overview(f.owner, f.wallet);
    const action = await f.store.latestAction(f.owner, f.prepared.actionId);
    assert.equal(action.data.status, 'FAILED');
    assert.equal(action.data.rotationState, 'INCOMPLETE');
    assert.equal(action.data.leg, 0);
    assert.equal(action.data.intentHash, 'fixture-confirmed-exit');
    assert.equal(f.calls.generate, 1, 'only the already confirmed exit was prepared');
    assert.equal(f.calls.submit, 0);
    assert.equal(overview.actions[0].data.rotationState, 'INCOMPLETE');
    const portfolio = ownerPortfolio(f.wallet, 40);
    portfolio.balances = [{ assetId: RESERVE, balanceBaseUnits: '15000000' }, { assetId: GT, balanceBaseUnits: GT_BALANCE }, { assetId: TLO, balanceBaseUnits: '0' }];
    await f.store.append(f.owner, { requestId: randomUUID(), kind: 'portfolio', data: portfolio });
    f.adapter.quote = async input => quoteFor(input, input.signerId);
    const replacement = await f.service.planCycle(f.owner, f.wallet, { requestId: randomUUID(), action: 'redeem', sourceAssetId: GT, targetAssetId: RESERVE, inputBaseUnits: GT_BALANCE });
    const prepared = await f.service.prepareAction(f.owner, f.wallet, { requestId: randomUUID(), planId: replacement.plan.id });
    assert.notEqual(prepared.actionId, f.prepared.actionId, 'a failed unsigned entry must release the owner action slot');
  });
}

test('V209: a retained confirmed exit survives restart and releases only its unsigned missing entry after the planning lease', { skip: !databaseUrl }, async t => {
  const f = await rotationAfterExit(t);
  const action = await f.store.latestAction(f.owner, f.prepared.actionId);
  await waitFor(async () => (await f.service.overview(f.owner, f.wallet)).plans.find(plan => plan.id === action.data.nextPlanId)?.review?.state === 'COMPLETE');
  await f.service.close();
  const retainedExit = await f.store.append(f.owner, {
    requestId: randomUUID(), kind: 'action', expectedHeadId: action.id,
    data: { ...action.data, status: 'EXIT_CONFIRMED', nextPlanId: null },
  });
  const restarted = createCfoService({ store: f.store, adapter: f.adapter });
  t.after(() => restarted.close());
  const before = { ...f.calls };
  assert.equal((await restarted.overview(f.owner, f.wallet)).actions[0].data.status, 'EXIT_CONFIRMED');
  f.store.clock = async () => new Date(Date.parse(retainedExit.record.createdAt) + 120_001).toISOString();
  const recovered = (await restarted.overview(f.owner, f.wallet)).actions[0].data;
  assert.equal(recovered.status, 'FAILED');
  assert.equal(recovered.rotationState, 'INCOMPLETE');
  assert.equal(recovered.intentHash, 'fixture-confirmed-exit');
  assert.equal(recovered.leg, 0);
  assert.deepEqual(f.calls, before, 'read-only recovery must not capture, review, sign or relay');
});
