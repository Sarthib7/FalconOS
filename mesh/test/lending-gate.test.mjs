import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../store.mjs';
import { captureSource } from '../live.mjs';
import { createLendingStore } from '../lending-store.mjs';
import { createApi } from '../http.mjs';
import { ADAPTER_VERSION } from '../kamino-wire.mjs';
import { createKaminoBrowserFixture } from './support/kamino-fixtures.mjs';

const connectionString = process.env.FALCON_MESH_TEST_DATABASE_URL;
if (!connectionString) throw new Error('FALCON_MESH_TEST_DATABASE_URL must name a disposable Postgres database with the full mesh migration history.');
const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const AT = '2026-09-27T12:00:00.000Z';
const WALLET = Keypair.generate().publicKey.toBase58();
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NOT_REVIEW = 'A fresh REVIEW reserve decision for this amount is required.';
// The fixed reserve fixture book is 252145908 base units; every proposal here is far inside it.
const SCENARIO = { proposedUnits: '5000000', maxProposedUnits: '10000000', minBookLiquidityUnits: '1000000', maxObservationAgeSeconds: 300 };
const code = expected => error => error?.code === expected;
const later = seconds => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const makeOwner = () => `gate_${randomUUID().replaceAll('-', '')}`;
const sha = value => createHash('sha256').update(value).digest('hex');

function intent(request) {
  return { schemaVersion: 1, network: 'devnet', genesisHash: GENESIS, walletControl: 'unverified',
    policyVersion: 'mesh-public-evidence/1', adapterVersion: ADAPTER_VERSION, ...request,
    transactionBase64: Buffer.from('fixture unsigned message').toString('base64'), messageSha256: sha('fixture'),
    snapshot: { capturedAt: AT, graph: { nodes: [], edges: [] } }, estimatedAmounts: { liquidityBaseUnits: '1', receiptBaseUnits: '1' } };
}

async function fixture() {
  let clock = AT;
  const owner = makeOwner();
  const kamino = createKaminoBrowserFixture(WALLET, () => clock);
  const prepared = [];
  const meshStore = createStore(pool, { now: () => clock, capture: (id, options) => captureSource(id, { ...options, fetchImpl: kamino.publicFetch }) });
  for (const connectorId of ['kamino-program-docs', 'solana-devnet-klend', 'solana-devnet-reserve-liquidity']) {
    await meshStore.captureSource(owner, { requestId: randomUUID(), connectorId, expectedRevisionId: null });
  }
  const analysis = await meshStore.createAnalysis(owner, { requestId: randomUUID(), observationId: 'observation:live:solana-devnet-klend', maxHops: 3 }, clock, 'live');
  assert.equal(analysis.analysis.status, 'OBSERVED');
  const decide = async (scenario = SCENARIO, at = clock) => meshStore.createDecision(owner, { requestId: randomUUID(), scenario }, at);
  const store = createLendingStore(pool, {
    meshStore, now: () => clock,
    prepareLending: async request => { prepared.push(request); return intent(request); },
    verifySignedLending: async () => { throw new Error('not used'); },
    readLendingReceipt: async () => { throw new Error('not used'); },
  });
  const supply = (decisionId, extra = {}) => ({ requestId: randomUUID(), analysisId: analysis.id, wallet: WALLET, action: 'supply', inputBaseUnits: '1000000', decisionId, ...extra });
  return { owner, meshStore, analysis, store, decide, supply, prepared, setTime: value => { clock = value; } };
}

before(async () => { await createStore(pool).ready(); });
after(async () => { await pool.end(); });

async function assertNoIntent(f) {
  assert.deepEqual(await f.store.list(f.owner), []);
  assert.equal(f.prepared.length, 0, 'a refused supply never reaches the transaction adapter');
}

test('C2: supply without a decisionId is INVALID_INPUT and leaves no intent', async () => {
  const f = await fixture();
  const { decisionId, ...withoutDecision } = f.supply('x');
  await assert.rejects(f.store.prepare(f.owner, withoutDecision), code('INVALID_INPUT'));
  await assert.rejects(f.store.prepare(f.owner, { ...withoutDecision, decisionId: 'not-a-uuid' }), code('INVALID_INPUT'));
  await assert.rejects(f.store.prepare(f.owner, { ...withoutDecision, decisionId: 7 }), code('INVALID_INPUT'));
  await assertNoIntent(f);
});

