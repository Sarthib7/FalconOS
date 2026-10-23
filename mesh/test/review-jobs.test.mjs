import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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

function memoryStore({ existing = null, remainingForOwner = null, sampledAgeMs = 0 } = {}) {
  const saved = retainedSnapshot();
  const state = {
    current: existing,
    jobs: new Map(),
    claims: 0,
    finishes: 0,
    phases: [],
    snapshot: saved.snapshot,
    calls: 0,
  };
  const current = scope => state.jobs.get(scope) ?? (state.jobs.size === 0 ? state.current : null);
  const retain = (scope, job) => {
    state.jobs.set(scope, job);
    if (state.current === null || state.current.jobId === job.jobId) state.current = job;
  };
  const store = {
    async lookup(scope, input) {
      const job = current(scope);
      if (job && job.requestId === input.requestId && job.analysisId === input.analysisId) return job;
      return null;
    },
    async claim(scope, input) {
      const existingJob = current(scope);
      if (existingJob) return { job: existingJob, claimed: false, snapshot: null };
      state.claims += 1;
      const job = envelope({
        jobId: randomUUID(), requestId: input.requestId, analysisId: input.analysisId, snapshotHash: saved.snapshotHash,
      });
      retain(scope, job);
      const budget = remainingForOwner ? remainingForOwner(scope, input) : input.runDeadlineMs;
      const age = typeof sampledAgeMs === 'function' ? sampledAgeMs(scope, input) : sampledAgeMs;
      return {
        job,
        claimed: true,
        snapshot: saved.snapshot,
        deadlineAt: new Date(Date.parse(NOW) + input.runDeadlineMs).toISOString(),
        remainingMs: budget,
        sampledAtMonotonicMs: performance.now() - age,
      };
    },
    async phase(scope, jobId, phase) {
      state.phases.push(phase);
      const job = current(scope);
      if (job?.jobId === jobId && job.state === 'PENDING') {
        retain(scope, { ...job, phase: job.phase === 'PREFLIGHT' || phase !== 'PREFLIGHT' ? phase : job.phase });
      }
      return current(scope);
    },
    async finish(scope, jobId, result) {
      state.finishes += 1;
      const job = current(scope);
      if (job?.jobId !== jobId) return job;
      const finished = { ...job, state: 'COMPLETE', phase: 'TERMINAL', result };
      retain(scope, finished);
      return finished;
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
    schemaVersion: 2,
    policyVersion: COUNCIL_POLICY_VERSION,
    status: 'VERIFIED',
    checkedAt: NOW,
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

test('synthetic unit-only transport preserves source binding and Risk vetoes the proposal', async t => {
  // V187: simulate an older sample without depending on process uptime.
  const monotonicNow = performance.now.bind(performance);
  t.mock.method(performance, 'now', () => monotonicNow() + 1000);
  const { store, state } = memoryStore({ sampledAgeMs: 250 });
  const scope = owner();
  const calls = [];
  const preflightOptions = [];
  const callOptions = [];
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [scope],
    runDeadlineMs: 5000,
    now: () => NOW,
    transport: {
      async preflight(options) { preflightOptions.push(options); return unitPreflight(); },
      async call(request, options) {
        calls.push(request);
        callOptions.push(options);
        return request.role === 'lead' ? leadFor(request) : riskFor(request);
      },
    },
  });
  const job = await service.review(scope, { requestId: requestId(), analysisId });
  await until(() => state.current.state === 'COMPLETE');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.role), ['lead', 'risk']);
  assert.equal(preflightOptions.length, 1);
  assert.strictEqual(preflightOptions[0].auditRequest, calls[0]);
  assert.equal(preflightOptions[0].auditRequest.role, 'lead');
  assert.equal(preflightOptions[0].signal, callOptions[0].signal);
  assert.equal(callOptions[0].signal, callOptions[1].signal);
  assert.ok(callOptions.every(options => Number.isInteger(options.budgetMs) && options.budgetMs > 0 && options.budgetMs < 4750));
  assert.equal(Object.hasOwn(calls[0], 'signal'), false);
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

test('a local deadline aborts only its own job while a peer owner completes', async () => {
  const firstOwner = owner();
  const peerOwner = owner();
  const { store, state } = memoryStore({
    remainingForOwner: scope => scope === firstOwner ? 250 : 5000,
    sampledAgeMs: 5,
  });
  const preflightSignals = new Map();
  const calls = [];
  const ownerForRun = runId => [...state.jobs.entries()].find(([, job]) => job.jobId === runId)?.[0];
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [firstOwner, peerOwner],
    runDeadlineMs: 5000,
    now: () => NOW,
    transport: {
      async preflight({ auditRequest, signal }) {
        preflightSignals.set(ownerForRun(auditRequest.runId), signal);
        return unitPreflight();
      },
      async call(request, { signal }) {
        const jobOwner = ownerForRun(request.runId);
        calls.push({ owner: jobOwner, role: request.role });
        if (jobOwner === firstOwner && request.role === 'lead') {
          return new Promise((resolve, reject) => {
            if (signal.aborted) reject(new Error('first owner stopped'));
            else signal.addEventListener('abort', () => reject(new Error('first owner stopped')), { once: true });
          });
        }
        return request.role === 'lead' ? leadFor(request) : riskFor(request);
      },
    },
  });
  const firstInput = { requestId: requestId(), analysisId };
  const peerInput = { requestId: requestId(), analysisId };
  const [first, peer] = await Promise.all([
    service.review(firstOwner, firstInput),
    service.review(peerOwner, peerInput),
  ]);
  await until(() => preflightSignals.size === 2);
  const firstSignal = preflightSignals.get(firstOwner);
  const peerSignal = preflightSignals.get(peerOwner);
  assert.notStrictEqual(firstSignal, peerSignal);
  if (!firstSignal.aborted) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the first owner was not locally aborted')), 2000);
      firstSignal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
  assert.equal(peerSignal.aborted, false);
  await until(() => state.jobs.get(peerOwner).state === 'COMPLETE');
  await until(() => state.jobs.get(firstOwner).state === 'COMPLETE');
  assert.ok(calls.some(call => call.owner === firstOwner && call.role === 'lead'));
  assert.equal(calls.some(call => call.owner === firstOwner && call.role === 'risk'), false);
  assert.equal(state.jobs.get(firstOwner).result.status, 'NO_DATA');
  assert.equal(state.jobs.get(peerOwner).result.status, 'BLOCKED');
  assert.equal(state.finishes, 2);
  assert.equal(state.jobs.get(firstOwner).jobId, first.jobId);
  assert.equal(state.jobs.get(peerOwner).jobId, peer.jobId);
  await service.close();
});

