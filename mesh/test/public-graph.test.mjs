import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import { createApi, parseTokenHashes } from '../http.mjs';
import { createLendingStore } from '../lending-store.mjs';
import { captureSource } from '../live.mjs';
import { createLendingIntentFixture } from './support/kamino-fixtures.mjs';
import { createPublicGraphService, PUBLIC_OWNER_ID, publicGraphView } from '../public-graph.mjs';
import { createStore } from '../store.mjs';
import { createKaminoBrowserFixture } from './support/kamino-fixtures.mjs';
import { MeshError } from '../domain.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('FALCON_MESH_TEST_DATABASE_URL must name an initialized disposable mesh database; DATABASE_URL is never used.');
const pool = new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const AT = '2026-10-12T12:00:00.000Z';
const PROGRAM_OBSERVATION = 'observation:live:solana-devnet-klend';
const SCENARIO = { proposedUnits: '500000', maxProposedUnits: '10000000', minBookLiquidityUnits: '1000000', maxObservationAgeSeconds: 300 };
const SIGNATURE = '1'.repeat(64);
const digest = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => error?.code === expected;
const owner = prefix => prefix + '_' + randomUUID().replaceAll('-', '');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

before(async () => { await createStore(pool).ready(); });
after(async () => { await pool.end(); });

async function harness(t) {
  let currentTime = AT;
  let failedConnector = null;
  let hardFailure = false;
  let captureCount = 0;
  const wallet = Keypair.generate().publicKey.toBase58();
  const clock = () => currentTime;
  const fixture = createKaminoBrowserFixture(wallet, clock);
  const capture = async (connectorId, options) => {
    captureCount += 1;
    if (hardFailure) throw new Error('private capture failure detail');
    return captureSource(connectorId, {
      ...options,
      fetchImpl: (url, init) => failedConnector === connectorId
        ? Promise.reject(new Error('private transport detail'))
        : fixture.publicFetch(url, init),
    });
  };
  const store = createStore(pool, { capture, now: clock });
  await store.invalidatePublicBundle();
  const publicGraph = createPublicGraphService({ store, capture, now: clock });
  t.after(async () => { await store.invalidatePublicBundle(); });
  return {
    store, publicGraph, wallet, clock, capture,
    time: () => currentTime,
    setTime: value => { currentTime = value; },
    advance: async (milliseconds = 61_000) => {
      currentTime = new Date(Date.parse(currentTime) + milliseconds).toISOString();
      return publicGraph.get();
    },
    failConnector: value => { failedConnector = value; },
    failHard: value => { hardFailure = value; },
    captures: () => captureCount,
  };
}

async function adopt(store, who, at) {
  return store.adoptPublicGraph(who, { requestId: randomUUID(), reserveRequestId: randomUUID() }, at);
}

function makeLender(h) {
  let prepareHook = async () => {};
  let verifyHook = async () => {};
  let prepareCount = 0;
  let verifyCount = 0;
  const lending = createLendingStore(pool, {
    meshStore: h.store,
    now: h.clock,
    prepareLending: async request => {
      prepareCount += 1;
      await prepareHook();
      return createLendingIntentFixture(request, h.clock);
    },
    verifySignedLending: async () => {
      verifyCount += 1;
      await verifyHook();
      return SIGNATURE;
    },
    readLendingReceipt: async () => { throw new Error('receipt adapter is not used in this regression'); },
  });
  return {
    lending,
    prepareCount: () => prepareCount,
    verifyCount: () => verifyCount,
    setPrepareHook: hook => { prepareHook = hook; },
    setVerifyHook: hook => { verifyHook = hook; },
  };
}

function reservedKeys(value, names) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => reservedKeys(item, names));
  return Object.entries(value).some(([key, child]) => names.has(key) || reservedKeys(child, names));
}

