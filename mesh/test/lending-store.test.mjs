import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createStore } from '../store.mjs';
import { MeshError } from '../domain.mjs';
import { captureSource } from '../live.mjs';
import { createLendingStore } from '../lending-store.mjs';
import { ADAPTER_VERSION } from '../kamino-wire.mjs';

const connectionString = process.env.FALCON_MESH_TEST_DATABASE_URL;
if (!connectionString) throw new Error('FALCON_MESH_TEST_DATABASE_URL must name a disposable Postgres database with the full mesh migration history.');
const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const AT = '2026-09-27T12:00:00.000Z';
const WALLET = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const SIGNED = Buffer.from('fixture signed exact message').toString('base64');
const SIGNATURE = '2'.repeat(88);
const code = expected => error => error?.code === expected;
const later = seconds => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const makeOwner = () => `lend_${randomUUID().replaceAll('-', '')}`;

async function publicFetch(_url, init) {
  if (init.method === 'GET') return new Response(`## Deployments\n* Devnet: \`${WALLET}\`\n`);
  const input = JSON.parse(init.body);
  return Response.json({ jsonrpc: '2.0', id: input.id, result: input.method === 'getGenesisHash' ? GENESIS : {
    context: { slot: 123 }, value: { owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: true, data: [Buffer.alloc(36, 1).toString('base64'), 'base64'], space: 36 },
  } });
}
function intent(request) {
  return { schemaVersion: 1, network: 'devnet', genesisHash: GENESIS, walletControl: 'unverified',
    policyVersion: 'mesh-public-evidence/1', adapterVersion: ADAPTER_VERSION, ...request,
    transactionBase64: Buffer.from('fixture unsigned message').toString('base64'), messageSha256: 'a'.repeat(64),
    snapshot: { capturedAt: AT, graph: { nodes: [], edges: [] } }, estimatedAmounts: { liquidityBaseUnits: '1', receiptBaseUnits: '1' } };
}
async function fixture(overrides = {}) {
  let clock = AT;
  const owner = makeOwner();
  const counts = { prepare: 0, verify: 0, receipt: 0 };
  const meshStore = createStore(pool, { now: () => clock, capture: (id, options) => captureSource(id, { ...options, fetchImpl: publicFetch }) });
  const sources = [];
  for (const connectorId of ['kamino-program-docs', 'solana-devnet-klend']) {
    sources.push(await meshStore.captureSource(owner, { requestId: randomUUID(), connectorId, expectedRevisionId: null }));
  }
  const analysis = await meshStore.createAnalysis(owner, { requestId: randomUUID(), observationId: 'observation:live:solana-devnet-klend', maxHops: 3 }, clock, 'live');
  assert.equal(analysis.analysis.status, 'OBSERVED');
  const dependencies = {
    meshStore, now: () => clock,
    prepareLending: async request => { counts.prepare += 1; return overrides.prepare ? overrides.prepare(request) : intent(request); },
    verifySignedLending: async (prepared, transactionBase64) => {
      counts.verify += 1;
      if (overrides.verify) return overrides.verify(prepared, transactionBase64);
      if (transactionBase64 !== SIGNED) throw new MeshError('INVALID_INPUT', 'Fixture signature verification failed.');
      return SIGNATURE;
    },
    readLendingReceipt: async (prepared, signature) => {
      counts.receipt += 1;
      return overrides.receipt ? overrides.receipt(prepared, signature) : { status: 'PENDING', signature, observedAt: clock, slot: null, amounts: null, exchanges: [], reason: 'Fixture pending.' };
    },
  };
  const store = createLendingStore(pool, dependencies);
  const input = { requestId: randomUUID(), analysisId: analysis.id, wallet: WALLET, action: 'supply', inputBaseUnits: '1' };
  return { owner, counts, meshStore, sources, analysis, store, input, dependencies, setTime: value => { clock = value; } };
}

