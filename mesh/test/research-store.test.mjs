import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../store.mjs';
import { MeshError } from '../domain.mjs';
import { CONNECTORS, captureSource } from '../live.mjs';
import { PUBLIC_OWNER_ID } from '../public-graph.mjs';
import { createKaminoBrowserFixture } from './support/kamino-fixtures.mjs';
import { canonicalBytes, sha256, stableStringify } from '../council/evidence.ts';
import { captureNearEvidence, decodeNearEvidence, NEAR_REVENUE_SOURCE_URL } from '../research/near-source.mjs';
import { evaluateNearModel, NEAR_MODEL_VERSION } from '../research/near-model.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const at = '2026-10-21T13:55:16.791Z';
const testLock = createHash('sha256').update('falcon_mesh_test:near_research').digest().readBigInt64BE().toString();
const code = expected => error => error?.code === expected;
const owner = prefix => prefix + '_' + randomUUID().replaceAll('-', '');

function page() {
  const payload = {
    revenueSeries: [{ period_month: '2026-10-01', revenue_usd: 12.5, revenue_near: 1.25, cumulative_revenue_usd: 12.5, cumulative_revenue_near: 1.25, is_stale: 0 }],
    intentVolumeSeries: [{ date_at: '2026-10-20', volume_usd: 100, cumulative_volume_usd: 100, source_used: 'dune:5179085', is_stale: 0 }],
    totalFeesSeries: [{ date_at: '2026-10-20', total_fees_near: 2, protocol_fee_near: 0.2, intents_revenue_near: 0.3, burn_revenue_near: 0.1, cumulative_fees_near: 2, cumulative_protocol_fee_near: 0.2, cumulative_intents_revenue_near: 0.3, fees_usd: 20, cumulative_fees_usd: 20, near_source_used: 'dune:6732575', usd_source_used: 'dune:6162763', is_stale: 0 }],
  };
  const encoded = JSON.stringify(payload);
  const chunk = 'self.__next_f.push([1,' + JSON.stringify('0:' + encoded) + ']);';
  return '<!doctype html><html><body><script>' + chunk + '</script></body></html>';
}

async function capturePacket() {
  return captureNearEvidence({
    fetchImpl: async url => {
      assert.equal(url, NEAR_REVENUE_SOURCE_URL);
      return new Response(page(), { status: 200 });
    },
    now: () => at,
  });
}

function researchCase(packet) {
  const caseId = randomUUID();
  const decoded = decodeNearEvidence(packet);
  const modelResult = evaluateNearModel(decoded);
  const sourceRefs = packet.parts.map(part => {
    const envelope = stableStringify({
      schemaVersion: packet.schemaVersion,
      adapterVersion: packet.adapterVersion,
      sourceKey: packet.sourceKey,
      sourceUrl: packet.sourceUrl,
      capturedAt: packet.capturedAt,
      rawBodySha256: packet.rawBodySha256,
      rawBodyBytes: packet.rawBodyBytes,
      codec: packet.codec,
      compressedBytes: packet.compressedBytes,
      parts: [part],
    });
    return { revisionId: randomUUID(), sha256: sha256(new TextEncoder().encode(envelope)) };
  });
  const snapshot = {
    schemaVersion: 1,
    domain: 'near-thesis',
    adapterVersion: packet.adapterVersion,
    sourceUrl: packet.sourceUrl,
    capturedAt: decoded.capturedAt,
    rawBodySha256: decoded.rawBodySha256,
    rawBodyBytes: decoded.rawBodyBytes,
    sourceRefs,
    modelVersion: NEAR_MODEL_VERSION,
    modelResult,
  };
  return {
    packet,
    case: {
      schemaVersion: 1,
      caseType: 'near-thesis',
      caseId,
      requestId: randomUUID(),
      createdAt: at,
      status: modelResult.status,
      snapshot,
      snapshotHash: sha256(canonicalBytes(snapshot)),
      modelResult,
      sourceRefs,
      manifestRevisionId: randomUUID(),
      issues: decoded.issues,
      executionReady: false,
    },
  };
}