test('public graph is anonymous, metadata-only and adopts exact source bytes for separate owner traces', async t => {
  const h = await harness(t);
  const view = await h.publicGraph.get();
  assert.equal(view.scope, 'public-market-evidence');
  assert.equal(view.policyVersion, 'mesh-reserve-scenario/2');
  assert.equal(view.chain, 'solana');
  assert.equal(view.network, 'devnet');
  assert.equal(view.status, 'OBSERVED');
  assert.equal(view.executionReady, false);
  assert.equal(view.customGraphsSupported, false);
  assert.equal(view.maxSupplyBaseUnits, '1000000');
  assert.equal(view.programAnalysis.status, 'OBSERVED');
  assert.equal(view.reserveAnalysis.status, 'OBSERVED');
  assert.equal(view.graph.sources.length, 3);
  for (const source of view.graph.sources) {
    assert.deepEqual(Object.keys(source).sort(), ['capturedAt', 'observedAt', 'revisionId', 'sha256', 'sourceKey', 'sourceUrl']);
  }
  assert.equal(reservedKeys(view, new Set(['content', 'ownerId', 'actor', 'exchanges', 'bodyBase64', 'sessionToken'])), false);
  const encoded = JSON.stringify(view);
  for (const privateField of ['bodyBase64', 'exchange', PUBLIC_OWNER_ID, 'Controlled official document fixture']) assert.equal(encoded.includes(privateField), false);

  const token = 'public-graph-consumer-token-000000000000';
  const api = createApi({
    store: h.store, publicGraph: h.publicGraph,
    tokenHashes: new Map([[digest(token), owner('http')]]),
  });
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const base = 'http://127.0.0.1:' + api.address().port;
  const anonymous = await fetch(base + '/v1/public/graph/live');
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), view);
  const credentialed = await fetch(base + '/v1/public/graph/live', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(credentialed.status, 400, 'public graph reads must not bind to a caller session');
  assert.equal((await fetch(base + '/v1/public/graph/live?owner=private')).status, 400);

  assert.throws(() => parseTokenHashes(JSON.stringify({ [digest(token)]: PUBLIC_OWNER_ID })));
  assert.throws(() => createApi({ store: h.store, tokenHashes: new Map([[digest(token), PUBLIC_OWNER_ID]]) }));

  const bundle = await h.store.getPublicBundle();
  const firstOwner = owner('public_a');
  const secondOwner = owner('public_b');
  const first = await adopt(h.store, firstOwner, h.time());
  const second = await adopt(h.store, secondOwner, h.time());
  assert.equal(first.evidenceSource, 'public');
  assert.equal(first.graphRevision, view.graph.revision);
  assert.equal(first.record.graph.revision, second.record.graph.revision);
  assert.deepEqual(first.record.graph.sources, second.record.graph.sources);
  assert.notEqual(first.record.id, second.record.id);
  assert.notEqual(first.reserveRecord.id, second.reserveRecord.id);
  assert.equal(first.record.analysis.evidenceSource, 'public');
  assert.equal(first.record.analysis.publicGraphRevision, view.graph.revision);
  assert.equal(first.reserveRecord.analysis.evidenceSource, 'public');

  for (const original of bundle.sources) {
    const copied = await h.store.getSource(firstOwner, original.revisionId);
    assert.equal(copied.sourceKey, original.sourceKey);
    assert.equal(copied.sourceUrl, original.sourceUrl);
    assert.equal(copied.revisionId, original.revisionId);
    assert.equal(copied.sha256, original.sha256);
    assert.equal(copied.observedAt, original.observedAt);
    assert.equal(copied.capturedAt, original.capturedAt, 'adoption preserves original captured_at rather than rewriting it');
    assert.equal(copied.content, original.content, 'adoption SQL-copies exact source bytes, including retained exchange provenance');
  }
});

test('public lending errors do not disclose raw RPC exchanges', async t => {
  const token = 'public-error-consumer-token-000000000000';
  const error = new MeshError('INVALID_INPUT', 'public adapter failure');
  error.evidence = { exchanges: [{ request: { bodyBase64: 'private-request-body' }, response: { bodyBase64: 'private-response-body' } }] };
  const api = createApi({
    store: {},
    lending: { async preparePublic() { throw error; } },
    tokenHashes: new Map([[digest(token), owner('public_error')]]),
  });
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const response = await fetch('http://127.0.0.1:' + api.address().port + '/v1/public/lending/intents', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), analysisId: randomUUID(), wallet: 'wallet', action: 'supply', inputBaseUnits: '1', decisionId: randomUUID() }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(Object.hasOwn(result.error, 'evidence'), false);
  assert.equal(JSON.stringify(result).includes('private-request-body'), false);
  assert.equal(JSON.stringify(result).includes('private-response-body'), false);
});