before(async () => {
  await createStore(pool).ready();
  const version = await pool.query("SELECT obj_description(oid, 'pg_namespace') AS version FROM pg_namespace WHERE nspname = 'falcon_mesh'");
  assert.equal(version.rows[0]?.version, 'falcon_mesh_schema_version=3');
});
after(async () => { await pool.end(); });

test('V101: prepared intent retains the exact request and original analysis across a fresh connection', async () => {
  const f = await fixture();
  const record = await f.store.prepare(f.owner, f.input);
  assert.equal(record.requestId, f.input.requestId);
  assert.equal(record.analysisId, f.analysis.id);
  assert.deepEqual(record.request, { wallet: WALLET, action: 'supply', inputBaseUnits: '1' });
  assert.deepEqual(record.intent, intent(record.request));
  assert.equal(record.createdAt, AT);
  const freshPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try { assert.deepEqual(await createLendingStore(freshPool, f.dependencies).get(f.owner, record.id), { record, events: [] }); }
  finally { await freshPool.end(); }
  assert.equal((await f.store.list(f.owner))[0].status, 'PREPARED');
});

test('V101: preparation retry returns its original result without fresh evidence or another adapter call', async () => {
  const f = await fixture();
  const first = await f.store.prepare(f.owner, f.input);
  f.setTime(later(1000));
  assert.deepEqual(await f.store.prepare(f.owner, f.input), first);
  assert.equal(f.counts.prepare, 1);
  for (const changes of [{ inputBaseUnits: '2' }, { action: 'redeem' }, { analysisId: randomUUID() }]) {
    await assert.rejects(f.store.prepare(f.owner, { ...f.input, ...changes }), code('CONFLICT'));
  }
});

test('V101: stale or changed live evidence blocks preparation before the adapter runs', async () => {
  const f = await fixture();
  f.setTime(later(301));
  await assert.rejects(f.store.prepare(f.owner, f.input), code('CONFLICT'));
  f.setTime(AT);
  await f.meshStore.captureSource(f.owner, { requestId: randomUUID(), connectorId: 'solana-devnet-klend', expectedRevisionId: f.sources[1].revisionId });
  await assert.rejects(f.store.prepare(f.owner, f.input), code('CONFLICT'));
  assert.equal(f.counts.prepare, 0);
  assert.deepEqual(await f.store.list(f.owner), []);
});

test('V101: source head change during preparation rejects persistence under the owner lock', async () => {
  let f;
  f = await fixture({ prepare: async request => {
    await f.meshStore.captureSource(f.owner, { requestId: randomUUID(), connectorId: 'kamino-program-docs', expectedRevisionId: f.sources[0].revisionId });
    return intent(request);
  } });
  await assert.rejects(f.store.prepare(f.owner, f.input), code('CONFLICT'));
  assert.equal(f.counts.prepare, 1);
  assert.deepEqual(await f.store.list(f.owner), []);
});

test('V101: evidence that expires while the adapter runs cannot be committed', async () => {
  let f;
  f = await fixture({ prepare: async request => { f.setTime(later(301)); return intent(request); } });
  await assert.rejects(f.store.prepare(f.owner, f.input), code('CONFLICT'));
  assert.deepEqual(await f.store.list(f.owner), []);
});

