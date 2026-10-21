import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { createStore } from '../store.mjs';
import { createResearchService } from '../research/service.mjs';
import { captureNearEvidence, NEAR_REVENUE_SOURCE_URL } from '../research/near-source.mjs';
import { PUBLIC_OWNER_ID } from '../public-graph.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const testLock = createHash('sha256').update('falcon_mesh_test:near_research').digest().readBigInt64BE().toString();
const code = expected => error => error?.code === expected;
const owner = prefix => prefix + '_' + randomUUID().replaceAll('-', '');

function page(feesUsd = 20) {
  const payload = {
    revenueSeries: [{ period_month: '2026-10-01', revenue_usd: 12.5, revenue_near: 1.25, cumulative_revenue_usd: 12.5, cumulative_revenue_near: 1.25, is_stale: 0 }],
    intentVolumeSeries: [{ date_at: '2026-10-20', volume_usd: 100, cumulative_volume_usd: 100, source_used: 'dune:5179085', is_stale: 0 }],
    totalFeesSeries: [{ date_at: '2026-10-20', total_fees_near: 2, protocol_fee_near: 0.2, intents_revenue_near: 0.3, burn_revenue_near: 0.1, cumulative_fees_near: 2, cumulative_protocol_fee_near: 0.2, cumulative_intents_revenue_near: 0.3, fees_usd: feesUsd, cumulative_fees_usd: feesUsd, near_source_used: 'dune:6732575', usd_source_used: 'dune:6162763', is_stale: 0 }],
  };
  const chunk = 'self.__next_f.push([1,' + JSON.stringify('0:' + JSON.stringify(payload)) + ']);';
  return '<!doctype html><html><body><script>' + chunk + '</script></body></html>';
}

function captureHtml(body) {
  return async ({ now }) => captureNearEvidence({
    fetchImpl: async url => {
      assert.equal(url, NEAR_REVENUE_SOURCE_URL);
      return new Response(body, { status: 200 });
    },
    now,
  });
}

test('research cases cache captures, replay immutable packets, preserve failures and win manifest CAS races', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 3000 });
  const lock = await pool.connect();
  await lock.query('SELECT pg_advisory_lock($1::bigint)', [testLock]);
  const store = createStore(pool);
  t.after(async () => {
    await lock.query('SELECT pg_advisory_unlock($1::bigint)', [testLock]);
    lock.release();
    await pool.end();
  });
  await store.ready();

  const existing = await store.getPublicResearchBundle();
  let clockMs = Math.max(Date.now(), existing ? Date.parse(existing.case.createdAt) + 501 : 0);
  const now = () => new Date(clockMs).toISOString();
  let body = page();
  let captures = 0;
  const service = createResearchService({
    store,
    capture: async options => { captures += 1; return captureHtml(body)(options); },
    now,
    captureTtlMs: 500,
    failureTtlMs: 500,
  });

  const first = await service.getPublicCase();
  assert.equal(first.status, 'OBSERVED');
  assert.equal(first.snapshot.domain, 'near-thesis');
  assert.equal(first.snapshot.modelVersion, 'near-observed/1');
  assert.equal(first.modelResult.investmentAssessment.status, 'NO_DATA');
  assert.equal(first.executionReady, false);
  assert.equal(captures, 1);
  assert.notEqual(first.snapshot.rawBodySha256, first.sourceRefs[0].sha256, 'raw-body and source-record digests have distinct meanings');

  const cached = await service.getPublicCase();
  assert.equal(cached.caseId, first.caseId);
  assert.equal(captures, 1, 'fresh persisted capture is reused');
  assert.deepEqual(await service.getPublicCase(first.caseId), first, 'explicit case reads never refresh');
  assert.equal(captures, 1);
  assert.deepEqual(await service.replayPublicCase({ caseId: first.caseId }), first);
  assert.equal(captures, 1, 'deterministic replay performs no network capture');

  const originalSource = await store.getPublicResearchSource(first.sourceRefs[0].revisionId);
  assert.ok(originalSource);
  try {
    await pool.query('UPDATE falcon_mesh.source_revisions SET content = $1 WHERE owner_id = $2 AND revision_id = $3',
      ['{}', PUBLIC_OWNER_ID, first.sourceRefs[0].revisionId]);
    await assert.rejects(service.replayPublicCase({ caseId: first.caseId }), code('STORAGE_UNAVAILABLE'));
  } finally {
    await pool.query('UPDATE falcon_mesh.source_revisions SET content = $1 WHERE owner_id = $2 AND revision_id = $3',
      [originalSource.content, PUBLIC_OWNER_ID, first.sourceRefs[0].revisionId]);
  }
  assert.deepEqual(await service.replayPublicCase({ caseId: first.caseId }), first, 'restored retained bytes reproduce the original hash');

  clockMs += 501;
  body = '<!doctype html><html><body><p>Publisher page without the supported data payload.</p></body></html>';
  const failure = await service.getPublicCase();
  assert.equal(failure.status, 'NO_DATA');
  assert.equal(failure.snapshot, null);
  assert.equal(failure.snapshotHash, null);
  assert.equal(failure.modelResult, null);
  assert.equal(failure.sourceRefs.length, 1, 'integrity-verified parse-failure bytes remain retained');
  assert.deepEqual(await service.replayPublicCase({ caseId: failure.caseId }), failure);
  assert.deepEqual(await service.getPublicCase(first.caseId), first, 'last good case remains immutable and addressable');
  assert.equal((await store.getPublicResearchBundle()).case.caseId, failure.caseId, 'a current failure does not reuse the last good case');
  assert.equal(captures, 2);

  const failureOwner = owner('research_failure');
  const failureRequestId = randomUUID();
  const failureAdoptionInput = { requestId: failureRequestId, publicCaseId: failure.caseId };
  const noDataAdoption = await service.adoptCase(failureOwner, failureAdoptionInput);
  assert.equal(noDataAdoption.status, 'NO_DATA');
  assert.equal(noDataAdoption.analysisId, null);
  assert.equal(noDataAdoption.executionReady, false);
  assert.equal((await store.listResearchAnalyses(failureOwner)).length, 0, 'NO_DATA never appears as a fake adopted analysis');
  assert.deepEqual(await service.adoptCase(failureOwner, failureAdoptionInput), noDataAdoption);
  await assert.rejects(service.adoptCase(failureOwner, { requestId: failureRequestId, publicCaseId: first.caseId }), code('CONFLICT'));

  let releaseSlow;
  let signalSlow;
  const slowGate = new Promise(resolve => { releaseSlow = resolve; });
  const slowStarted = new Promise(resolve => { signalSlow = resolve; });
  const slowService = createResearchService({
    store,
    capture: async ({ now: captureNow }) => {
      signalSlow();
      await slowGate;
      return captureHtml('<html><body>slow stale parse failure</body></html>')({ now: captureNow });
    },
    now,
    captureTtlMs: 0,
    failureTtlMs: 0,
  });
  clockMs += 1;
  const staleCapture = slowService.getPublicCase();
  await slowStarted;
  const winnerService = createResearchService({
    store,
    capture: captureHtml(page(21)),
    now,
    captureTtlMs: 0,
    failureTtlMs: 0,
  });
  const winner = await winnerService.getPublicCase();
  assert.equal(winner.status, 'OBSERVED');
  releaseSlow();
  const staleResult = await staleCapture;
  assert.equal(staleResult.caseId, winner.caseId, 'a late failed capture yields the peer’s newer manifest instead of overwriting it');
  assert.equal((await store.getPublicResearchBundle()).case.caseId, winner.caseId);
});
