import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import { deriveWalletOwnerId } from '../wallet-auth.mjs';
import { createStore } from '../store.mjs';
import { createLendingJournal } from '../cfo/lifecycle.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
async function context(t) {
  const pool = new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  t.after(() => pool.end());
  const wallet = Keypair.generate().publicKey.toBase58();
  return { pool, wallet, owner: deriveWalletOwnerId(wallet), journal: createLendingJournal(pool) };
}

test('V217/V218/V220: journal binds owner, request content and private financial history', { skip: !databaseUrl }, async t => {
  const { pool, wallet, owner, journal } = await context(t);
  const id = randomUUID();
  const input = { kind: 'portfolio', requestId: id, data: { wallet, cashBaseUnits: '1000000' } };
  const first = await journal.withOwner(owner, wallet, tx => tx.append(input));
  const replay = await journal.withOwner(owner, wallet, tx => tx.append(input));
  assert.equal(replay.inserted, false);
  assert.equal(replay.record.id, first.record.id);
  await assert.rejects(journal.withOwner(owner, wallet, tx => tx.append({ ...input,
    data: { wallet, cashBaseUnits: '2000000' } })), error => error.code === 'CONFLICT');
  await assert.rejects(journal.withOwner(owner, wallet, tx => tx.append({ kind: 'wallet',
    data: { wallet, accessToken: 'fixture-private-token' } })), error => error.code === 'INVALID_INPUT');
  await assert.rejects(journal.withOwner(owner, Keypair.generate().publicKey.toBase58(), () => null), error => error.code === 'UNAUTHORIZED');
  assert.equal(await createStore(pool).getAnalysis(owner, first.record.id), null,
    'generic operator analysis reads must not expose the lending financial domain');
});

test('V220: separate journal replicas admit one unresolved financial reservation', { skip: !databaseUrl }, async t => {
  const { pool, wallet, owner, journal } = await context(t);
  const replica = createLendingJournal(pool);
  const attempt = instance => instance.withOwner(owner, wallet, tx => tx.append({ kind: 'action', exclusiveAction: true,
    data: { wallet, actionId: randomUUID(), status: 'SUBMISSION_UNKNOWN', signature: 'fixture-chain-' + randomUUID() } }));
  const outcomes = await Promise.allSettled([attempt(journal), attempt(replica)]);
  const accepted = outcomes.filter(result => result.status === 'fulfilled');
  const rejected = outcomes.filter(result => result.status === 'rejected');
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'CONFLICT');
  const current = accepted[0].value.record;
  const open = await replica.withOwner(owner, wallet, tx => tx.openActions());
  assert.deepEqual(open, [current.data.actionId]);
  await replica.withOwner(owner, wallet, tx => tx.append({ kind: 'action', expectedHeadId: current.id,
    data: { ...current.data, status: 'CONFIRMED' } }));
  const next = await attempt(journal);
  assert.equal(next.inserted, true, 'only a terminal retained action releases the owner reservation');
});

test('V220: an unresolved legacy-domain record also reserves the shared owner', { skip: !databaseUrl }, async t => {
  const { pool, wallet, owner, journal } = await context(t);
  const actionId = randomUUID();
  // Storage-boundary fixture only; this does not prove a NEAR signature or receipt.
  await pool.query(`INSERT INTO falcon_mesh.analyses
    (owner_id,id,request_id,created_at,observation_id,max_hops,graph,analysis)
    VALUES($1,$2,$3,clock_timestamp(),'fixture:legacy-reservation',1,$4::jsonb,$5::jsonb)`,
  [owner, randomUUID(), randomUUID(), JSON.stringify({ domain: 'cfo' }),
    JSON.stringify({ recordKind: 'cfo/action/1', kind: 'action', sequence: '1',
      data: { wallet, actionId, status: 'SUBMISSION_UNKNOWN' } })]);
  await assert.rejects(journal.withOwner(owner, wallet, tx => tx.append({ kind: 'action', exclusiveAction: true,
    data: { wallet, actionId: randomUUID(), status: 'PREPARED' } })), error => error.code === 'CONFLICT');
  assert.deepEqual(await journal.withOwner(owner, wallet, tx => tx.openActions()), [actionId]);
});
