import { performance } from 'node:perf_hooks';
import { MeshError } from '../domain.mjs';
import { runCouncilReview } from '../council/host.mjs';

const MAX_RUN_DEADLINE_MS = 10 * 60 * 1000;
const CLOSE_DRAIN_MS = 1000;
const OWNER = /^[a-z0-9_-]{1,64}$/;

function invalid(message) { throw new MeshError('INVALID_INPUT', message); }
function isOwner(value) { return typeof value === 'string' && OWNER.test(value); }
function trustedOwners(input) {
  if (!(Array.isArray(input) || input instanceof Set)) invalid('Allowed review owners must be a trusted list or set.');
  const owners = new Set();
  for (const owner of input) {
    if (!isOwner(owner)) invalid('Configured review owner is invalid.');
    owners.add(owner);
  }
  return owners;
}
function boundedDeadline(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RUN_DEADLINE_MS) {
    invalid('Review run deadline must be a positive bounded number of milliseconds.');
  }
  return value;
}
function waitAtMost(value, milliseconds) {
  if (milliseconds <= 0) return Promise.resolve();
  let timer;
  return Promise.race([
    Promise.resolve(value).catch(() => undefined),
    new Promise(resolve => { timer = setTimeout(resolve, milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

function stoppedResult(job) {
  return {
    schemaVersion: 1,
    runId: job.jobId,
    snapshotHash: job.snapshotHash,
    lead: null,
    risk: null,
    status: 'NO_DATA',
    proposal: null,
    reasons: ['Review stopped at its local execution deadline.'],
    executionReady: false,
  };
}

function validClaimBudget(claim, maximumMs) {
  return typeof claim.deadlineAt === 'string'
    && Number.isSafeInteger(claim.remainingMs) && claim.remainingMs >= 0 && claim.remainingMs <= maximumMs
    && Number.isFinite(claim.sampledAtMonotonicMs) && claim.sampledAtMonotonicMs >= 0
    && claim.sampledAtMonotonicMs <= performance.now();
}

export function createResearchReviewService({
  jobStore,
  transport,
  review = runCouncilReview,
  allowedOwners = [],
  runDeadlineMs,
  now = () => new Date().toISOString(),
} = {}) {
  if (!jobStore || typeof jobStore.lookup !== 'function' || typeof jobStore.claim !== 'function'
      || typeof jobStore.phase !== 'function' || typeof jobStore.finish !== 'function') {
    throw new TypeError('Research review service requires a retained review job store.');
  }
  if (typeof review !== 'function') throw new TypeError('Research review controller must be callable.');
  const deadlineMs = boundedDeadline(runDeadlineMs);
  const owners = trustedOwners(allowedOwners);
  let closing = false;
  let closePromise;
  const active = new Map();

  function remainingBudgetMs(entry) {
    return Math.max(0, entry.remainingMs - (performance.now() - entry.sampledAtMonotonicMs));
  }

  function stopAtLocalDeadline(entry) {
    entry.localTimedOut = true;
    if (!entry.controller.signal.aborted) entry.controller.abort();
  }

  function nextHostBudget(entry) {
    if (closing || entry.controller.signal.aborted) throw new Error('Review job is no longer active.');
    const budgetMs = Math.floor(remainingBudgetMs(entry));
    if (budgetMs < 1) {
      stopAtLocalDeadline(entry);
      throw new Error('Review job local budget is exhausted.');
    }
    return budgetMs;
  }

  function reviewTransport(owner, jobId, entry) {
    if (!transport || typeof transport.preflight !== 'function' || typeof transport.call !== 'function') return transport;
    return {
      async preflight({ auditRequest } = {}) {
        nextHostBudget(entry);
        const job = await jobStore.phase(owner, jobId, 'PREFLIGHT');
        if (closing || entry.controller.signal.aborted || job.state !== 'PENDING') throw new Error('Review job is no longer pending.');
        const budgetMs = nextHostBudget(entry);
        return transport.preflight({ auditRequest, signal: entry.controller.signal, budgetMs });
      },
      async call(request) {
        nextHostBudget(entry);
        const phase = request.role === 'risk' ? 'RISK' : 'LEAD';
        const job = await jobStore.phase(owner, jobId, phase);
        if (closing || entry.controller.signal.aborted || job.state !== 'PENDING') throw new Error('Review job is no longer pending.');
        const budgetMs = nextHostBudget(entry);
        return transport.call(request, { signal: entry.controller.signal, budgetMs });
      },
    };
  }

  function startBackground(owner, claim) {
    const { job, snapshot } = claim;
    if (!snapshot || job?.state !== 'PENDING' || active.has(job.jobId) || closing) return;
    if (!validClaimBudget(claim, deadlineMs)) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Review claim did not include a valid local budget.');
    }
    const controller = new AbortController();
    const entry = {
      controller,
      remainingMs: claim.remainingMs,
      sampledAtMonotonicMs: claim.sampledAtMonotonicMs,
      localTimedOut: false,
      timer: null,
      promise: null,
      resolve: null,
    };
    entry.promise = new Promise(resolve => { entry.resolve = resolve; });
    active.set(job.jobId, entry);
    entry.timer = setTimeout(() => {
      if (!closing) stopAtLocalDeadline(entry);
    }, Math.max(0, Math.floor(remainingBudgetMs(entry))));
    entry.timer.unref?.();
    setImmediate(async () => {
      try {
        if (!closing) {
          let result;
          try {
            result = await review({
              runId: job.jobId,
              snapshotHash: job.snapshotHash,
              snapshot,
              modelResult: snapshot.modelResult,
              sourceRefs: snapshot.sourceRefs,
              transport: reviewTransport(owner, job.jobId, entry),
              signal: controller.signal,
              now,
            });
          } catch {
            if (entry.localTimedOut || remainingBudgetMs(entry) <= 0) result = stoppedResult(job);
          }
          if (!closing && result) {
            if (entry.localTimedOut || remainingBudgetMs(entry) <= 0) {
              stopAtLocalDeadline(entry);
              result = stoppedResult(job);
            }
            await jobStore.finish(owner, job.jobId, result);
          }
        }
      } catch {
        // A failed or ambiguous run is retained; status reads use the database deadline.
      } finally {
        clearTimeout(entry.timer);
        active.delete(job.jobId);
        entry.resolve();
      }
    });
  }

  return {
    async review(owner, input) {
      if (!isOwner(owner)) invalid('Owner is invalid.');
      if (closing) throw new MeshError('STORAGE_UNAVAILABLE', 'Research review service is closing.');
      const existing = await jobStore.lookup(owner, input);
      if (existing) return existing;
      if (closing) throw new MeshError('STORAGE_UNAVAILABLE', 'Research review service is closing.');
      if (!owners.has(owner)) throw new MeshError('FORBIDDEN', 'Owner is not granted permission to start a research review.');
      const claim = await jobStore.claim(owner, { ...input, runDeadlineMs: deadlineMs });
      if (claim.claimed) startBackground(owner, claim);
      return claim.job;
    },

    async close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const entry of active.values()) {
        clearTimeout(entry.timer);
        entry.controller.abort();
      }
      closePromise = (async () => {
        const deadline = performance.now() + CLOSE_DRAIN_MS;
        const remaining = () => Math.max(0, deadline - performance.now());
        const pending = Promise.all([...active.values()].map(entry => entry.promise));
        await waitAtMost(pending, Math.max(0, remaining() - 750));
        if (typeof transport?.abort === 'function') {
          let stopped;
          try { stopped = Promise.resolve(transport.abort()); } catch { stopped = Promise.resolve(); }
          await waitAtMost(stopped, Math.min(250, remaining()));
        }
        if (typeof transport?.close === 'function') {
          let closed;
          try { closed = Promise.resolve(transport.close()); } catch { closed = Promise.resolve(); }
          await waitAtMost(closed, remaining());
        }
      })();
      return closePromise;
    },
  };
}
