import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Keypair, PublicKey } from '@solana/web3.js';
import { MeshError } from '../domain.mjs';
import { deriveWalletOwnerId } from '../wallet-auth.mjs';
import { canonicalBytes, sha256 } from '../council/evidence.ts';
import { createCfoStore } from '../cfo/store.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const code = expected => error => error instanceof MeshError && error.code === expected;
const reserveAssetId = 'fixture:reserve';
const targetAssetId = 'fixture:receipt';

function mandate(wallet) {
  return {
    schemaVersion: 1, wallet, reserveAssetId, reserveFloorBaseUnits: '0', maxActionReserveBaseUnits: '1000',
    maxPositionBps: 10000, slippageBps: 50, maxFeeBps: 100, maxEvidenceAgeSeconds: 300,
    targets: [{ assetId: targetAssetId, weightBps: 10000 }], monitorIntervalSeconds: 1, maxMonitorCycles: 2,
  };
}
function portfolio(wallet, capturedAt = new Date().toISOString()) {
  return {
    schemaVersion: 1, chain: 'near', network: 'mainnet', wallet,
    signerId: Buffer.from(new PublicKey(wallet).toBytes()).toString('hex'),
    capturedAt, blockHash: 'finalized-fixture-block', blockHeight: 1,
    assets: [], balances: [{ assetId: reserveAssetId, balanceBaseUnits: '1000' }],
    status: 'OBSERVED', reasons: [],
  };
}
function executableQuote(originAssetId, destinationAssetId, amount, deadline) {
  const capturedAt = new Date(Date.parse(deadline) - 120_000).toISOString();
  const raw = {
    timestamp: capturedAt,
    quoteRequest: {
      dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 50, originAsset: originAssetId, depositType: 'INTENTS',
      destinationAsset: destinationAssetId, amount, refundTo: 'fixture-signer', refundType: 'INTENTS',
      recipient: 'fixture-signer', recipientType: 'INTENTS', deadline,
    },
    quote: {
      amountIn: amount, minAmountIn: amount, amountOut: '1', minAmountOut: '1', deadline,
      depositAddress: 'fixture-deposit', refundFee: '0', withdrawFee: '0',
    },
  };
  return { schemaVersion: 1, capturedAt, raw, sha256: sha256(canonicalBytes(raw)), signatureVerified: true };
}
function actionData(wallet, actionId, planId, mandateId, portfolioId, requestId, preparationLeaseUntil) {
  return {
    schemaVersion: 1, wallet, actionId, action: 'invest', planId, mandateId, leg: 0, status: 'PREPARING', rotationState: 'NONE',
    sourceAssetId: reserveAssetId, targetAssetId, rotationTargetAssetId: null, inputBaseUnits: '10',
    preparationLeaseUntil, portfolioId, quote: executableQuote(reserveAssetId, targetAssetId, '10', preparationLeaseUntil),
    standard: null, payload: null, signatureBase64: null, signedData: null, intentHash: null, correlationId: null,
    providerStatus: null, nearTxHashes: null, amounts: null, reason: null, receiptPortfolioId: null,
    nextPlanId: null, beforeReserveBaseUnits: '1000', createdFromRequestId: requestId,
  };
}
function reviewData(wallet, jobId, planRecord) {
  const now = Date.now();
  return {
    schemaVersion: 1, wallet, jobId, planId: planRecord.id, snapshotHash: planRecord.data.snapshotHash,
    state: 'PENDING', phase: 'PREFLIGHT', result: null,
    deadlineAt: new Date(now + 60_000).toISOString(), leaseUntil: new Date(now + 30_000).toISOString(),
    workerId: randomUUID(), sourceRefs: planRecord.data.sourceRefs,
  };
}
async function planForReview(store, owner, wallet, mandateRecord, portfolioRecord, jobId) {
  const quotes = await store.append(owner, {
    requestId: randomUUID(), kind: 'quotes', data: { schemaVersion: 1, wallet, quotes: [] },
  });
  const request = { requestId: randomUUID(), action: 'invest', sourceAssetId: reserveAssetId, targetAssetId, inputBaseUnits: '10' };
  const snapshot = {
    schemaVersion: 1, domain: 'cfo', capturedAt: portfolioRecord.data.capturedAt,
    portfolio: portfolioRecord.data, mandate: mandateRecord.data,
    mandateHash: sha256(canonicalBytes(mandateRecord.data)), request, quotes: [],
    proposal: null, checks: [], reasons: ['Fixture-only review storage binding.'], status: 'NO_DATA',
  };
  const sourceRefs = [
    { revisionId: mandateRecord.id, sha256: mandateRecord.contentHash },
    { revisionId: portfolioRecord.id, sha256: portfolioRecord.contentHash },
    { revisionId: quotes.record.id, sha256: quotes.record.contentHash },
  ];
  return (await store.append(owner, {
    requestId: request.requestId, kind: 'plan',
    data: {
      schemaVersion: 1, wallet, request, snapshot, snapshotHash: sha256(canonicalBytes(snapshot)),
      sourceRefs, quoteBindings: [], status: 'NO_DATA', reviewJobId: jobId, workflow: 'SINGLE',
    },
  })).record;
}

