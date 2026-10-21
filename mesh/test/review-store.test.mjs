import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createReviewJobStore } from '../research/review-store.mjs';
import { MeshError } from '../domain.mjs';
import { canonicalBytes, sha256 } from '../council/evidence.ts';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 }) : null;
const startAt = Date.parse('2026-10-21T14:00:00.000Z');
const at = () => new Date(startAt).toISOString();
const owner = () => 'review_test_' + randomUUID().replaceAll('-', '');
const code = expected => error => error instanceof MeshError && error.code === expected;

function adoptedSnapshot() {
  const sourceRefs = [{ revisionId: randomUUID(), sha256: 'a'.repeat(64) }];
  const modelResult = {
    modelVersion: 'near-observed/1', status: 'OBSERVED', seriesSummaries: {}, unknowns: [],
    counterCase: ['Publisher data is not independently reconciled.'],
    investmentAssessment: { status: 'NO_DATA', reasons: ['Native-token demand is unverified.'], proposal: null },
    executionReady: false,
  };
  const snapshot = {
    schemaVersion: 1, domain: 'near-thesis', adapterVersion: 'near-revenue/1',
    sourceUrl: 'https://revenue.near.org/', capturedAt: at(), rawBodySha256: 'b'.repeat(64), rawBodyBytes: 1024,
    sourceRefs, modelVersion: 'near-observed/1', modelResult,
  };
  return { snapshot, sourceRefs, modelResult, snapshotHash: sha256(canonicalBytes(snapshot)) };
}

async function seedAdoption(db, scope = owner(), adoptionRequestId = randomUUID()) {
  const analysisId = randomUUID();
  const saved = adoptedSnapshot();
  const graph = {
    schemaVersion: 1, domain: 'near-thesis', caseType: 'near-thesis', publicCaseId: randomUUID(),
    snapshotHash: saved.snapshotHash, snapshot: saved.snapshot, sourceRefs: saved.sourceRefs, executionReady: false,
  };
  const analysis = {
    recordKind: 'near-research/adopted/1', status: 'OBSERVED', publicCaseId: graph.publicCaseId,
    snapshotHash: saved.snapshotHash, snapshot: saved.snapshot, modelResult: saved.modelResult,
    sourceRefs: saved.sourceRefs, issues: [], evidenceSource: 'public', executionReady: false,
  };
  await db.query(
    'INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7::jsonb)',
    [scope, analysisId, adoptionRequestId, at(), 'research:near:' + graph.publicCaseId, JSON.stringify(graph), JSON.stringify(analysis)],
  );
  return { owner: scope, adoptionRequestId, analysisId, ...saved };
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
    reasons: ['Host preflight was not available.'],
    executionReady: false,
    ...overrides,
  };
}

function gated(name, fn) {
  test(name, { skip: !databaseUrl }, fn);
}

test('review store integration tests require only FALCON_MESH_TEST_DATABASE_URL', { skip: !databaseUrl }, async () => {
  assert.ok(pool, 'the test database pool is configured from the dedicated disposable-test variable');
  await pool.query('SELECT 1 FROM falcon_mesh.analyses LIMIT 1');
});

gated('identical concurrent claims retain one immutable job and phase/terminal rows', async () => {
  const adopted = await seedAdoption(pool);
  const store = createReviewJobStore(pool, { now: at });
  const requestId = randomUUID();
  const args = { requestId, analysisId: adopted.analysisId, runDeadlineMs: 30_000 };
  const [left, right] = await Promise.all([store.claim(adopted.owner, args), store.claim(adopted.owner, args)]);
  assert.equal(Number(left.claimed) + Number(right.claimed), 1);
  assert.equal(left.job.jobId, right.job.jobId);
  assert.equal(left.job.state, 'PENDING');
  assert.deepEqual(left.claimed ? left.snapshot : right.snapshot, adopted.snapshot);
  assert.equal(left.claimed ? right.snapshot : left.snapshot, null);

  const phase = await store.phase(adopted.owner, left.job.jobId, 'LEAD');
  assert.equal(phase.phase, 'LEAD');
  assert.equal((await store.lookup(adopted.owner, { requestId, analysisId: adopted.analysisId })).phase, 'LEAD');
  const complete = await store.finish(adopted.owner, left.job.jobId, controllerResult(left.job));
  assert.equal(complete.state, 'COMPLETE');
  assert.equal(complete.phase, 'TERMINAL');
  const repeated = await store.finish(adopted.owner, left.job.jobId, controllerResult(left.job, { reasons: ['A later result cannot replace the first.'] }));
  assert.deepEqual(repeated, complete);

  const records = await pool.query(
    "SELECT analysis->>'recordKind' AS kind FROM falcon_mesh.analyses WHERE owner_id = $1 AND (analysis->>'jobId' = $2::text OR id::text = $2::text) ORDER BY kind",
    [adopted.owner, left.job.jobId],
  );
  assert.deepEqual(records.rows.map(row => row.kind).sort(), [
    'near-research/review/claim/1', 'near-research/review/phase/1', 'near-research/review/terminal/1',
  ]);
});