test('C2: supply from a fresh REVIEW decision is accepted, keeps the decisionId and persists it', async () => {
  const f = await fixture();
  const decision = await f.decide();
  assert.equal(decision.analysis.status, 'REVIEW');
  const input = f.supply(decision.id);
  const record = await f.store.prepare(f.owner, input);
  assert.deepEqual(record.request, { wallet: WALLET, action: 'supply', inputBaseUnits: '1000000', decisionId: decision.id });
  assert.deepEqual(f.prepared, [{ wallet: WALLET, action: 'supply', inputBaseUnits: '1000000' }], 'the adapter still sees only the transaction fields');
  const freshPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const reopened = createLendingStore(freshPool, { meshStore: f.meshStore, now: () => AT });
    assert.equal((await reopened.get(f.owner, record.id)).record.request.decisionId, decision.id);
    assert.equal((await reopened.list(f.owner))[0].request.decisionId, decision.id);
  } finally { await freshPool.end(); }
  const stored = await pool.query('SELECT request FROM falcon_mesh.lending_intents WHERE owner_id = $1 AND id = $2', [f.owner, record.id]);
  assert.equal(stored.rows[0].request.decisionId, decision.id);
});

test('C2: an amount equal to the decision proposal is accepted; one unit above is refused', async () => {
  const f = await fixture();
  const decision = await f.decide();
  const exact = await f.store.prepare(f.owner, f.supply(decision.id, { inputBaseUnits: SCENARIO.proposedUnits }));
  assert.equal(exact.request.inputBaseUnits, SCENARIO.proposedUnits);
  const over = f.supply(decision.id, { inputBaseUnits: String(BigInt(SCENARIO.proposedUnits) + 1n) });
  await assert.rejects(f.store.prepare(f.owner, over), error => error.code === 'CONFLICT' && /exceeds/.test(error.message) && error.message !== NOT_REVIEW);
  assert.equal(f.prepared.length, 1);
  assert.equal((await f.store.list(f.owner)).length, 1);
});

test('C2: a BLOCKED decision cannot authorize supply', async () => {
  const f = await fixture();
  const blocked = await f.decide({ ...SCENARIO, maxProposedUnits: '1' });
  assert.equal(blocked.analysis.status, 'BLOCKED');
  await assert.rejects(f.store.prepare(f.owner, f.supply(blocked.id, { inputBaseUnits: '1' })), error => error.code === 'CONFLICT' && error.message === NOT_REVIEW);
  await assertNoIntent(f);
});

test('C2: a NO_DATA decision cannot authorize supply', async () => {
  const f = await fixture();
  f.setTime(later(100));
  const stale = await f.decide({ ...SCENARIO, maxObservationAgeSeconds: 10 }, later(100));
  assert.equal(stale.analysis.status, 'NO_DATA');
  await assert.rejects(f.store.prepare(f.owner, f.supply(stale.id)), error => error.code === 'CONFLICT' && error.message === NOT_REVIEW);
  await assertNoIntent(f);
});

test('C2: an expired REVIEW decision cannot authorize supply (injected clock)', async () => {
  const f = await fixture();
  const decision = await f.decide({ ...SCENARIO, maxObservationAgeSeconds: 60 });
  assert.equal(decision.analysis.status, 'REVIEW');
  assert.equal(decision.analysis.expiresAt, later(60));
  f.setTime(later(60));
  const atExpiry = await f.store.prepare(f.owner, f.supply(decision.id));
  assert.equal(atExpiry.request.decisionId, decision.id, 'a decision is still usable at the instant it expires');
  f.setTime(later(61));
  await assert.rejects(f.store.prepare(f.owner, f.supply(decision.id)), error => error.code === 'CONFLICT' && /expired/i.test(error.message) && error.message !== NOT_REVIEW);
  assert.equal(f.prepared.length, 1);
  assert.equal((await f.store.list(f.owner)).length, 1);
});

