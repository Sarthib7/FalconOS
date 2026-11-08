import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { lifecycleFixture } from './fixtures/bot-lifecycle.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const request = extra => ({ requestId: randomUUID(), ...extra });
const code = expected => error => error?.code === expected;
async function harness(t, options) {
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  const f = lifecycleFixture(pool, options);
  const replicas = [f.service];
  t.after(async () => { await Promise.allSettled(replicas.map(service => service.close())); await pool.end(); });
  f.replica = () => { const service = f.makeService(); replicas.push(service); return service; };
  await f.setup();
  return f;
}
async function runAndConfirm(f) {
  await f.service.start(f.owner, f.wallet, request());
  await f.service.tick(f.owner, f.wallet);
  const pending = (await f.service.overview(f.owner, f.wallet)).actions[0];
  assert.equal(pending.status, 'SUBMISSION_UNKNOWN');
  f.confirm();
  await f.service.reconcile(f.owner, f.wallet, request({ actionId: pending.actionId }));
  return pending;
}

// Provider and chain transports are controlled fixtures. The journal, SQL locks,
// review validator and financial service are real; this is not funded readiness.
test('V220/V221 [fixture]: replicas reserve once, persist signed bytes before send, and reconcile one lost reply', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  const second = f.replica();
  await f.service.start(f.owner, f.wallet, request());
  await Promise.all([f.service.tick(f.owner, f.wallet), second.tick(f.owner, f.wallet)]);
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
  assert.deepEqual(f.calls.roles, ['lead', 'risk']);
  assert.equal(f.calls.durableAtSend.status, 'SUBMISSION_UNKNOWN');
  const pending = (await second.overview(f.owner, f.wallet)).actions[0];
  await second.reconcile(f.owner, f.wallet, request({ actionId: pending.actionId }));
  assert.equal((await second.overview(f.owner, f.wallet)).actions[0].status, 'SUBMISSION_UNKNOWN');
  assert.equal(f.calls.submit, 1, 'uncertain receipt lookup must not rebroadcast');
  f.confirm();
  await second.reconcile(f.owner, f.wallet, request({ actionId: pending.actionId }));
  const settled = await second.overview(f.owner, f.wallet);
  assert.equal(settled.actions[0].status, 'CONFIRMED');
  assert.equal(settled.portfolio.cashBaseUnits, '800000000');
  assert.equal(settled.portfolio.positions.reduce((sum, p) => sum + BigInt(p.receiptBaseUnits), 0n), 200000000n);
  const accounting = structuredClone(settled.accounting);
  await second.reconcile(f.owner, f.wallet, request({ actionId: pending.actionId }));
  assert.deepEqual((await second.overview(f.owner, f.wallet)).accounting, accounting, 'terminal receipt replay cannot apply flows or fees twice');
  assert.equal(JSON.stringify(settled).includes('signedTransactionBase64'), false);
  assert.equal(JSON.stringify(settled).includes('fixture-customer-jwt'), false);
  assert.equal(JSON.stringify(settled).includes('fixture-owner-quorum'), false);
});