test('an aged claim budget reaches preflight without being reset', async t => {
  // V187: keep the simulated 250 ms history inside a valid monotonic origin.
  const monotonicNow = performance.now.bind(performance);
  t.mock.method(performance, 'now', () => monotonicNow() + 1000);
  const { store, state } = memoryStore({ sampledAgeMs: 250 });
  const scope = owner();
  let preflightBudget;
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [scope],
    runDeadlineMs: 5000,
    now: () => NOW,
    transport: {
      async preflight({ budgetMs }) { preflightBudget = budgetMs; return {}; },
      async call() { assert.fail('unverified preflight must stop before role calls'); },
    },
  });
  await service.review(scope, { requestId: requestId(), analysisId });
  await until(() => state.current.state === 'COMPLETE');
  assert.ok(preflightBudget > 0 && preflightBudget < 4750);
  await service.close();
});

test('close stops new work, aborts owned jobs, drains boundedly, and prevents late writes', async () => {
  const { store, state } = memoryStore();
  const scope = owner();
  let releaseReview;
  let reviewSignal;
  let hostAborted = 0;
  let hostClosed = 0;
  const service = createResearchReviewService({
    jobStore: store,
    allowedOwners: [scope],
    runDeadlineMs: 5000,
    review: options => {
      reviewSignal = options.signal;
      return new Promise(resolve => { releaseReview = resolve; });
    },
    transport: {
      async abort() { hostAborted += 1; },
      async close() { hostClosed += 1; },
    },
  });
  const job = await service.review(scope, { requestId: requestId(), analysisId });
  await until(() => typeof releaseReview === 'function');
  await service.close();
  assert.equal(reviewSignal.aborted, true);
  assert.equal(hostAborted, 1);
  assert.equal(hostClosed, 1);
  releaseReview(controllerResult(job));
  await wait(10);
  assert.equal(state.finishes, 0);
  await service.close();
});