test('public decisions, prepare and submit remain bound to the shared public head across races and retries', async t => {
  const h = await harness(t);
  const view = await h.publicGraph.get();
  const firstOwner = owner('trace_a');
  const secondOwner = owner('trace_b');
  const first = await adopt(h.store, firstOwner, h.time());
  const second = await adopt(h.store, secondOwner, h.time());
  const lender = makeLender(h);

  const privateAnalysis = await h.store.createAnalysis(firstOwner, {
    requestId: randomUUID(), observationId: PROGRAM_OBSERVATION, maxHops: 3,
  }, h.time(), 'live');
  const privateDecision = await h.store.createDecision(firstOwner, { requestId: randomUUID(), scenario: SCENARIO }, h.time());
  const privateRequest = {
    requestId: randomUUID(), analysisId: privateAnalysis.id, wallet: h.wallet,
    action: 'supply', inputBaseUnits: SCENARIO.proposedUnits, decisionId: privateDecision.id,
  };
  const privateIntent = await lender.lending.prepare(firstOwner, privateRequest);
  assert.equal(Object.hasOwn(privateIntent.intent, 'evidenceSource'), false);
  const preparesBeforePublicBypass = lender.prepareCount();
  await assert.rejects(lender.lending.preparePublic(firstOwner, privateRequest), code('CONFLICT'), 'the public-only route cannot replay a private intent by request ID');
  assert.equal(lender.prepareCount(), preparesBeforePublicBypass);

  for (const analysisId of [privateAnalysis.id, second.record.id, randomUUID()]) {
    await assert.rejects(h.store.createPublicDecision(firstOwner, {
      requestId: randomUUID(), analysisId, scenario: SCENARIO,
    }, h.time()), code('CONFLICT'), 'private, foreign and unknown analysis IDs share a fail-closed result');
  }
  const firstDecision = await h.store.createPublicDecision(firstOwner, {
    requestId: randomUUID(), analysisId: first.record.id, scenario: SCENARIO,
  }, h.time());
  const secondDecision = await h.store.createPublicDecision(secondOwner, {
    requestId: randomUUID(), analysisId: second.record.id,
    scenario: { ...SCENARIO, proposedUnits: '400000' },
  }, h.time());
  assert.equal(firstDecision.analysis.status, 'REVIEW');
  assert.equal(firstDecision.analysis.evidenceSource, 'public');
  assert.equal(firstDecision.analysis.publicGraphRevision, view.graph.revision);
  assert.equal(firstDecision.analysis.sourceAnalysisId, first.record.id);
  assert.ok(Array.isArray(firstDecision.analysis.decisionGraph.nodes));
  assert.notEqual(firstDecision.id, secondDecision.id);
  assert.notEqual(firstDecision.analysis.scenario.proposedUnits, secondDecision.analysis.scenario.proposedUnits);

  const publicRequest = () => ({
    requestId: randomUUID(), analysisId: first.record.id, wallet: h.wallet,
    action: 'supply', inputBaseUnits: SCENARIO.proposedUnits, decisionId: firstDecision.id,
  });
  const enteredPrepare = deferred();
  const finishPrepare = deferred();
  lender.setPrepareHook(async () => { enteredPrepare.resolve(); await finishPrepare.promise; });
  const racedRequest = publicRequest();
  const racedPrepare = lender.lending.preparePublic(firstOwner, racedRequest);
  await enteredPrepare.promise;
  const advanced = await h.advance();
  assert.equal(advanced.status, 'OBSERVED');
  assert.notEqual(advanced.graph.revision, view.graph.revision);
  finishPrepare.resolve();
  await assert.rejects(racedPrepare, error => error?.code === 'CONFLICT' && /do not broadcast/.test(error.message));
  const racedIntent = await pool.query('SELECT id FROM falcon_mesh.lending_intents WHERE owner_id = $1 AND request_id = $2', [firstOwner, racedRequest.requestId]);
  assert.equal(racedIntent.rows.length, 0, 'an intent is not persisted when publication advances during adapter work');
  await assert.rejects(h.store.createPublicDecision(firstOwner, {
    requestId: randomUUID(), analysisId: first.record.id, scenario: SCENARIO,
  }, h.time()), code('CONFLICT'), 'a prior public analysis cannot create a decision after the shared head advances');

  const refreshed = await adopt(h.store, firstOwner, h.time());
  const refreshedDecision = await h.store.createPublicDecision(firstOwner, {
    requestId: randomUUID(), analysisId: refreshed.record.id, scenario: SCENARIO,
  }, h.time());
  lender.setPrepareHook(async () => {});
  const prepared = await lender.lending.preparePublic(firstOwner, {
    requestId: randomUUID(), analysisId: refreshed.record.id, wallet: h.wallet,
    action: 'supply', inputBaseUnits: SCENARIO.proposedUnits, decisionId: refreshedDecision.id,
  });
  assert.equal(prepared.intent.evidenceSource, 'public');
  assert.equal(prepared.intent.publicGraphRevision, refreshed.graphRevision);
  assert.equal(prepared.intent.sourceAnalysisId, refreshed.record.id);

  const enteredVerify = deferred();
  const finishVerify = deferred();
  lender.setVerifyHook(async () => { enteredVerify.resolve(); await finishVerify.promise; });
  const signed = { requestId: randomUUID(), transactionBase64: Buffer.from('signed fixture').toString('base64') };
  const racedSubmit = lender.lending.submit(firstOwner, prepared.id, signed);
  await enteredVerify.promise;
  await h.advance();
  finishVerify.resolve();
  await assert.rejects(racedSubmit, error => error?.code === 'CONFLICT' && /do not broadcast/.test(error.message));
  assert.deepEqual((await lender.lending.get(firstOwner, prepared.id)).events, [], 'stale bytes are never registered after publication advances during signature verification');

  const latest = await adopt(h.store, firstOwner, h.time());
  const latestDecision = await h.store.createPublicDecision(firstOwner, {
    requestId: randomUUID(), analysisId: latest.record.id, scenario: SCENARIO,
  }, h.time());
  lender.setVerifyHook(async () => {});
  const registeredIntent = await lender.lending.preparePublic(firstOwner, {
    requestId: randomUUID(), analysisId: latest.record.id, wallet: h.wallet,
    action: 'supply', inputBaseUnits: SCENARIO.proposedUnits, decisionId: latestDecision.id,
  });
  const registeredRequest = { requestId: randomUUID(), transactionBase64: Buffer.from('registered fixture').toString('base64') };
  await lender.lending.submit(firstOwner, registeredIntent.id, registeredRequest);
  const verifyCountAfterRegistration = lender.verifyCount();
  await h.advance();
  await assert.rejects(lender.lending.submit(firstOwner, registeredIntent.id, registeredRequest), error => error?.code === 'CONFLICT' && /do not broadcast/.test(error.message),
    'a public registered retry must recheck the shared head before returning its saved event');
  assert.equal(lender.verifyCount(), verifyCountAfterRegistration, 'a stale registered retry stops before adapter verification');
});

