import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { Pool } from 'pg';
import { createLendingStore } from '../lending-store.mjs';
import { createApi, parseTokenHashes } from '../http.mjs';
import { projectActivity } from '../activity.mjs';
import { createResearchActivity } from '../research/activity.mjs';
import { createResearchReviewService } from '../research/review-jobs.mjs';
import { createReviewJobStore } from '../research/review-store.mjs';
import { captureNearEvidence, NEAR_REVENUE_SOURCE_URL } from '../research/near-source.mjs';
import { createResearchService } from '../research/service.mjs';
import { createStore } from '../store.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const owner = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const token = prefix => `${prefix}-activity-${randomUUID()}`;
const digest = value => createHash('sha256').update(value).digest('hex');

function page() {
  const payload = {
    revenueSeries: [{ period_month: '2026-10-01', revenue_usd: 12.5, revenue_near: 3.25, cumulative_revenue_usd: 100, cumulative_revenue_near: 30, is_stale: 0 }],
    intentVolumeSeries: [{ date_at: '2026-10-20', volume_usd: 120, cumulative_volume_usd: 900, source_used: 'dune:5179085', is_stale: 0 }],
    totalFeesSeries: [{
      date_at: '2026-10-20', total_fees_near: 10, protocol_fee_near: 1.1, intents_revenue_near: 2.2, burn_revenue_near: 0.3,
      cumulative_fees_near: 100, cumulative_protocol_fee_near: 11.1, cumulative_intents_revenue_near: 22.2,
      fees_usd: 987.65, cumulative_fees_usd: 4567.89, near_source_used: 'dune:6732575', usd_source_used: 'dune:6162763', is_stale: 0,
    }],
  };
  const serialized = JSON.stringify(payload);
  const chunk = 'self.__next_f.push([1,' + JSON.stringify('0:' + serialized) + ']);';
  return '<!doctype html><html><body><script>' + chunk + '</script></body></html>';
}