test('CFO records bind exact requests and one open action across store replicas', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  t.after(async () => { await pool.end(); });
  await pool.query('SELECT 1 FROM falcon_mesh.analyses LIMIT 1');
  const store = createCfoStore(pool);
  const replica = createCfoStore(pool);
  const wallet = Keypair.generate().publicKey.toBase58();
  const otherWallet = Keypair.generate().publicKey.toBase58();
  const owner = deriveWalletOwnerId(wallet);
  const otherOwner = deriveWalletOwnerId(otherWallet);

  const mandateRequestId = randomUUID();
  const normalizedMandate = mandate(wallet);
  const firstMandate = await store.append(owner, { requestId: mandateRequestId, kind: 'mandate', data: normalizedMandate });
  assert.equal(firstMandate.inserted, true);
  assert.deepEqual((await replica.append(owner, { requestId: mandateRequestId, kind: 'mandate', data: normalizedMandate })).record, firstMandate.record);
  assert.equal((await replica.append(owner, { requestId: mandateRequestId, kind: 'mandate', data: normalizedMandate })).inserted, false);
  await assert.rejects(
    replica.append(owner, { requestId: mandateRequestId, kind: 'mandate', data: { ...normalizedMandate, maxFeeBps: 99 } }),
    code('CONFLICT'),
  );
  assert.deepEqual(await store.get(owner, firstMandate.record.id), firstMandate.record);
  assert.equal(await store.get(otherOwner, firstMandate.record.id), null, 'a different wallet owner cannot read the retained mandate');
  assert.match(await store.clock(owner), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

  const portfolioRecord = await store.append(owner, {
    requestId: randomUUID(), kind: 'portfolio', data: portfolio(wallet),
  });
  const deadline = new Date(Date.now() + 30_000).toISOString();
  const requests = [randomUUID(), randomUUID()];
  const candidates = requests.map(requestId => {
    const actionId = randomUUID();
    const data = actionData(wallet, actionId, randomUUID(), firstMandate.record.id, portfolioRecord.record.id, requestId, deadline);
    return {
      requestId,
      kind: 'action',
      data,
      exclusiveAction: { mode: 'CREATE', actionId, assetId: reserveAssetId, baseUnits: '10', portfolioId: portfolioRecord.record.id, mandateId: firstMandate.record.id },
    };
  });
  const attempts = await Promise.all([
    store.append(owner, candidates[0]).then(value => ({ value }), error => ({ error })),
    replica.append(owner, candidates[1]).then(value => ({ value }), error => ({ error })),
  ]);
  const winners = attempts.filter(result => result.value);
  const losers = attempts.filter(result => result.error);
  assert.equal(winners.length, 1, 'the owner lock admits only one open reservation across separate store instances');
  assert.equal(losers.length, 1);
  assert.equal(losers[0].error.code, 'CONFLICT');

  const winningAttempt = attempts[0].value ? candidates[0] : candidates[1];
  const winningStore = attempts[0].value ? store : replica;
  const winningRecord = attempts[0].value?.record ?? attempts[1].value.record;
  const repeated = await winningStore.append(owner, winningAttempt);
  assert.equal(repeated.inserted, false, 'the original reservation request is exactly idempotent');
  assert.deepEqual(repeated.record, winningRecord);
  const changedContent = {
    ...winningAttempt,
    data: { ...winningAttempt.data, inputBaseUnits: '11' },
    exclusiveAction: { ...winningAttempt.exclusiveAction, baseUnits: '11' },
  };
  await assert.rejects(winningStore.append(owner, changedContent), code('CONFLICT'));

  const unknown = await winningStore.append(owner, {
    requestId: randomUUID(), kind: 'action', expectedHeadId: winningRecord.id,
    data: {
      ...winningRecord.data,
      status: 'SUBMISSION_UNKNOWN', preparationLeaseUntil: null,
      signatureBase64: Buffer.alloc(64, 7).toString('base64'),
      signedData: { standard: 'raw_ed25519', payload: 'exact generated intent', public_key: 'ed25519:fixture', signature: 'ed25519:fixture' },
      reason: 'Relay outcome is uncertain.',
    },
  });
  const blockedRequestId = randomUUID();
  const blockedActionId = randomUUID();
  await assert.rejects(
    store.append(owner, {
      requestId: blockedRequestId, kind: 'action',
      data: actionData(wallet, blockedActionId, randomUUID(), firstMandate.record.id, portfolioRecord.record.id, blockedRequestId, deadline),
      exclusiveAction: { mode: 'CREATE', actionId: blockedActionId, assetId: reserveAssetId, baseUnits: '10', portfolioId: portfolioRecord.record.id, mandateId: firstMandate.record.id },
    }),
    code('CONFLICT'),
  );
  assert.equal((await replica.latestAction(owner, winningRecord.data.actionId)).id, unknown.record.id);
  assert.equal((await store.get(owner, winningRecord.id)).data.status, 'PREPARING', 'old rows remain immutable after transitions');

  const firstJobId = randomUUID();
  const secondJobId = randomUUID();
  const firstPlan = await planForReview(store, owner, wallet, firstMandate.record, portfolioRecord.record, firstJobId);
  const secondPlan = await planForReview(store, owner, wallet, firstMandate.record, portfolioRecord.record, secondJobId);
  const firstJob = await store.append(owner, { requestId: firstJobId, kind: 'review', data: reviewData(wallet, firstJobId, firstPlan) });
  const secondJob = await store.append(owner, { requestId: secondJobId, kind: 'review', data: reviewData(wallet, secondJobId, secondPlan) });
  const firstPhase = await store.append(owner, {
    requestId: randomUUID(), kind: 'review', expectedHeadId: firstJob.record.id,
    data: { ...firstJob.record.data, phase: 'LEAD', leaseUntil: new Date(Date.now() + 30_000).toISOString() },
  });
  const secondPhase = await store.append(owner, {
    requestId: randomUUID(), kind: 'review', expectedHeadId: secondJob.record.id,
    data: { ...secondJob.record.data, phase: 'RISK', leaseUntil: new Date(Date.now() + 30_000).toISOString() },
  });
  assert.equal((await replica.latestReview(owner, firstJobId)).id, firstPhase.record.id);
  assert.equal((await store.latestReview(owner, secondJobId)).id, secondPhase.record.id, 'review heads are owner-locked and job-scoped');
});