async function publishResearchCase(store, prepared) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await store.getPublicResearchBundle();
    try {
      return await store.publishPublicResearchCase({
        case: prepared.case,
        packet: prepared.packet,
        expectedManifestRevisionId: current?.manifestRevisionId ?? null,
      });
    } catch (error) {
      if (!(error instanceof MeshError) || error.code !== 'CONFLICT') throw error;
      const prior = await store.getPublicResearchCase(prepared.case.caseId);
      if (prior) return { manifestRevisionId: prior.manifestRevisionId, manifest: null, case: prior };
    }
  }
  throw new Error('Research case publication did not converge.');
}

async function ensureLegacyPublicBundle(store) {
  const existing = await store.getPublicBundle();
  if (existing) return { bundle: existing, seeded: null };
  await store.invalidatePublicBundle();
  const wallet = Keypair.generate().publicKey.toBase58();
  const fixture = createKaminoBrowserFixture(wallet, () => at);
  const revisions = await Promise.all(CONNECTORS.map(async connector => ({
    revisionId: randomUUID(),
    capturedAt: at,
    content: await captureSource(connector.id, { now: () => at, fetchImpl: fixture.publicFetch }),
  })));
  try {
    const seeded = await store.publishPublicBundle(revisions, null);
    return { bundle: seeded, seeded: seeded.sources };
  } catch (error) {
    const winner = await store.getPublicBundle();
    if (winner) return { bundle: winner, seeded: null };
    throw error;
  }
}