async function listen(t, options) {
  const server = createApi(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return 'http://127.0.0.1:' + server.address().port;
}

async function ask(base, path, { credential = null, method = 'GET' } = {}) {
  const response = await fetch(base + path, {
    method,
    ...(credential ? { headers: { Authorization: 'Bearer ' + credential } } : {}),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function askGetWithBody(base, path, credential, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, base), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + credential,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, data: text ? JSON.parse(text) : null });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function controllerResult(job, thesis, riskReason) {
  return {
    schemaVersion: 1,
    runId: job.jobId,
    snapshotHash: job.snapshotHash,
    lead: { thesis, hiddenReasoning: 'private-hidden-reasoning-marker' },
    risk: { reason: riskReason, rawRpcBody: 'private-rpc-body-marker' },
    status: 'BLOCKED',
    proposal: null,
    reasons: ['RISK_VETO'],
    executionReady: false,
  };
}

test('Mesh activity projection preserves legacy joins, counts, action/status fields and exact decimal strings', () => {
  const result = projectActivity({
    decisions: [
      { id: 'decision-linked', createdAt: '2026-10-22T09:00:00.000Z', analysis: { status: 'REVIEW', summary: 'Saved decision', expiresAt: '2026-10-23T09:00:00.000Z' } },
      { id: 'decision-unlinked', createdAt: '2026-10-22T12:00:00.000Z', analysis: { status: 'BLOCKED', summary: 'Independent block', expiresAt: null } },
    ],
    intents: [
      {
        id: 'intent-linked', createdAt: '2026-10-22T11:00:00.000Z',
        request: { action: 'redeem', wallet: 'wallet-a', decisionId: 'decision-linked', inputBaseUnits: '18446744073709551615' },
        status: 'CONFIRMED', signature: 'transaction-signature-a',
      },
      {
        id: 'intent-unmatched', createdAt: '2026-10-22T13:00:00.000Z',
        request: { action: 'supply', wallet: 'wallet-b', decisionId: 'missing-decision', inputBaseUnits: '01' },
        status: 'FAILED', signature: 'transaction-signature-b',
      },
      {
        id: 'intent-unjoined', createdAt: '2026-10-22T10:00:00.000Z',
        request: { action: 'supply', wallet: 'wallet-c', inputBaseUnits: '1000000' },
        status: 'READY', signature: null,
      },
    ],
    research: { schemaVersion: 1, briefing: null, adopted: [], reviews: [], limit: 20, executionReady: false },
  });

  assert.equal(result.limit, 20);
  assert.deepEqual(result.counts, { decisions: 2, intents: 3 });
  assert.deepEqual(result.trail.map(row => row.at), [
    '2026-10-22T13:00:00.000Z', '2026-10-22T12:00:00.000Z',
    '2026-10-22T11:00:00.000Z', '2026-10-22T10:00:00.000Z',
  ]);
  assert.equal(result.trail[0].decision.status, null);
  assert.equal(result.trail[0].decision.id, 'missing-decision');
  assert.equal(result.trail[0].intent.amountUsdc, null);
  assert.equal(result.trail[0].intent.status, 'FAILED');
  assert.equal(result.trail[1].decision.status, 'BLOCKED');
  assert.equal(result.trail[1].intent, null);
  assert.equal(result.trail[2].decision.summary, 'Saved decision');
  assert.equal(result.trail[2].decision.status, 'REVIEW');
  assert.equal(result.trail[2].intent.amountReceiptTokens, '18446744073709.551615');
  assert.equal(result.trail[2].intent.action, 'redeem');
  assert.equal(result.trail[2].intent.status, 'CONFIRMED');
  assert.equal(result.trail[2].intent.transactionSignature, 'transaction-signature-a');
  assert.equal(result.trail[3].decision, null);
  assert.equal(result.trail[3].intent.amountUsdc, '1');
  assert.equal(result.trail[3].intent.action, 'supply');
  assert.equal(result.trail[3].intent.status, 'READY');
  assert.equal(Object.hasOwn(result.trail[2].intent, 'amountUsdc'), false);
  assert.deepEqual(result.research, { schemaVersion: 1, briefing: null, adopted: [], reviews: [], limit: 20, executionReady: false });
});

test('owner activity reads deny anonymous callers, reject query/body inputs and do not capture an empty briefing', {
  skip: !databaseUrl && 'Set FALCON_MESH_TEST_DATABASE_URL to the initialized disposable mesh database.',
}, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  const testLock = createHash('sha256').update('falcon_mesh_test:near_research').digest().readBigInt64BE().toString();
  const guard = await pool.connect();
  await guard.query('SELECT pg_advisory_lock($1::bigint)', [testLock]);
  const ownerId = owner('activity_empty');
  const bearer = token('empty-owner');
  const tokenHashes = parseTokenHashes(JSON.stringify({ [digest(bearer)]: ownerId }));
  const store = createStore(pool);
  await store.ready();
  const reviewJobStore = createReviewJobStore(pool);
  const emptyStore = { ...store, async getRetainedPublicResearchCase() { return null; } };
  const researchActivity = createResearchActivity({ store: emptyStore, reviewJobStore });
  let captures = 0;
  const now = () => new Date(Date.now() + 60_000).toISOString();
  const researchService = createResearchService({
    store: {
      ...store,
      async getPublicResearchBundle() { return null; },
      async publishPublicResearchCase() { throw new Error('A private activity read must not publish.'); },
    },
    capture: async () => { captures += 1; throw new Error('A private activity read must not capture.'); },
    now,
    captureTtlMs: 0,
  });
  const reviewStarts = { review: 0, preflight: 0, provider: 0 };
  const researchReviewService = createResearchReviewService({
    jobStore: reviewJobStore,
    allowedOwners: [ownerId],
    runDeadlineMs: 60_000,
    review: async () => { reviewStarts.review += 1; throw new Error('A private activity read must not start a review.'); },
    transport: {
      async preflight() { reviewStarts.preflight += 1; return {}; },
      async call() { reviewStarts.provider += 1; return {}; },
    },
  });
  const lending = createLendingStore(pool, {
    meshStore: store,
    prepareLending: async () => { throw new Error('Activity reads do not prepare intents.'); },
    verifySignedLending: async () => { throw new Error('Activity reads do not verify signed bytes.'); },
    readLendingReceipt: async () => { throw new Error('Activity reads do not fetch receipts.'); },
  });
  const server = createApi({ store: emptyStore, lending, researchService, researchReviewService, researchActivity, tokenHashes });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await researchReviewService.close();
    try { await guard.query('SELECT pg_advisory_unlock($1::bigint)', [testLock]); }
    finally { guard.release(); await pool.end(); }
  });

  for (const path of ['/v1/research/near/activity', '/v1/activity']) {
    const anonymous = await ask(base, path);
    assert.equal(anonymous.status, 401, path);
    assert.equal(anonymous.data.error.code, 'UNAUTHORIZED', path);
  }
  const query = await ask(base, '/v1/research/near/activity?owner=' + encodeURIComponent(ownerId), { credential: bearer });
  assert.equal(query.status, 400);
  assert.equal(query.data.error.code, 'INVALID_INPUT');
  const body = await askGetWithBody(base, '/v1/research/near/activity', bearer, '{}');
  assert.equal(body.status, 400);
  assert.equal(body.data.error.code, 'INVALID_INPUT');

  const research = await ask(base, '/v1/research/near/activity', { credential: bearer });
  assert.equal(research.status, 200, JSON.stringify(research.data));
  assert.deepEqual(research.data, {
    schemaVersion: 1, briefing: null, adopted: [], reviews: [], limit: 20, executionReady: false,
  });
  const combined = await ask(base, '/v1/activity', { credential: bearer });
  assert.equal(combined.status, 200, JSON.stringify(combined.data));
  assert.deepEqual(combined.data.research, research.data);
  assert.deepEqual(combined.data.counts, { decisions: 0, intents: 0 });
  assert.equal(captures, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reviewStarts, { review: 0, preflight: 0, provider: 0 });
});