test('V101: concurrent identical preparation requests retain one winning intent', { timeout: 20000 }, async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const f = await fixture({ prepare: async request => { if (++calls === 2) release(); await gate; return { ...intent(request), candidate: calls }; } });
  const results = await Promise.all([f.store.prepare(f.owner, f.input), f.store.prepare(f.owner, f.input)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(calls, 2);
  assert.equal((await f.store.list(f.owner)).length, 1);
});

test('V101: invalid requests, nonlive analyses and malformed or oversized prepared evidence leave no intent', async () => {
  const f = await fixture();
  for (const changes of [{ owner: 'other' }, { wallet: 'bad' }, { inputBaseUnits: '01' }, { inputBaseUnits: '0' }, { inputBaseUnits: '18446744073709551616' }, { action: 'borrow' }]) {
    await assert.rejects(f.store.prepare(f.owner, { ...f.input, ...changes }), code('INVALID_INPUT'));
  }
  const nonlive = await f.meshStore.createAnalysis(f.owner, { requestId: randomUUID(), observationId: 'missing', maxHops: 3 }, AT);
  await assert.rejects(f.store.prepare(f.owner, { ...f.input, analysisId: nonlive.id }), code('CONFLICT'));
  const malformed = await fixture({ prepare: async request => ({ ...intent(request), wallet: '11111111111111111111111111111111' }) });
  await assert.rejects(malformed.store.prepare(malformed.owner, malformed.input), code('INVALID_INPUT'));
  const large = await fixture({ prepare: async request => ({ ...intent(request), raw: 'x'.repeat(1024 * 1024 + 1) }) });
  await assert.rejects(large.store.prepare(large.owner, large.input), code('TOO_LARGE'));
  assert.deepEqual(await f.store.list(f.owner), []);
  assert.deepEqual(await malformed.store.list(malformed.owner), []);
  assert.deepEqual(await large.store.list(large.owner), []);
});

test('V92, V101, V102: owner scope protects analyses, intents, submissions and receipt reads', async () => {
  const a = await fixture();
  const b = await fixture();
  await assert.rejects(b.store.prepare(b.owner, { ...b.input, analysisId: a.analysis.id }), code('NOT_FOUND'));
  const first = await a.store.prepare(a.owner, a.input);
  const second = await b.store.prepare(b.owner, { ...b.input, requestId: a.input.requestId });
  assert.notEqual(first.id, second.id);
  assert.equal(await b.store.get(b.owner, first.id), null);
  assert.deepEqual((await b.store.list(b.owner)).map(record => record.id), [second.id]);
  await assert.rejects(b.store.submit(b.owner, first.id, { requestId: randomUUID(), transactionBase64: SIGNED }), code('NOT_FOUND'));
  await assert.rejects(b.store.receipt(b.owner, first.id, { requestId: randomUUID() }), code('NOT_FOUND'));
  assert.equal(b.counts.verify, 0);
  assert.equal(b.counts.receipt, 0);
});

test('V102: signed registration retains exact signed bytes for an explicit retry after reload', async () => {
  const f = await fixture();
  const record = await f.store.prepare(f.owner, f.input);
  const input = { requestId: randomUUID(), transactionBase64: SIGNED };
  const saved = await f.store.submit(f.owner, record.id, input);
  assert.equal(saved.kind, 'SUBMITTED');
  assert.deepEqual(saved.data, { signature: SIGNATURE, transactionSha256: createHash('sha256').update(Buffer.from(SIGNED, 'base64')).digest('hex'), transactionBase64: SIGNED });
  const reopened = createLendingStore(pool, f.dependencies);
  assert.equal((await reopened.get(f.owner, record.id)).events[0].data.transactionBase64, SIGNED);
  f.setTime(later(1000));
  assert.deepEqual(await f.store.submit(f.owner, record.id, input), saved);
  assert.deepEqual(await f.store.submit(f.owner, record.id, { ...input, requestId: randomUUID() }), saved);
  assert.equal(f.counts.verify, 1);
  assert.equal((await f.store.get(f.owner, record.id)).events.length, 1);
  assert.equal((await f.store.list(f.owner))[0].signature, SIGNATURE);
});

test('V101,V102: source updates after preparation block the first signed registration', async () => {
  const f = await fixture();
  const record = await f.store.prepare(f.owner, f.input);
  await f.meshStore.captureSource(f.owner, { requestId: randomUUID(), connectorId: 'solana-devnet-klend', expectedRevisionId: f.sources[1].revisionId });
  await assert.rejects(f.store.submit(f.owner, record.id, { requestId: randomUUID(), transactionBase64: SIGNED }), code('CONFLICT'));
  assert.deepEqual((await f.store.get(f.owner, record.id)).events, []);
});

test('V101,V102: analysis that expires before first registration blocks a fresh intent', async () => {
  const f = await fixture();
  f.setTime(later(299));
  const record = await f.store.prepare(f.owner, f.input);
  f.setTime(later(301));
  await assert.rejects(f.store.submit(f.owner, record.id, { requestId: randomUUID(), transactionBase64: SIGNED }), code('CONFLICT'));
  assert.deepEqual((await f.store.get(f.owner, record.id)).events, []);
});

test('V102: first submission rejects expired or changed transactions and preserves empty event history', async () => {
  const f = await fixture();
  const record = await f.store.prepare(f.owner, f.input);
  await assert.rejects(f.store.submit(f.owner, record.id, { requestId: randomUUID(), transactionBase64: Buffer.from('tampered').toString('base64') }), code('INVALID_INPUT'));
  f.setTime(later(121));
  await assert.rejects(f.store.submit(f.owner, record.id, { requestId: randomUUID(), transactionBase64: SIGNED }), code('CONFLICT'));
  assert.equal(f.counts.verify, 1);
  assert.deepEqual((await f.store.get(f.owner, record.id)).events, []);
});

test('V102: concurrent registration creates exactly one submission and rejects changed registration', async () => {
  const f = await fixture();
  const record = await f.store.prepare(f.owner, f.input);
  const input = { requestId: randomUUID(), transactionBase64: SIGNED };
  const results = await Promise.all([f.store.submit(f.owner, record.id, input), f.store.submit(f.owner, record.id, input)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await f.store.get(f.owner, record.id)).events.length, 1);
  for (const requestId of [input.requestId, randomUUID()]) {
    await assert.rejects(f.store.submit(f.owner, record.id, { requestId, transactionBase64: Buffer.from('different').toString('base64') }), code('CONFLICT'));
  }
});

test('V102: receipt requires registration and its retry returns the original result without another RPC read', async () => {
  const f = await fixture();
  const record = await f.store.prepare(f.owner, f.input);
  const input = { requestId: randomUUID() };
  await assert.rejects(f.store.receipt(f.owner, record.id, input), code('CONFLICT'));
  assert.equal(f.counts.receipt, 0);
  const registration = await f.store.submit(f.owner, record.id, { requestId: randomUUID(), transactionBase64: SIGNED });
  const first = await f.store.receipt(f.owner, record.id, input);
  assert.equal(first.kind, 'RECEIPT');
  assert.equal(first.data.signature, registration.data.signature);
  assert.deepEqual(await f.store.receipt(f.owner, record.id, input), first);
  assert.equal(f.counts.receipt, 1);
  await assert.rejects(f.store.receipt(f.owner, record.id, { requestId: registration.requestId }), code('CONFLICT'));
  await assert.rejects(f.store.submit(f.owner, record.id, { requestId: first.requestId, transactionBase64: SIGNED }), code('CONFLICT'));
});

test('V102: receipt events remain immutable and CONFIRMED takes precedence over later pending reads', async () => {
  let status = 'CONFIRMED';
  const f = await fixture({ receipt: async (_prepared, signature) => ({ status, signature, observedAt: AT, slot: status === 'CONFIRMED' ? 123 : null, amounts: null }) });
  const record = await f.store.prepare(f.owner, f.input);
  await f.store.submit(f.owner, record.id, { requestId: randomUUID(), transactionBase64: SIGNED });
  f.setTime(later(1));
  const confirmed = await f.store.receipt(f.owner, record.id, { requestId: randomUUID() });
  status = 'PENDING'; f.setTime(later(2));
  const pending = await f.store.receipt(f.owner, record.id, { requestId: randomUUID() });
  assert.equal(pending.data.status, 'PENDING');
  assert.equal((await f.store.list(f.owner))[0].status, 'CONFIRMED');
  const saved = await f.store.get(f.owner, record.id);
  assert.deepEqual(saved.events.map(event => event.kind), ['SUBMITTED', 'RECEIPT', 'RECEIPT']);
  assert.deepEqual(saved.events[1], confirmed);
  assert.deepEqual(saved.events[2], pending);
});

test('V102: concurrent receipt retries append one event and request IDs cannot cross intents', async () => {
  const otherSigned = Buffer.from('another signed fixture message').toString('base64');
  const f = await fixture({ verify: async (_intent, value) => value === SIGNED ? SIGNATURE : '3'.repeat(88) });
  const first = await f.store.prepare(f.owner, f.input);
  const second = await f.store.prepare(f.owner, { ...f.input, requestId: randomUUID() });
  await f.store.submit(f.owner, first.id, { requestId: randomUUID(), transactionBase64: SIGNED });
  await f.store.submit(f.owner, second.id, { requestId: randomUUID(), transactionBase64: otherSigned });
  const input = { requestId: randomUUID() };
  const results = await Promise.all([f.store.receipt(f.owner, first.id, input), f.store.receipt(f.owner, first.id, input)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await f.store.get(f.owner, first.id)).events.length, 2);
  await assert.rejects(f.store.receipt(f.owner, second.id, input), code('CONFLICT'));
});

test('V102: one signed transaction cannot become two lending actions for the same owner', async () => {
  const f = await fixture();
  const first = await f.store.prepare(f.owner, f.input);
  const second = await f.store.prepare(f.owner, { ...f.input, requestId: randomUUID() });
  await f.store.submit(f.owner, first.id, { requestId: randomUUID(), transactionBase64: SIGNED });
  await assert.rejects(f.store.submit(f.owner, second.id, { requestId: randomUUID(), transactionBase64: SIGNED }), code('CONFLICT'));
  assert.equal((await f.store.get(f.owner, first.id)).events.length, 1);
  assert.equal((await f.store.get(f.owner, second.id)).events.length, 0);
});

test('V102: foreign signature, invalid status and oversize receipt results are not persisted', async () => {
  for (const output of [
    { status: 'CONFIRMED', signature: '3'.repeat(88) },
    { status: 'READY', signature: SIGNATURE },
    { status: 'UNVERIFIED', signature: SIGNATURE, raw: 'x'.repeat(1024 * 1024 + 1) },
  ]) {
    const f = await fixture({ receipt: async () => output });
    const record = await f.store.prepare(f.owner, f.input);
    await f.store.submit(f.owner, record.id, { requestId: randomUUID(), transactionBase64: SIGNED });
    await assert.rejects(f.store.receipt(f.owner, record.id, { requestId: randomUUID() }), code(output.raw ? 'TOO_LARGE' : 'INVALID_INPUT'));
    assert.equal((await f.store.get(f.owner, record.id)).events.length, 1);
  }
});

test('V92, V102: history shows newest20 summaries without discarding older intents', async () => {
  const f = await fixture();
  const saved = [];
  for (let index = 0; index < 22; index += 1) {
    f.setTime(later(index));
    saved.push(await f.store.prepare(f.owner, { ...f.input, requestId: randomUUID() }));
  }
  const listed = await f.store.list(f.owner);
  assert.deepEqual(listed.map(record => record.id), saved.slice(-20).reverse().map(record => record.id));
  assert.equal(Object.hasOwn(listed[0], 'intent'), false);
  assert.equal((await f.store.get(f.owner, saved[0].id)).record.id, saved[0].id);
});

test('V95, V102: storage and unknown adapter errors do not expose SQL or connection details', async () => {
  const failed = createLendingStore({ query: async () => { throw new Error('password=private SELECT secret_table'); } }, {});
  await assert.rejects(failed.get(makeOwner(), randomUUID()), error => error.code === 'STORAGE_UNAVAILABLE' && !/private|SELECT|secret_table/.test(error.message));
  const f = await fixture({ prepare: async () => { throw new Error('RPC transport password=private'); } });
  await assert.rejects(f.store.prepare(f.owner, f.input), error => error.code === 'STORAGE_UNAVAILABLE' && !error.message.includes('private'));
  assert.deepEqual(await f.store.list(f.owner), []);
});