test('failed stale capture cannot invalidate a newer public graph head', async t => {
  const h = await harness(t);
  const original = await h.publicGraph.get();
  const originalBundle = await h.store.getPublicBundle();
  assert.equal(original.status, 'OBSERVED');
  assert.ok(originalBundle);

  const captureStarted = deferred();
  const releaseCapture = deferred();
  const staleService = createPublicGraphService({
    store: h.store,
    capture: async () => {
      captureStarted.resolve();
      await releaseCapture.promise;
      throw new Error('stale capture failed');
    },
    now: h.clock,
  });
  h.setTime(new Date(Date.parse(h.time()) + 61_000).toISOString());

  const failedRequest = staleService.get();
  await captureStarted.promise;

  const newer = await h.publicGraph.get();
  assert.equal(newer.status, 'OBSERVED');
  const newerBundle = await h.store.getPublicBundle();
  assert.ok(newerBundle);
  assert.notDeepEqual(newerBundle.sources, originalBundle.sources, 'the concurrent refresh publishes a newer complete head');

  releaseCapture.resolve();
  const failed = await failedRequest;
  assert.equal(failed.status, 'NO_DATA');

  const retainedBundle = await h.store.getPublicBundle();
  assert.deepEqual(retainedBundle?.sources, newerBundle.sources, 'the stale failure must retain the exact newer head');
  const capturesBeforeRead = h.captures();
  const usable = await h.publicGraph.get();
  assert.equal(usable.status, 'OBSERVED');
  const bySourceKey = (sources) => sources.map(({ content, ...metadata }) => metadata).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  assert.deepEqual(bySourceKey(usable.graph.sources), bySourceKey(newerBundle.sources));
  assert.equal(h.captures(), capturesBeforeRead, 'the retained newer head is usable without recapture');
});