test('actual retained activity stays owner-scoped, records the latest phase time and preserves UNKNOWN honestly', {
  skip: !databaseUrl && 'Set FALCON_MESH_TEST_DATABASE_URL to the initialized disposable mesh database.',
}, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  const testLock = createHash('sha256').update('falcon_mesh_test:near_research').digest().readBigInt64BE().toString();
  const guard = await pool.connect();
  await guard.query('SELECT pg_advisory_lock($1::bigint)', [testLock]);
  const ownerA = owner('activity_alpha');
  const ownerB = owner('activity_bravo');
  const ownerC = owner('activity_unknown');
  const tokenA = token('alpha');
  const tokenB = token('bravo');
  const tokenC = token('unknown');
  const tokenHashes = parseTokenHashes(JSON.stringify({
    [digest(tokenA)]: ownerA, [digest(tokenB)]: ownerB, [digest(tokenC)]: ownerC,
  }));
  const store = createStore(pool);
  await store.ready();
  const reviewJobStore = createReviewJobStore(pool);
  let clockMs = Date.now() + 60_000;
  const now = () => new Date(clockMs++).toISOString();
  let captures = 0;
  const capture = async ({ now: captureNow }) => {
    captures += 1;
    return captureNearEvidence({
      fetchImpl: async url => {
        assert.equal(url, NEAR_REVENUE_SOURCE_URL);
        return new Response(page(), { status: 200 });
      },
      now: captureNow,
    });
  };
  const researchService = createResearchService({ store, capture, now, captureTtlMs: 0 });
  const publicCase = await researchService.getPublicCase();
  assert.ok(publicCase?.snapshotHash);
  const captureCountBeforeReads = captures;
  const adoptionA = await researchService.adoptCase(ownerA, { requestId: randomUUID(), publicCaseId: publicCase.caseId });
  const adoptionB = await researchService.adoptCase(ownerB, { requestId: randomUUID(), publicCaseId: publicCase.caseId });
  assert.equal(adoptionA.status, 'ADOPTED');
  assert.equal(adoptionB.status, 'ADOPTED');

  const claimA = await reviewJobStore.claim(ownerA, { requestId: randomUUID(), analysisId: adoptionA.analysisId, runDeadlineMs: 60_000 });
  await reviewJobStore.phase(ownerA, claimA.job.jobId, 'LEAD');
  await reviewJobStore.phase(ownerA, claimA.job.jobId, 'RISK');
  await reviewJobStore.finish(ownerA, claimA.job.jobId, controllerResult(claimA.job, 'Alpha retained thesis.', 'Alpha risk veto.'));
  const claimB = await reviewJobStore.claim(ownerB, { requestId: randomUUID(), analysisId: adoptionB.analysisId, runDeadlineMs: 60_000 });
  await reviewJobStore.phase(ownerB, claimB.job.jobId, 'LEAD');
  const claimC = await reviewJobStore.claim(ownerC, { requestId: randomUUID(), analysisId: (await researchService.adoptCase(ownerC, {
    requestId: randomUUID(), publicCaseId: publicCase.caseId,
  })).analysisId, runDeadlineMs: 1 });
  await pool.query('SELECT pg_sleep(0.03)');
  const legacy = [];
  for (const [recordOwner, adoption, units] of [[ownerA, adoptionA, '1500001'], [ownerB, adoptionB, '2500002']]) {
    const decision = await store.createDecision(recordOwner, {
      requestId: randomUUID(),
      scenario: { proposedUnits: '1', maxProposedUnits: '1', minBookLiquidityUnits: '1', maxObservationAgeSeconds: 300 },
    }, now());
    const intentId = randomUUID();
    // Retained read fixtures only; these rows do not attest valid preparation.
    await pool.query(
      'INSERT INTO falcon_mesh.lending_intents (owner_id,id,request_id,analysis_id,created_at,request,intent) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',
      [recordOwner, intentId, randomUUID(), adoption.analysisId, now(), JSON.stringify({ action: 'redeem', wallet: recordOwner, inputBaseUnits: units }), '{}'],
    );
    legacy.push({ decision, intentId });
  }

  const starts = { review: 0, preflight: 0, provider: 0 };
  const researchReviewService = createResearchReviewService({
    jobStore: reviewJobStore,
    allowedOwners: [ownerA, ownerB, ownerC],
    runDeadlineMs: 60_000,
    review: async ({ transport }) => {
      starts.review += 1;
      await transport.preflight({ auditRequest: { role: 'lead' } });
      await transport.call({ role: 'lead' });
      return {};
    },
    transport: {
      async preflight() { starts.preflight += 1; return {}; },
      async call() { starts.provider += 1; return {}; },
    },
  });
  const researchActivity = createResearchActivity({ store, reviewJobStore });
  const lending = createLendingStore(pool, {
    meshStore: store,
    prepareLending: async () => { throw new Error('Activity reads do not prepare intents.'); },
    verifySignedLending: async () => { throw new Error('Activity reads do not verify signed bytes.'); },
    readLendingReceipt: async () => { throw new Error('Activity reads do not fetch receipts.'); },
  });
  const server = createApi({ store, lending, researchService, researchReviewService, researchActivity, tokenHashes });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await researchReviewService.close();
    try { await guard.query('SELECT pg_advisory_unlock($1::bigint)', [testLock]); }
    finally { guard.release(); await pool.end(); }
  });

  const alpha = await ask(base, '/v1/activity', { credential: tokenA });
  const bravo = await ask(base, '/v1/research/near/activity', { credential: tokenB });
  const unknown = await ask(base, '/v1/research/near/activity', { credential: tokenC });
  assert.equal(alpha.status, 200, JSON.stringify(alpha.data));
  assert.equal(bravo.status, 200, JSON.stringify(bravo.data));
  assert.equal(unknown.status, 200, JSON.stringify(unknown.data));

  const alphaResearch = alpha.data.research;
  const bravoResearch = bravo.data;
  const unknownResearch = unknown.data;
  assert.equal(alphaResearch.briefing.caseId, publicCase.caseId);
  assert.equal(alphaResearch.briefing.capturedAt, publicCase.snapshot.capturedAt);
  assert.equal(alphaResearch.briefing.investmentStatus, publicCase.modelResult.investmentAssessment.status);
  assert.equal(alphaResearch.adopted.length, 1);
  assert.equal(alphaResearch.adopted[0].analysisId, adoptionA.analysisId);
  assert.equal(alphaResearch.adopted[0].snapshotHash, publicCase.snapshotHash);
  assert.equal(alphaResearch.adopted[0].investmentStatus, publicCase.modelResult.investmentAssessment.status);
  assert.equal(alphaResearch.reviews.length, 1);
  assert.deepEqual(alphaResearch.reviews[0], {
    jobId: claimA.job.jobId,
    requestId: claimA.job.requestId,
    analysisId: adoptionA.analysisId,
    snapshotHash: publicCase.snapshotHash,
    state: 'COMPLETE',
    phase: 'TERMINAL',
    resultStatus: 'BLOCKED',
    summary: 'Alpha retained thesis.',
    riskReason: 'Alpha risk veto.',
    reasons: ['RISK_VETO'],
    recordedAt: alphaResearch.reviews[0].recordedAt,
    executionReady: false,
  });
  const terminalTime = await pool.query(
    "SELECT created_at FROM falcon_mesh.analyses WHERE owner_id = $1 AND analysis->>'recordKind' = 'near-research/review/terminal/1' AND analysis->>'jobId' = $2",
    [ownerA, claimA.job.jobId],
  );
  assert.equal(alphaResearch.reviews[0].recordedAt, new Date(terminalTime.rows[0].created_at).toISOString());
  assert.equal(Object.hasOwn(alphaResearch.reviews[0], 'result'), false);
  assert.equal(JSON.stringify(alpha.data).includes('private-hidden-reasoning-marker'), false);
  assert.equal(JSON.stringify(alpha.data).includes('private-rpc-body-marker'), false);
  assert.equal(JSON.stringify(alpha.data).includes('rawBodySha256'), false);

  assert.equal(bravoResearch.adopted.length, 1);
  assert.equal(bravoResearch.adopted[0].analysisId, adoptionB.analysisId);
  assert.equal(bravoResearch.adopted.some(item => item.analysisId === adoptionA.analysisId), false);
  assert.equal(bravoResearch.reviews.length, 1);
  assert.equal(bravoResearch.reviews[0].jobId, claimB.job.jobId);
  assert.equal(bravoResearch.reviews[0].state, 'PENDING');
  assert.equal(bravoResearch.reviews[0].phase, 'LEAD');
  assert.equal(bravoResearch.reviews[0].resultStatus, null);
  assert.equal(bravoResearch.reviews[0].summary, null);
  const phaseTime = await pool.query(
    "SELECT created_at FROM falcon_mesh.analyses WHERE owner_id = $1 AND analysis->>'recordKind' = 'near-research/review/phase/1' AND analysis->>'jobId' = $2 AND analysis->>'phase' = 'LEAD'",
    [ownerB, claimB.job.jobId],
  );
  assert.equal(bravoResearch.reviews[0].recordedAt, new Date(phaseTime.rows[0].created_at).toISOString());

  assert.equal(unknownResearch.adopted.length, 1);
  assert.equal(unknownResearch.reviews.length, 1);
  assert.equal(unknownResearch.reviews[0].jobId, claimC.job.jobId);
  assert.equal(unknownResearch.reviews[0].state, 'UNKNOWN');
  assert.equal(unknownResearch.reviews[0].phase, 'TERMINAL');
  assert.equal(unknownResearch.reviews[0].resultStatus, 'NO_DATA');
  assert.equal(unknownResearch.reviews[0].summary, null);
  assert.equal(unknownResearch.reviews[0].riskReason, null);
  assert.ok(unknownResearch.reviews[0].recordedAt);
  assert.equal(unknownResearch.reviews[0].executionReady, false);
  assert.equal(alpha.data.counts.decisions, 1);
  assert.equal(alpha.data.counts.intents, 1);
  assert.equal(alpha.data.trail.find(row => row.decision)?.decision.id, legacy[0].decision.id);
  assert.equal(alpha.data.trail.find(row => row.intent)?.intent.id, legacy[0].intentId);
  assert.equal(alpha.data.trail.find(row => row.intent)?.intent.amountReceiptTokens, '1.500001');
  assert.equal(alpha.data.trail.some(row => row.decision?.id === legacy[1].decision.id || row.intent?.id === legacy[1].intentId), false);
  assert.equal(captures, captureCountBeforeReads);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, { review: 0, preflight: 0, provider: 0 });
});

test('activity responses over one MiB fail with typed TOO_LARGE', async t => {
  const bearer = token('oversize-owner');
  const tokenHashes = parseTokenHashes(JSON.stringify({ [digest(bearer)]: owner('activity_oversize') }));
  const researchActivity = { async get() { return { payload: 'x'.repeat(1024 * 1024) }; } };
  const base = await listen(t, {
    store: { async listDecisions() { return []; } },
    lending: { async list() { return []; } },
    researchActivity,
    tokenHashes,
  });
  for (const path of ['/v1/research/near/activity', '/v1/activity']) {
    const response = await ask(base, path, { credential: bearer });
    assert.equal(response.status, 413, path);
    assert.equal(response.data.error.code, 'TOO_LARGE', path);
  }
});