test('C2: another owner decision, an unknown id and a non-decision analysis id fail with the same message', async () => {
  const mine = await fixture();
  const theirs = await fixture();
  const foreign = await theirs.decide();
  assert.equal(foreign.analysis.status, 'REVIEW');
  const messages = [];
  for (const id of [foreign.id, randomUUID(), mine.analysis.id]) {
    await assert.rejects(mine.store.prepare(mine.owner, mine.supply(id)), error => { messages.push(error.message); return error.code === 'CONFLICT'; });
  }
  assert.deepEqual(messages, [NOT_REVIEW, NOT_REVIEW, NOT_REVIEW]);
  await assertNoIntent(mine);
  // The legitimate owner can still use their own decision; nothing was consumed.
  await theirs.store.prepare(theirs.owner, theirs.supply(foreign.id));
});

test('C2: redeem with a decisionId is INVALID_INPUT, redeem without one is never gated', async () => {
  const f = await fixture();
  const decision = await f.decide();
  const { decisionId, ...bare } = f.supply(decision.id);
  await assert.rejects(f.store.prepare(f.owner, { ...bare, action: 'redeem', decisionId: decision.id }), code('INVALID_INPUT'));
  await assertNoIntent(f);
  // No decision of any kind exists for this redeem: exits stay open.
  const record = await f.store.prepare(f.owner, { ...bare, action: 'redeem' });
  assert.deepEqual(record.request, { wallet: WALLET, action: 'redeem', inputBaseUnits: '1000000' });
  assert.equal(Object.hasOwn(record.request, 'decisionId'), false);
  // A redeem also works when the only decision is BLOCKED or expired.
  const blocked = await f.decide({ ...SCENARIO, maxProposedUnits: '1' });
  assert.equal(blocked.analysis.status, 'BLOCKED');
  assert.equal((await f.store.prepare(f.owner, { ...bare, requestId: randomUUID(), action: 'redeem' })).request.action, 'redeem');
});

test('C2: a supply replay is idempotent for identical arguments and a CONFLICT for another decisionId', async () => {
  const f = await fixture();
  const first = await f.decide();
  const second = await f.decide();
  const input = f.supply(first.id);
  const record = await f.store.prepare(f.owner, input);
  f.setTime(later(1000));
  assert.deepEqual(await f.store.prepare(f.owner, input), record, 'a replay returns the original record even after the decision and evidence expired');
  assert.equal(f.prepared.length, 1);
  await assert.rejects(f.store.prepare(f.owner, { ...input, decisionId: second.id }), error => error.code === 'CONFLICT' && /different arguments/.test(error.message));
  assert.equal((await f.store.list(f.owner)).length, 1);
});

test('C2: HTTP requires decisionId for supply, forbids it for redeem and rejects unknown fields', async t => {
  const f = await fixture();
  const decision = await f.decide();
  const token = 'gate-local-alpha-token-000000000000000000';
  const server = createApi({ store: f.meshStore, lending: f.store, tokenHashes: new Map([[sha(token), f.owner]]), now: () => AT });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/lending/intents`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const { decisionId, ...bare } = f.supply(decision.id);
  assert.equal((await post(bare)).status, 400);
  assert.equal((await post({ ...bare, action: 'redeem', decisionId })).status, 400);
  assert.equal((await post({ ...f.supply(decision.id), extra: true })).status, 400);
  assert.equal((await post(f.supply(randomUUID()))).status, 409);
  assert.equal(f.prepared.length, 0);
  const ok = await post(f.supply(decision.id));
  assert.equal(ok.status, 200);
  assert.equal(ok.data.record.request.decisionId, decision.id);
  assert.equal((await post({ ...bare, requestId: randomUUID(), action: 'redeem' })).status, 200);
  const listed = await (await fetch(`http://127.0.0.1:${server.address().port}/v1/lending/intents`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(listed.records.map(row => row.request.decisionId).sort(), [decision.id, undefined].sort());
});