test('V207: append sequence, not tied timestamps or UUID order, selects the current financial state', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const wallet = Keypair.generate().publicKey.toBase58();
  const owner = deriveWalletOwnerId(wallet);
  t.after(async () => { await pool.query('DELETE FROM falcon_mesh.analyses WHERE owner_id=$1', [owner]); await pool.end(); });
  const store = createCfoStore(pool);
  const savedMandate = (await store.append(owner, { requestId: randomUUID(), kind: 'mandate', data: mandate(wallet) })).record;
  const savedPortfolio = (await store.append(owner, { requestId: randomUUID(), kind: 'portfolio', data: portfolio(wallet) })).record;
  const actionId = randomUUID();
  const oldId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const newId = '00000000-0000-4000-8000-000000000000';
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const base = actionData(wallet, actionId, randomUUID(), savedMandate.id, savedPortfolio.id, randomUUID(), deadline);
  for (const [recordId, sequence, status] of [[oldId, '3', 'PREPARED'], [newId, '4', 'FAILED']]) {
    const requestId = randomUUID();
    const data = { ...base, status, preparationLeaseUntil: null, standard: 'raw_ed25519', payload: 'unsigned fixture payload' };
    const contentHash = sha256(canonicalBytes({ owner, requestId, kind: 'action', data, sequence, recordId }));
    const graph = { schemaVersion: 1, domain: 'cfo', recordKind: 'cfo/action/1', wallet, sequence, contentHash, executionReady: false };
    const analysis = { schemaVersion: 1, recordKind: 'cfo/action/1', kind: 'action', requestId, wallet, sequence, contentHash, data };
    await pool.query(`INSERT INTO falcon_mesh.analyses
      (owner_id,id,request_id,created_at,observation_id,max_hops,graph,analysis)
      VALUES ($1,$2,$3,'2026-10-26T12:00:00.000Z','cfo:action',1,$4::jsonb,$5::jsonb)`,
    [owner, recordId, requestId, JSON.stringify(graph), JSON.stringify(analysis)]);
  }
  const latest = await store.latestAction(owner, actionId);
  assert.equal(latest.id, newId);
  assert.equal(latest.data.status, 'FAILED');
  const newActionId = randomUUID(), requestId = randomUUID();
  const next = await store.append(owner, {
    requestId, kind: 'action',
    data: actionData(wallet, newActionId, randomUUID(), savedMandate.id, savedPortfolio.id, requestId, deadline),
    exclusiveAction: { mode: 'CREATE', actionId: newActionId, assetId: reserveAssetId,
      baseUnits: '10', portfolioId: savedPortfolio.id, mandateId: savedMandate.id },
  });
  assert.equal(BigInt(next.record.sequence), 5n);
  assert.equal((await store.latestAction(owner, newActionId)).data.status, 'PREPARING');
});
