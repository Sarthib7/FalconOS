import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MeshError } from '../domain.mjs';
import { canonicalBytes, sha256 } from '../council/evidence.ts';
import { COUNCIL_MODEL, COUNCIL_POLICY_VERSION, COUNCIL_REASONING_EFFORT } from '../council/host.mjs';
import { createResearchReviewService } from '../research/review-jobs.mjs';

const NOW = '2026-10-21T14:00:00.000Z';
const owner = () => 'review_service_' + randomUUID().replaceAll('-', '');
const analysisId = randomUUID();
const requestId = () => randomUUID();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function retainedSnapshot() {
  const sourceRefs = [{ revisionId: randomUUID(), sha256: 'a'.repeat(64) }];
  const modelResult = {
    modelVersion: 'near-observed/1',
    status: 'OBSERVED',
    seriesSummaries: { retainedSeries: { sampleCount: 1, current: '12.5' } },
    unknowns: [],
    counterCase: ['Publisher-reported activity is not independent evidence of native-token demand.'],
    investmentAssessment: { status: 'REVIEW', reasons: [], proposal: null },
    executionReady: false,
  };
  const snapshot = {
    schemaVersion: 1,
    domain: 'near-thesis',
    adapterVersion: 'near-revenue/1',
    sourceUrl: 'https://revenue.near.org/',
    capturedAt: NOW,
    rawBodySha256: 'b'.repeat(64),
    rawBodyBytes: 1024,
    sourceRefs,
    modelVersion: 'near-observed/1',
    modelResult,
  };
  return { snapshot, modelResult, sourceRefs, snapshotHash: sha256(canonicalBytes(snapshot)) };
}

function envelope(job, overrides = {}) {
  return {
    schemaVersion: 1,
    jobId: job.jobId,
    requestId: job.requestId,
    analysisId: job.analysisId,
    snapshotHash: job.snapshotHash,
    state: 'PENDING',
    phase: 'PREFLIGHT',
    result: null,
    executionReady: false,
    ...overrides,
  };
}

function controllerResult(job, overrides = {}) {
  return {
    schemaVersion: 1,
    runId: job.jobId,
    snapshotHash: job.snapshotHash,
    lead: null,
    risk: null,
    status: 'NO_DATA',
    proposal: null,
    reasons: ['Synthetic controller result for unit-only service wiring.'],
    executionReady: false,
    ...overrides,
  };
}

function memoryStore({ existing = null } = {}) {
  const saved = retainedSnapshot();
  const state = {
    current: existing,
    claims: 0,
    finishes: 0,
    phases: [],
    snapshot: saved.snapshot,
    calls: 0,
  };
  const store = {
    async lookup(scope, input) {
      if (state.current && state.current.requestId === input.requestId && state.current.analysisId === input.analysisId) return state.current;
      return null;
    },
    async claim(scope, input) {
      if (state.current) return { job: state.current, claimed: false, snapshot: null };
      state.claims += 1;
      const job = envelope({
        jobId: randomUUID(), requestId: input.requestId, analysisId: input.analysisId, snapshotHash: saved.snapshotHash,
      });
      state.current = job;
      return { job, claimed: true, snapshot: saved.snapshot };
    },
    async phase(scope, jobId, phase) {
      state.phases.push(phase);
      if (state.current?.jobId === jobId && state.current.state === 'PENDING') {
        state.current = { ...state.current, phase: state.current.phase === 'PREFLIGHT' || phase !== 'PREFLIGHT' ? phase : state.current.phase };
      }
      return state.current;
    },
    async finish(scope, jobId, result) {
      state.finishes += 1;
      state.current = { ...state.current, state: 'COMPLETE', phase: 'TERMINAL', result };
      return state.current;
    },
  };
  return { store, state };
}

async function until(predicate, message = 'condition did not settle') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await wait(5);
  }
  assert.fail(message);
}

function unitPreflight() {
  // Synthetic in-process values make a unit-test transport only; they prove no host isolation.
  return {
    status: 'VERIFIED',
    policyVersion: COUNCIL_POLICY_VERSION,
    requestedModel: COUNCIL_MODEL,
    requestedReasoningEffort: COUNCIL_REASONING_EFFORT,
    executableVersion: '0.160.0',
    checkedAt: NOW,
    policyHash: 'c'.repeat(64),
    verifiedControls: {
      userConfigIsolated: true,
      webSearchDisabled: true,
      commandToolsDisabled: true,
      patchToolsDisabled: true,
      inheritedMcpDisabled: true,
      readOnlySandbox: true,
      boundedIO: true,
      controlledProbePassed: true,
    },
    reasons: [],
  };
}

function cite(ref) { return { revisionId: ref.revisionId, sha256: ref.sha256, supports: 'Retained row supports this bounded statement.' }; }

function leadFor(request) {
  return {
    schemaVersion: 1,
    role: 'lead',
    runId: request.runId,
    callId: request.callId,
    snapshotHash: request.snapshotHash,
    status: 'PROPOSED',
    thesis: 'Observed publisher activity supports research only.',
    counterCase: 'Native-token demand remains unverified.',
    citations: [cite(request.sourceRefs[0])],
    proposal: { summary: 'Continue research only.', conditions: ['Verify demand independently.'] },
    missingEvidence: [],
    executionReady: false,
  };
}

function riskFor(request) {
  return {
    schemaVersion: 1,
    role: 'risk',
    runId: request.runId,
    callId: request.callId,
    snapshotHash: request.snapshotHash,
    proposalHash: request.proposal.hash,
    status: 'BLOCKED',
    reason: 'Independent review found the proposal is unsupported.',
    citations: [cite(request.sourceRefs[0])],
    missingEvidence: [],
    executionReady: false,
  };
}