test('V181: a successful stale capture can publish after a failing capture invalidates its snapshot', async t => {
  const h = await harness(t);
  await h.publicGraph.get();
  const staleBundle = await h.store.getPublicBundle();
  const capturesBeforeRefresh = h.captures();
  h.setTime(new Date(Date.parse(h.time()) + 61_000).toISOString());

  const failedCaptureStarted = deferred();
  const releaseFailedCapture = deferred();
  const failingService = createPublicGraphService({
    store: h.store,
    capture: async () => {
      failedCaptureStarted.resolve();
      await releaseFailedCapture.promise;
      throw new Error('concurrent capture failed');
    },
    now: h.clock,
  });

  const successfulPublishStarted = deferred();
  const releaseSuccessfulPublish = deferred();
  const publishExpectedSources = [];
  const successfulStore = {
    getPublicBundle: () => h.store.getPublicBundle(),
    invalidatePublicBundle: (...args) => h.store.invalidatePublicBundle(...args),
    publishPublicBundle: async (revisions, expectedSources) => {
      publishExpectedSources.push(expectedSources);
      if (publishExpectedSources.length === 1) {
        successfulPublishStarted.resolve();
        await releaseSuccessfulPublish.promise;
      }
      return h.store.publishPublicBundle(revisions, expectedSources);
    },
  };
  const successfulService = createPublicGraphService({ store: successfulStore, capture: h.capture, now: h.clock });

  const failedRequest = failingService.get();
  await failedCaptureStarted.promise;
  const successfulRequest = successfulService.get();
  await successfulPublishStarted.promise;

  releaseFailedCapture.resolve();
  assert.equal((await failedRequest).status, 'NO_DATA');
  assert.equal(await h.store.getPublicBundle(), null, 'the failing request invalidates the stale snapshot first');

  releaseSuccessfulPublish.resolve();
  const successful = await successfulRequest;
  assert.equal(successful.status, 'OBSERVED', 'the captured revisions retry publication against the empty head');
  assert.equal(publishExpectedSources.length, 2, 'the successful capture retries exactly once');
  assert.deepEqual(publishExpectedSources[0], staleBundle.sources);
  assert.equal(publishExpectedSources[1], null, 'the retry uses the empty-head CAS');
  assert.equal(h.captures(), capturesBeforeRefresh + 3, 'the retry reuses captured revisions without recapturing');
  const publishedBundle = await h.store.getPublicBundle();
  assert.ok(publishedBundle);
  assert.notDeepEqual(publishedBundle.sources, staleBundle.sources);
  const identities = sources => sources.map(({ sourceKey, revisionId }) => ({ sourceKey, revisionId }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  assert.deepEqual(identities(successful.graph.sources), identities(publishedBundle.sources));
});

test('V181: a lost empty-head retry returns a usable concurrent winner without recapturing', async t => {
  const h = await harness(t);
  await h.publicGraph.get();
  const staleBundle = await h.store.getPublicBundle();
  const capturesBeforeRace = h.captures();
  h.setTime(new Date(Date.parse(h.time()) + 61_000).toISOString());

  const failedCaptureStarted = deferred();
  const releaseFailedCapture = deferred();
  const failingService = createPublicGraphService({
    store: h.store,
    capture: async () => {
      failedCaptureStarted.resolve();
      await releaseFailedCapture.promise;
      throw new Error('concurrent capture failed');
    },
    now: h.clock,
  });

  const successfulPublishStarted = deferred();
  const releaseSuccessfulPublish = deferred();
  const publishExpectedSources = [];
  const concurrentService = createPublicGraphService({ store: h.store, capture: h.capture, now: h.clock });
  let interceptEmptyBundle = true;
  let concurrentWinner;
  let capturesAtWinner;
  const successfulStore = {
    getPublicBundle: async () => {
      const bundle = await h.store.getPublicBundle();
      if (interceptEmptyBundle && bundle === null) {
        interceptEmptyBundle = false;
        concurrentWinner = await concurrentService.get();
        capturesAtWinner = h.captures();
      }
      return bundle;
    },
    invalidatePublicBundle: (...args) => h.store.invalidatePublicBundle(...args),
    publishPublicBundle: async (revisions, expectedSources) => {
      publishExpectedSources.push(expectedSources);
      if (publishExpectedSources.length === 1) {
        successfulPublishStarted.resolve();
        await releaseSuccessfulPublish.promise;
      }
      return h.store.publishPublicBundle(revisions, expectedSources);
    },
  };
  const successfulService = createPublicGraphService({ store: successfulStore, capture: h.capture, now: h.clock });

  const failedRequest = failingService.get();
  await failedCaptureStarted.promise;
  const successfulRequest = successfulService.get();
  await successfulPublishStarted.promise;

  releaseFailedCapture.resolve();
  assert.equal((await failedRequest).status, 'NO_DATA');
  assert.equal(await h.store.getPublicBundle(), null, 'the failing request invalidates the shared snapshot first');
  releaseSuccessfulPublish.resolve();

  const successful = await successfulRequest;
  assert.equal(concurrentWinner?.status, 'OBSERVED');
  assert.equal(successful.status, 'OBSERVED', 'a lost empty-head retry returns the usable winner');
  assert.equal(publishExpectedSources.length, 2);
  assert.deepEqual(publishExpectedSources[0], staleBundle.sources);
  assert.equal(publishExpectedSources[1], null);
  const winnerBundle = await h.store.getPublicBundle();
  assert.ok(winnerBundle);
  const identities = sources => sources.map(({ sourceKey, revisionId }) => ({ sourceKey, revisionId }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  assert.deepEqual(identities(successful.graph.sources), identities(winnerBundle.sources));
  assert.deepEqual(identities(concurrentWinner.graph.sources), identities(winnerBundle.sources));
  assert.equal(h.captures(), capturesAtWinner, 'the failed retry neither overwrites the winner nor recaptures');
  assert.equal(h.captures(), capturesBeforeRace + 6);
});

test('failed current captures and stale source views return NO_DATA without last-good fallback', async t => {
  const h = await harness(t);
  const first = await h.publicGraph.get();
  const oldBundle = await h.store.getPublicBundle();
  const staleAt = new Date(Date.parse(h.time()) + 301_000).toISOString();
  const stale = publicGraphView(oldBundle.sources, staleAt);
  assert.equal(stale.status, 'NO_DATA');
  assert.equal(stale.programAnalysis.status, 'NO_DATA');
  assert.equal(stale.reserveAnalysis.status, 'NO_DATA');

  h.failConnector('solana-devnet-reserve-liquidity');
  const failed = await h.advance();
  assert.equal(failed.status, 'NO_DATA');
  assert.equal(failed.reserveAnalysis.status, 'NO_DATA');
  assert.equal(failed.graph.sources.length, 3);
  assert.notEqual(failed.graph.revision, first.graph.revision, 'the current failed capture replaces, rather than falls back to, prior successful revisions');
  const persistedFailure = await h.store.getPublicBundle();
  assert.ok(persistedFailure.sources.some(source => source.revisionId !== oldBundle.sources.find(old => old.sourceKey === source.sourceKey).revisionId));
  const captureCount = h.captures();
  const otherReplica = createPublicGraphService({ store: h.store, capture: h.capture, now: h.clock });
  assert.equal((await otherReplica.get()).status, 'NO_DATA');
  assert.equal(h.captures(), captureCount, 'another process consumes the persisted failed head rather than serving an old good graph');

  h.failHard(true);
  const unavailable = await h.advance();
  assert.equal(unavailable.status, 'NO_DATA');
  assert.equal(unavailable.graph.sources.length, 0);
  assert.equal(await h.store.getPublicBundle(), null, 'a thrown current capture invalidates the public head instead of retaining last-good evidence');
});

test('V169: anonymous graph reads reserve source and global budgets before storage', async t => {
  for (const limits of [{ walletLookupMaxPerSource: 1, walletLookupMaxGlobal: 10 }, { walletLookupMaxPerSource: 10, walletLookupMaxGlobal: 1 }]) {
    let calls = 0, time = 0;
    const api = createApi({ store: {}, publicGraph: { async get() { calls++; return { status: 'NO_DATA', executionReady: false }; } },
      tokenHashes: new Map([['0'.repeat(64), 'graph_budget']]), rateWindowMs: 1000, clock: () => time, ...limits });
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
    t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
    const url = 'http://127.0.0.1:' + api.address().port + '/v1/public/graph/live';
    assert.equal((await fetch(url)).status, 200);
    const blocked = await fetch(url);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error.code, 'RATE_LIMITED');
    assert.equal(calls, 1);
    time = 1000;
    assert.equal((await fetch(url)).status, 200);
    assert.equal(calls, 2);
  }
});