test('V224 [fixture]: pause cancels an unsigned reserved run before a blocked reviewer can return', { skip: !databaseUrl }, async t => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const f = await harness(t, { blockLead: async () => { entered.resolve(); await release.promise; } });
  await f.service.start(f.owner, f.wallet, request());
  const ticking = f.service.tick(f.owner, f.wallet);
  let deadline;
  try {
    await Promise.race([entered.promise, ticking.then(() => { throw new Error('Run ended before the blocked Lead call.'); }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Lead did not start.')), 10000); })]);
    clearTimeout(deadline);
    await f.service.pause(f.owner, f.wallet, request());
    const paused = await f.service.overview(f.owner, f.wallet);
    assert.equal(paused.runner.state, 'PAUSED');
    assert.equal(paused.actions[0].status, 'FAILED', 'stop commits unsigned cancellation before model completion');
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.submit, 0);
  } finally { clearTimeout(deadline); release.resolve(); await ticking.catch(() => undefined); }
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('V224 [fixture]: failed revocation stays paused; revoked signer and expired mandate do not deny owner recovery', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  await runAndConfirm(f);
  await assert.rejects(f.service.revoke(f.owner, f.wallet, request({ accessToken: 'fixture-customer-jwt' })), code('CONFLICT'));
  const paused = await f.service.overview(f.owner, f.wallet);
  assert.equal(paused.runner.state, 'PAUSED');
  assert.equal(paused.delegation.status, 'ACTIVE', 'a failed provider check cannot report revoked');
  f.removeSigners();
  const removed = await f.service.revoke(f.owner, f.wallet, request({ accessToken: 'fixture-customer-jwt' }));
  assert.equal(removed.runner.state, 'REVOKED');
  assert.equal(removed.delegation.status, 'REVOKED');
  await f.journal.withOwner(f.owner, f.wallet, async tx => {
    const old = await tx.latest('mandate');
    await tx.append({ kind: 'mandate', data: { wallet: f.wallet, mandate: { ...old.data.mandate,
      expiresAt: new Date(Date.parse(tx.now) - 1000).toISOString() } } });
  });
  const before = f.calls.sign;
  const prepared = await f.service.prepareWithdrawal(f.owner, f.wallet, request({ reserveAddress: f.reserves[1].reserveAddress,
    receiptBaseUnits: '100000000' }));
  assert.equal(prepared.ownerAction.prepared.action, 'redeem');
  assert.equal(prepared.ownerAction.prepared.amountUnit, 'receipt-base-units');
  assert.equal(prepared.ownerAction.prepared.amountBaseUnits, '100000000');
  assert.equal(f.calls.sign, before, 'recovery prepares for the owner and never asks the revoked worker to sign');
});

test('V223 [fixture]: a funded cash deposit cannot produce a payable performance fee', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  await assert.rejects(f.service.prepareFeeClaim(f.owner, f.wallet, request()), code('CONFLICT'));
  const current = await f.service.overview(f.owner, f.wallet);
  assert.equal(current.portfolio.cashBaseUnits, '1000000000');
  assert.equal(current.accounting.earnedFeeBaseUnits, '0');
  assert.equal(f.calls.prepare, 0);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('V220/V221 [fixture]: an already retained chain signature cannot identify a new financial action', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  await runAndConfirm(f);
  const first = f.calls.durableAtSend;
  await f.journal.withOwner(f.owner, f.wallet, async tx => {
    const runner = await tx.latest('runner');
    await tx.append({ kind: 'runner', data: { ...runner.data, state: 'RUNNING', lease: null, nextRunAt: tx.now,
      lastActionAt: new Date(Date.parse(tx.now) - 31536001000).toISOString() } });
  });
  await assert.rejects(f.service.tick(f.owner, f.wallet), code('CONFLICT'));
  const latest = await f.journal.withOwner(f.owner, f.wallet, tx => tx.latest('action'));
  assert.equal(latest.data.prepared.transactionBase64, first.prepared.transactionBase64,
    'the fixture models the same cached blockhash and exact message, not an invalid signature for a changed message');
  assert.equal(f.calls.submit, 1, 'same signed chain event cannot be sent or accounted as a second action');
});

test('V224 [fixture]: a start waiting for provider verification cannot undo a later committed pause', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const verify = f.provider.verifyDelegation;
  f.provider.verifyDelegation = async input => { entered.resolve(); await release.promise; return verify(input); };
  const starting = f.service.start(f.owner, f.wallet, request());
  try {
    await entered.promise;
    await f.service.pause(f.owner, f.wallet, request());
    assert.equal((await f.service.overview(f.owner, f.wallet)).runner.state, 'PAUSED');
    release.resolve();
    await assert.rejects(starting, code('CONFLICT'));
    assert.equal((await f.service.overview(f.owner, f.wallet)).runner.state, 'PAUSED');
    await f.service.tick(f.owner, f.wallet);
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.submit, 0);
  } finally { release.resolve(); await starting.catch(() => undefined); }
});

test('V222 [fixture]: operator and customer review budgets each stop further model dispatch', { skip: !databaseUrl }, async t => {
  for (const limits of [{ grantMaxCalls: 2, mandateMaxCalls: 8 }, { grantMaxCalls: 8, mandateMaxCalls: 2 }]) {
    const f = await harness(t, limits);
    await runAndConfirm(f);
    await f.journal.withOwner(f.owner, f.wallet, async tx => {
      const runner = await tx.latest('runner');
      await tx.append({ kind: 'runner', data: { ...runner.data, state: 'RUNNING', lease: null, nextRunAt: tx.now,
        lastActionAt: new Date(Date.parse(tx.now) - 31536001000).toISOString() } });
    });
    await assert.rejects(f.service.tick(f.owner, f.wallet), code('UNAUTHORIZED'));
    assert.deepEqual(f.calls.roles, ['lead', 'risk'], 'exhaustion must be checked before any new model request');
    assert.equal(f.calls.sign, 1);
    assert.equal(f.calls.submit, 1);
  }
});

test('V220 [fixture]: an unresolved legacy NEAR reservation blocks bot model and signer dispatch', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  const legacyActionId = randomUUID();
  // This seeds the fields consumed by the cross-domain reservation query.
  // It does not establish a valid NEAR signature or provider submission.
  await f.pool.query(`INSERT INTO falcon_mesh.analyses
    (owner_id,id,request_id,created_at,observation_id,max_hops,graph,analysis)
    VALUES($1,$2,$3,clock_timestamp(),'fixture:legacy-reservation',1,$4::jsonb,$5::jsonb)`,
  [f.owner, randomUUID(), randomUUID(), JSON.stringify({ domain: 'cfo' }),
    JSON.stringify({ recordKind: 'cfo/action/1', kind: 'action', sequence: '1',
      data: { wallet: f.wallet, actionId: legacyActionId, status: 'SUBMISSION_UNKNOWN' } })]);
  await f.service.start(f.owner, f.wallet, request());
  await f.service.tick(f.owner, f.wallet);
  const current = await f.service.overview(f.owner, f.wallet);
  assert.match(current.runner.reason, /Another financial domain reserves/);
  assert.deepEqual(f.calls.roles, []);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});