test('concurrent same-ID calls read one retained claim and only its claimant starts background work', async () => {
  const { store, state } = memoryStore();
  const scope = owner();
  const input = { requestId: requestId(), analysisId };
  let finishReview;
  const started = [];
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [scope],
    runDeadlineMs: 5000,
    now: () => NOW,
    review: options => {
      started.push(options);
      return new Promise(resolve => { finishReview = resolve; });
    },
  });

  const [left, right] = await Promise.all([service.review(scope, input), service.review(scope, input)]);
  assert.deepEqual(left, right);
  assert.equal(left.state, 'PENDING');
  assert.equal(state.claims, 1);
  await until(() => started.length === 1, 'the single claimed background review should start');
  assert.equal(started[0].runId, left.jobId);
  assert.equal(started[0].snapshotHash, left.snapshotHash);
  assert.strictEqual(started[0].snapshot, state.snapshot);
  finishReview(controllerResult(left, { reasons: ['Unit-only run completed.'] }));
  await until(() => state.current.state === 'COMPLETE');
  assert.equal(state.finishes, 1);
  await service.close();
});

test('ungranted owners may read existing jobs but cannot claim new work or call the controller', async () => {
  const scope = owner();
  const saved = retainedSnapshot();
  const existing = envelope({ jobId: randomUUID(), requestId: requestId(), analysisId, snapshotHash: saved.snapshotHash });
  const readOnly = memoryStore({ existing });
  let reviewCalls = 0;
  const existingService = createResearchReviewService({
    jobStore: readOnly.store,
    allowedOwners: [],
    runDeadlineMs: 1000,
    review: async () => { reviewCalls += 1; return controllerResult(existing); },
  });
  assert.deepEqual(await existingService.review(scope, { requestId: existing.requestId, analysisId }), existing);
  assert.equal(readOnly.state.claims, 0);
  assert.equal(reviewCalls, 0);
  await existingService.close();

  const denied = memoryStore();
  const deniedService = createResearchReviewService({
    jobStore: denied.store,
    allowedOwners: new Set(),
    runDeadlineMs: 1000,
    review: async () => { reviewCalls += 1; return controllerResult(denied.state.current); },
  });
  await assert.rejects(
    deniedService.review(scope, { requestId: requestId(), analysisId }),
    error => error instanceof MeshError && error.code === 'FORBIDDEN',
  );
  assert.equal(denied.state.claims, 0);
  assert.equal(reviewCalls, 0);
  await deniedService.close();
});

test('the real Council controller persists a bound NO_DATA result when preflight cannot be trusted', async () => {
  const { store, state } = memoryStore();
  const scope = owner();
  let modelCalls = 0;
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [scope],
    runDeadlineMs: 5000,
    now: () => NOW,
    transport: {
      async preflight() { return {}; },
      async call() { modelCalls += 1; throw new Error('model call must not run without preflight'); },
    },
  });
  const job = await service.review(scope, { requestId: requestId(), analysisId });
  assert.equal(job.state, 'PENDING');
  await until(() => state.current.state === 'COMPLETE');
  assert.equal(modelCalls, 0);
  assert.equal(state.current.result.status, 'NO_DATA');
  assert.equal(state.current.result.runId, job.jobId);
  assert.equal(state.current.result.snapshotHash, job.snapshotHash);
  assert.equal(state.current.result.proposal, null);
  assert.deepEqual(state.phases, ['PREFLIGHT']);
  await service.close();
});

test('synthetic unit-only transport preserves source binding and Risk vetoes the proposal', async () => {
  const { store, state } = memoryStore();
  const scope = owner();
  const calls = [];
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [scope],
    runDeadlineMs: 5000,
    now: () => NOW,
    transport: {
      async preflight() { return unitPreflight(); },
      async call(request) {
        calls.push(request);
        return request.role === 'lead' ? leadFor(request) : riskFor(request);
      },
    },
  });
  const job = await service.review(scope, { requestId: requestId(), analysisId });
  await until(() => state.current.state === 'COMPLETE');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.role), ['lead', 'risk']);
  assert.equal(calls[0].runId, job.jobId);
  assert.equal(calls[1].runId, job.jobId);
  assert.equal(calls[0].snapshotHash, job.snapshotHash);
  assert.equal(calls[1].snapshotHash, job.snapshotHash);
  assert.deepEqual(calls[0].sourceRefs, state.snapshot.sourceRefs);
  assert.deepEqual(calls[1].sourceRefs, state.snapshot.sourceRefs);
  assert.notEqual(calls[0].callId, calls[1].callId);
  assert.equal(calls[1].proposal.hash, sha256(canonicalBytes(leadFor(calls[0]).proposal)));
  assert.equal(state.current.result.status, 'BLOCKED');
  assert.equal(state.current.result.risk.status, 'BLOCKED');
  assert.equal(state.current.result.proposal, null);
  assert.deepEqual(state.phases, ['PREFLIGHT', 'LEAD', 'RISK']);
  await service.close();
});

test('close stops new work, drains boundedly, and late completion cannot write to a closing pool', async () => {
  const { store, state } = memoryStore();
  const scope = owner();
  let releaseReview;
  let hostClosed = 0;
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [scope],
    runDeadlineMs: 5000,
    review: () => new Promise(resolve => { releaseReview = resolve; }),
    transport: { async close() { hostClosed += 1; } },
  });
  const job = await service.review(scope, { requestId: requestId(), analysisId });
  await until(() => typeof releaseReview === 'function');
  await service.close();
  assert.equal(hostClosed, 1);
  releaseReview(controllerResult(job));
  await wait(10);
  assert.equal(state.finishes, 0);
  await service.close();
});