gated('foreign adopted IDs are not found and request reuse conflicts with adoption or legacy rows', async () => {
  const adopted = await seedAdoption(pool);
  const stranger = owner();
  const store = createReviewJobStore(pool, { now: at });
  await assert.rejects(
    store.lookup(stranger, { requestId: randomUUID(), analysisId: adopted.analysisId }),
    code('NOT_FOUND'),
  );
  await assert.rejects(
    store.claim(adopted.owner, { requestId: randomUUID(), analysisId: randomUUID(), runDeadlineMs: 1000 }),
    code('NOT_FOUND'),
  );
  await assert.rejects(
    store.claim(adopted.owner, { requestId: adopted.adoptionRequestId, analysisId: adopted.analysisId, runDeadlineMs: 1000 }),
    code('CONFLICT'),
  );

  const legacyRequestId = randomUUID();
  await pool.query(
    'INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7::jsonb)',
    [adopted.owner, randomUUID(), legacyRequestId, at(), 'legacy:review-test', '{}', JSON.stringify({ status: 'OBSERVED' })],
  );
  await assert.rejects(
    store.claim(adopted.owner, { requestId: legacyRequestId, analysisId: adopted.analysisId, runDeadlineMs: 1000 }),
    code('CONFLICT'),
  );
});

gated('a lost COMMIT reply followed by a new store reads pending without reclaiming', async () => {
  const adopted = await seedAdoption(pool);
  const requestId = randomUUID();
  let commitReplyLost = false;
  const uncertainPool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(text, values) {
          const result = await client.query(text, values);
          if (!commitReplyLost && text === 'COMMIT') {
            commitReplyLost = true;
            throw new Error('simulated reply loss after PostgreSQL committed');
          }
          return result;
        },
        release(error) { client.release(error); },
      };
    },
  };
  const firstStore = createReviewJobStore(uncertainPool, { now: at });
  await assert.rejects(
    firstStore.claim(adopted.owner, { requestId, analysisId: adopted.analysisId, runDeadlineMs: 30_000 }),
    code('STORAGE_UNAVAILABLE'),
  );
  assert.equal(commitReplyLost, true);

  const restartedStore = createReviewJobStore(pool, { now: at });
  const retained = await restartedStore.lookup(adopted.owner, { requestId, analysisId: adopted.analysisId });
  assert.equal(retained.state, 'PENDING');
  const retry = await restartedStore.claim(adopted.owner, { requestId, analysisId: adopted.analysisId, runDeadlineMs: 30_000 });
  assert.equal(retry.claimed, false);
  assert.equal(retry.job.jobId, retained.jobId);
});

gated('the owner lock permits at most one unresolved job and expires it to canonical UNKNOWN', async () => {
  const adopted = await seedAdoption(pool);
  let current = startAt;
  const store = createReviewJobStore(pool, { now: () => new Date(current).toISOString() });
  const firstRequest = randomUUID();
  const secondRequest = randomUUID();
  const args = { analysisId: adopted.analysisId, runDeadlineMs: 1000 };
  const outcomes = await Promise.allSettled([
    store.claim(adopted.owner, { ...args, requestId: firstRequest }),
    store.claim(adopted.owner, { ...args, requestId: secondRequest }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const winner = outcomes.find(item => item.status === 'fulfilled').value;
  const loser = outcomes.find(item => item.status === 'rejected').reason;
  assert.equal(loser.code, 'CONFLICT');
  const requestId = winner.job.requestId;
  const jobId = winner.job.jobId;
  assert.equal((await store.lookup(adopted.owner, { requestId, analysisId: adopted.analysisId })).state, 'PENDING');

  current += 1000;
  const unknown = await store.lookup(adopted.owner, { requestId, analysisId: adopted.analysisId });
  assert.equal(unknown.state, 'UNKNOWN');
  assert.equal(unknown.phase, 'TERMINAL');
  assert.equal(unknown.result.status, 'NO_DATA');
  assert.equal(unknown.result.proposal, null);
  const late = await store.finish(adopted.owner, jobId, controllerResult(unknown, { status: 'NO_DATA' }));
  assert.deepEqual(late, unknown, 'late completion cannot replace an expiry terminal');

  const terminalRows = await pool.query(
    "SELECT id FROM falcon_mesh.analyses WHERE owner_id = $1 AND analysis->>'recordKind' = 'near-research/review/terminal/1' AND analysis->>'jobId' = $2",
    [adopted.owner, jobId],
  );
  assert.equal(terminalRows.rows.length, 1);
  const laterClaim = await store.claim(adopted.owner, { requestId: randomUUID(), analysisId: adopted.analysisId, runDeadlineMs: 1000 });
  assert.equal(laterClaim.claimed, true);
});

gated('owner validation rejects the reserved public namespace before SQL', async () => {
  const store = createReviewJobStore(pool, { now: at });
  await assert.rejects(
    store.lookup('__falcon_public_market_evidence__', { requestId: randomUUID(), analysisId: randomUUID() }),
    code('INVALID_INPUT'),
  );
});

after(async () => { if (pool) await pool.end(); });