test('research publication and owner adoption stay within the existing source and analysis records', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 3000 });
  const lock = await pool.connect();
  await lock.query('SELECT pg_advisory_lock($1::bigint)', [testLock]);
  const store = createStore(pool, { now: () => at });
  let seededLegacySources = null;
  t.after(async () => {
    if (seededLegacySources) await store.invalidatePublicBundle(seededLegacySources);
    await lock.query('SELECT pg_advisory_unlock($1::bigint)', [testLock]);
    lock.release();
    await pool.end();
  });
  await store.ready();
  const legacy = await ensureLegacyPublicBundle(store);
  seededLegacySources = legacy.seeded;

  const privateOwner = owner('research_store');
  const stranger = owner('research_stranger');
  await store.adoptPublicGraph(privateOwner, { requestId: randomUUID(), reserveRequestId: randomUUID() }, at);
  const liveBefore = await store.getGraph(privateOwner, at, 'live');
  assert.equal(liveBefore.sources.length, CONNECTORS.length);

  const userObservation = await store.createAnalysis(privateOwner, {
    requestId: randomUUID(), observationId: 'near-research/user-observation', maxHops: 1,
  }, at);
  const prepared = researchCase(await capturePacket());
  const publicRecord = await publishResearchCase(store, prepared);
  assert.deepEqual(Object.keys(publicRecord.case).sort(), [
    'caseId', 'caseType', 'createdAt', 'executionReady', 'issues', 'manifestRevisionId', 'modelResult',
    'requestId', 'schemaVersion', 'snapshot', 'snapshotHash', 'sourceRefs', 'status',
  ].sort());
  assert.equal(publicRecord.case.status, 'OBSERVED');
  assert.equal(publicRecord.case.executionReady, false);
  assert.equal(publicRecord.case.modelResult.investmentAssessment.status, 'NO_DATA');
  assert.equal(publicRecord.case.snapshot.rawBodySha256, prepared.packet.rawBodySha256);
  assert.notEqual(publicRecord.case.snapshot.rawBodySha256, publicRecord.case.sourceRefs[0].sha256, 'raw-body digest is distinct from the retained source-record digest');
  assert.equal(publicRecord.manifest.recordKind, 'near-research/manifest');
  assert.equal(publicRecord.manifest.rawParts.length, publicRecord.case.sourceRefs.length);
  assert.deepEqual(await store.getPublicResearchCase(publicRecord.case.caseId), publicRecord.case);
  assert.equal((await store.getPublicResearchBundle()).manifestRevisionId, publicRecord.manifestRevisionId);

  const publicBundleAfter = await store.getPublicBundle();
  assert.ok(publicBundleAfter);
  assert.deepEqual(publicBundleAfter.sources.map(source => source.sourceKey), legacy.bundle.sources.map(source => source.sourceKey));
  assert.equal(publicBundleAfter.sources.some(source => source.sourceKey.startsWith('research:near')), false);

  const firstPart = publicRecord.case.sourceRefs[0];
  const publicSource = await store.getPublicResearchSource(firstPart.revisionId);
  assert.equal(publicSource.sha256, firstPart.sha256);
  assert.equal(publicSource.sourceUrl, NEAR_REVENUE_SOURCE_URL);
  assert.equal(JSON.parse(publicSource.content).parts.length, 1);
  assert.equal(await store.getPublicResearchSource(userObservation.id), null);
  assert.equal(await store.getPublicResearchCase(userObservation.id), null);
  assert.equal(await store.getSource(privateOwner, firstPart.revisionId), null);
  assert.equal(await store.getResearchAnalysis(stranger, userObservation.id), null);

  const adoptionInput = { requestId: randomUUID(), publicCaseId: publicRecord.case.caseId };
  const adopted = await store.adoptResearchCase(privateOwner, adoptionInput, at);
  assert.equal(adopted.status, 'ADOPTED');
  assert.equal(adopted.publicCaseId, publicRecord.case.caseId);
  assert.equal(adopted.snapshotHash, publicRecord.case.snapshotHash);
  assert.equal(adopted.executionReady, false);
  assert.deepEqual(adopted.sourceRefs, publicRecord.case.sourceRefs);
  assert.deepEqual(await store.adoptResearchCase(privateOwner, adoptionInput, at), adopted);
  const secondOwner = await store.adoptResearchCase(stranger, { requestId: randomUUID(), publicCaseId: publicRecord.case.caseId }, at);
  assert.equal(secondOwner.status, 'ADOPTED');
  assert.notEqual(secondOwner.analysisId, adopted.analysisId);
  assert.equal(await store.getResearchAnalysis(stranger, adopted.analysisId), null, "an owner cannot read another owner's adopted analysis");

  const secondCase = researchCase(await capturePacket());
  const secondPublicRecord = await publishResearchCase(store, secondCase);
  await assert.rejects(store.adoptResearchCase(privateOwner, {
    requestId: adoptionInput.requestId, publicCaseId: secondPublicRecord.case.caseId,
  }, at), code('CONFLICT'));

  const researchAnalysis = await store.getResearchAnalysis(privateOwner, adopted.analysisId);
  assert.equal(researchAnalysis.analysis.recordKind, 'near-research/adopted/1');
  assert.equal(researchAnalysis.graph.snapshotHash, publicRecord.case.snapshotHash);
  assert.equal(researchAnalysis.graph.snapshot.modelResult.investmentAssessment.status, 'NO_DATA');
  assert.equal(await store.getAnalysis(privateOwner, adopted.analysisId), null);
  assert.ok((await store.listResearchAnalyses(privateOwner)).some(item => item.id === adopted.analysisId));
  const legacyAnalyses = await store.listAnalyses(privateOwner);
  assert.ok(legacyAnalyses.some(item => item.id === userObservation.id), 'an arbitrary observation ID with the research prefix remains in legacy history');
  assert.equal(legacyAnalyses.some(item => item.id === adopted.analysisId), false);
  assert.deepEqual(await store.getAnalysis(privateOwner, userObservation.id), userObservation);

  const decision = await store.createDecision(privateOwner, {
    requestId: randomUUID(),
    scenario: { proposedUnits: '500000', maxProposedUnits: '10000000', minBookLiquidityUnits: '1000000', maxObservationAgeSeconds: 300 },
  }, at);
  assert.equal(await store.getAnalysis(privateOwner, decision.id), null);
  assert.equal((await store.getDecision(privateOwner, decision.id)).id, decision.id);
  assert.ok((await store.listDecisions(privateOwner)).some(item => item.id === decision.id));
  assert.equal((await store.listAnalyses(privateOwner)).some(item => item.id === decision.id), false);

  const privateHeads = await pool.query('SELECT source_key FROM falcon_mesh.source_heads WHERE owner_id = $1 ORDER BY source_key', [privateOwner]);
  assert.deepEqual(privateHeads.rows.map(row => row.source_key), liveBefore.sources.map(source => source.sourceKey).sort());
  assert.deepEqual(await store.getGraph(privateOwner, at, 'live'), liveBefore, 'research adoption leaves the private live graph unchanged');
  for (const ref of publicRecord.case.sourceRefs) assert.equal(await store.getSource(privateOwner, ref.revisionId), null);

  const sql = await pool.query('SELECT max_hops FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2', [privateOwner, adopted.analysisId]);
  assert.equal(sql.rows[0].max_hops, 1);
  assert.equal(PUBLIC_OWNER_ID, '__falcon_public_market_evidence__');
});
