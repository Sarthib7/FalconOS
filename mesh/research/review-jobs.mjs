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

  function reviewTransport(owner, jobId) {
    if (!transport || typeof transport.preflight !== 'function' || typeof transport.call !== 'function') return transport;
    return {
      async preflight() {
        if (closing) return null;
        const job = await jobStore.phase(owner, jobId, 'PREFLIGHT');
        if (closing || job.state !== 'PENDING') return null;
        return transport.preflight();
      },
      async call(request) {
        if (closing) throw new Error('Research review service is closing.');
        const phase = request.role === 'risk' ? 'RISK' : 'LEAD';
        const job = await jobStore.phase(owner, jobId, phase);
        if (closing || job.state !== 'PENDING') throw new Error('Review job is no longer pending.');
        return transport.call(request);
      },
    };
  }

  function startBackground(owner, requestId, analysisId, claim) {
    const { job, snapshot } = claim;
    if (!snapshot || job?.state !== 'PENDING' || active.has(job.jobId) || closing) return;
    const entry = { timer: null, immediate: null, promise: null, expiry: null, runDone: false };
    entry.promise = new Promise(resolve => { entry.resolve = resolve; });
    const maybeDone = () => {
      if (entry.runDone && !entry.expiry) {
        active.delete(job.jobId);
        entry.resolve();
      }
    };
    entry.timer = setTimeout(() => {
      if (closing) {
        entry.timer = null;
        maybeDone();
        return;
      }
      entry.expiry = Promise.resolve()
        .then(() => jobStore.lookup(owner, { requestId, analysisId }))
        .catch(() => undefined)
        .finally(() => {
          entry.expiry = null;
          maybeDone();
        });
    }, deadlineMs);
    entry.timer.unref?.();
    entry.immediate = setImmediate(async () => {
      try {
        if (!closing) {
          const result = await review({
            runId: job.jobId,
            snapshotHash: job.snapshotHash,
            snapshot,
            modelResult: snapshot.modelResult,
            sourceRefs: snapshot.sourceRefs,
            transport: reviewTransport(owner, job.jobId),
            now,
          });
          if (!closing) await jobStore.finish(owner, job.jobId, result);
        }
      } catch {
        // A failed or ambiguous model run is never replayed or overwritten. The retained claim
        // expires to UNKNOWN on the deadline timer or the next owner status read.
      } finally {
        clearTimeout(entry.timer);
        entry.runDone = true;
        maybeDone();
      }
    });
    active.set(job.jobId, entry);
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
      if (claim.claimed) startBackground(owner, input.requestId, input.analysisId, claim);
      return claim.job;
    },

    async close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const entry of active.values()) clearTimeout(entry.timer);
      closePromise = (async () => {
        const startedAt = Date.now();
        const stops = [];
        if (typeof transport?.abort === 'function') stops.push(Promise.resolve().then(() => transport.abort()));
        if (typeof transport?.close === 'function') stops.push(Promise.resolve().then(() => transport.close()));
        for (const stop of stops) {
          const elapsed = Date.now() - startedAt;
          if (elapsed >= CLOSE_DRAIN_MS) break;
          await waitAtMost(stop, CLOSE_DRAIN_MS - elapsed);
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed < CLOSE_DRAIN_MS) {
          const pending = Promise.all([...active.values()].map(entry => entry.promise ?? Promise.resolve()));
          await waitAtMost(pending, CLOSE_DRAIN_MS - elapsed);
        }
      })();
      return closePromise;
    },
  };
}
