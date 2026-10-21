import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createApi, parseTokenHashes } from '../http.mjs';
import { captureNearEvidence, NEAR_REVENUE_SOURCE_URL } from '../research/near-source.mjs';
import { createResearchService } from '../research/service.mjs';
import { createStore } from '../store.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const token = 'test-only-research-owner-alpha-token-00000000';
const otherToken = 'test-only-research-owner-bravo-token-00000000';
const digest = value => createHash('sha256').update(value).digest('hex');
const owner = 'near_http_' + randomUUID().replaceAll('-', '');
const otherOwner = 'near_other_' + randomUUID().replaceAll('-', '');
const tokenHashes = parseTokenHashes(JSON.stringify({ [digest(token)]: owner, [digest(otherToken)]: otherOwner }));

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
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

async function ask(base, path, { method = 'GET', credential = null, input, raw, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (credential) requestHeaders.Authorization = 'Bearer ' + credential;
  const body = raw !== undefined ? raw : input !== undefined ? JSON.stringify(input) : undefined;
  if (body !== undefined && !Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const response = await fetch(base + path, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body } : {}),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
}

test('research routes fail closed without injection while preserving existing API and owner authentication', async t => {
  const { base } = await listen(t, { store: {}, tokenHashes });

  const publicUnavailable = await ask(base, '/v1/public/research/near/case');
  assert.equal(publicUnavailable.status, 503);
  assert.equal(publicUnavailable.data.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(publicUnavailable.data.error.message, 'The research service is not configured.');

  const privateDenied = await ask(base, '/v1/research/near/adopt', {
    method: 'POST', input: { requestId: randomUUID(), publicCaseId: randomUUID() },
  });
  assert.equal(privateDenied.status, 401);
  assert.equal(privateDenied.data.error.code, 'UNAUTHORIZED');

  const privateUnavailable = await ask(base, '/v1/research/near/adopt', {
    method: 'POST', credential: token, input: { requestId: randomUUID(), publicCaseId: randomUUID() },
  });
  assert.equal(privateUnavailable.status, 503);
  assert.equal(privateUnavailable.data.error.code, 'STORAGE_UNAVAILABLE');

  const existing = await ask(base, '/v1/connectors', { credential: token });
  assert.equal(existing.status, 200);
  assert.ok(Array.isArray(existing.data.connectors));
});

test('public research requests use the existing pre-auth global and source rate limits', async t => {
  for (const limits of [
    { walletLookupMaxPerSource: 1, walletLookupMaxGlobal: 10 },
    { walletLookupMaxPerSource: 10, walletLookupMaxGlobal: 1 },
  ]) {
    const { base } = await listen(t, { store: {}, tokenHashes, ...limits });
    const first = await ask(base, '/v1/public/research/near/case');
    assert.equal(first.status, 503, 'the first request reaches the typed missing-service response');
    const limited = await ask(base, '/v1/public/research/near/case');
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error.code, 'RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  }
});

test('private research adoption is charged to the authenticated owner rate bucket', async t => {
  const { base } = await listen(t, { store: {}, tokenHashes, rateMaxPerOwner: 1, rateMaxGlobal: 10 });
  const adopt = credential => ask(base, '/v1/research/near/adopt', {
    method: 'POST', credential, input: { requestId: randomUUID(), publicCaseId: randomUUID() },
  });
  assert.equal((await adopt(token)).status, 503);
  const sameOwner = await adopt(token);
  assert.equal(sameOwner.status, 429);
  assert.equal(sameOwner.data.error.code, 'RATE_LIMITED');
  assert.equal((await adopt(otherToken)).status, 503, 'a different authenticated owner has a separate owner bucket');
});

test('retained NEAR research routes expose genuine source, case, replay and owner-bound adoption behavior', {
  skip: !databaseUrl && 'Set FALCON_MESH_TEST_DATABASE_URL to the initialized disposable mesh database.',
}, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 3000 });
  const testLock = createHash('sha256').update('falcon_mesh_test:near_research').digest().readBigInt64BE().toString();
  const guard = await pool.connect();
  await guard.query('SELECT pg_advisory_lock($1::bigint)', [testLock]);
  t.after(async () => {
    try { await guard.query('SELECT pg_advisory_unlock($1::bigint)', [testLock]); }
    finally { guard.release(); await pool.end(); }
  });
  let clockMs = Date.now() + 60_000;
  const now = () => new Date(clockMs++).toISOString();
  const store = createStore(pool, { now });
  await store.ready();
  const html = page();
  let captures = 0;
  const capture = async ({ now: captureNow }) => {
    captures += 1;
    return captureNearEvidence({
      fetchImpl: async (url, init) => {
        assert.equal(url, NEAR_REVENUE_SOURCE_URL);
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        return new Response(html, { status: 200 });
      },
      now: captureNow,
    });
  };
  const researchService = createResearchService({ store, capture, now, captureTtlMs: 0 });
  const { base } = await listen(t, { store, researchService, tokenHashes });

  const current = await ask(base, '/v1/public/research/near/case');
  assert.equal(current.status, 200, JSON.stringify(current.data));
  assert.match(current.headers.get('content-type'), /^application\/json(?:;|$)/i);
  assert.equal(current.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(current.data.schemaVersion, 1);
  assert.equal(current.data.caseType, 'near-thesis');
  assert.equal(current.data.status, 'OBSERVED');
  assert.equal(current.data.executionReady, false);
  assert.equal(current.data.modelResult.executionReady, false);
  assert.ok(current.data.snapshotHash);
  assert.ok(Array.isArray(current.data.sourceRefs) && current.data.sourceRefs.length > 0);
  assert.equal(captures > 0, true, 'the injected fixed-source capture is used for stale public evidence');

  const caseId = current.data.caseId;
  const byId = await ask(base, '/v1/public/research/near/cases/' + caseId.toUpperCase());
  assert.equal(byId.status, 200);
  assert.deepEqual(byId.data, current.data, 'explicit case lookup returns the immutable retained envelope');

  const replay = await ask(base, '/v1/public/research/near/replay', { method: 'POST', input: { caseId: caseId.toUpperCase() } });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.data, current.data, 'replay returns the retained deterministic case envelope');
  assert.equal(replay.data.executionReady, false);
  const revisionId = current.data.sourceRefs[0].revisionId;
  assert.ok(revisionId, 'the retained case references a source revision');
  assert.match(revisionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const source = await ask(base, '/v1/public/research/near/sources/' + revisionId.toUpperCase());
  assert.equal(source.status, 200);
  assert.equal(source.data.sourceUrl, NEAR_REVENUE_SOURCE_URL);
  assert.equal(source.data.executionReady, false);
  assert.ok(source.data.content);

  const query = await ask(base, '/v1/public/research/near/case?owner=' + encodeURIComponent(owner));
  assert.equal(query.status, 400);
  const credential = await ask(base, '/v1/public/research/near/case', { credential: token });
  assert.equal(credential.status, 400);
  const invalidUuid = await ask(base, '/v1/public/research/near/cases/not-a-uuid');
  assert.equal(invalidUuid.status, 400);
  const unknownSource = await ask(base, '/v1/public/research/near/sources/' + randomUUID());
  assert.equal(unknownSource.status, 404);
  const wrongMethod = await ask(base, '/v1/public/research/near/replay');
  assert.equal(wrongMethod.status, 404);

  const extraReplayField = await ask(base, '/v1/public/research/near/replay', {
    method: 'POST', input: { caseId, forecast: { price: '1' } },
  });
  assert.equal(extraReplayField.status, 400);
  const badContentType = await ask(base, '/v1/public/research/near/replay', {
    method: 'POST', raw: JSON.stringify({ caseId }), headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(badContentType.status, 400);
  const badEncoding = await ask(base, '/v1/public/research/near/replay', {
    method: 'POST', input: { caseId }, headers: { 'Content-Encoding': 'gzip' },
  });
  assert.equal(badEncoding.status, 400);
  const tooLarge = await ask(base, '/v1/public/research/near/replay', {
    method: 'POST', input: { caseId, extra: 'x'.repeat(1024 * 1024) },
  });
  assert.equal(tooLarge.status, 413);

  const adoptionWithoutAuth = await ask(base, '/v1/research/near/adopt', {
    method: 'POST', input: { requestId: randomUUID(), publicCaseId: caseId },
  });
  assert.equal(adoptionWithoutAuth.status, 401);
  const extraAdoptionField = await ask(base, '/v1/research/near/adopt', {
    method: 'POST', credential: token, input: { requestId: randomUUID(), publicCaseId: caseId, owner: 'attacker' },
  });
  assert.equal(extraAdoptionField.status, 400);

  const adoption = await ask(base, '/v1/research/near/adopt', {
    method: 'POST', credential: token, input: { requestId: randomUUID().toUpperCase(), publicCaseId: caseId.toUpperCase() },
  });
  assert.equal(adoption.status, 200, JSON.stringify(adoption.data));
  assert.equal(adoption.data.status, 'ADOPTED');
  assert.equal(adoption.data.publicCaseId, caseId);
  assert.equal(adoption.data.executionReady, false);
  assert.ok(adoption.data.analysisId);
  const ownerRecord = await ask(base, '/v1/analyses/' + adoption.data.analysisId, { credential: token });
  const otherRecord = await ask(base, '/v1/analyses/' + adoption.data.analysisId, { credential: otherToken });
  assert.equal(ownerRecord.status, 404, 'research adoption stays outside legacy analysis endpoints');
  assert.equal(otherRecord.status, 404, 'a different owner cannot read the private adoption');
  const adoptedRecord = await store.getResearchAnalysis(owner, adoption.data.analysisId);
  assert.equal(adoptedRecord.analysis.snapshotHash, current.data.snapshotHash);
  assert.equal(await store.getResearchAnalysis(otherOwner, adoption.data.analysisId), null);
});
