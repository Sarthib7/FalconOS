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
  if (options?.enroll !== false) await f.setup();
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
  await assert.rejects(f.service.revoke(f.owner, f.wallet, request()), code('CONFLICT'));
  const paused = await f.service.overview(f.owner, f.wallet);
  assert.equal(paused.runner.state, 'PAUSED');
  assert.equal(paused.delegation.status, 'ACTIVE', 'a failed provider check cannot report revoked');
  f.removeSigners();
  const removed = await f.service.revoke(f.owner, f.wallet, request());
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
  f.setCash('1500000000');
  await f.service.capture(f.owner, f.wallet, request());
  await assert.rejects(f.service.prepareFeeClaim(f.owner, f.wallet, request()), code('CONFLICT'));
  const current = await f.service.overview(f.owner, f.wallet);
  assert.equal(current.portfolio.cashBaseUnits, '1500000000');
  assert.equal(current.accounting.depositsBaseUnits, '500000000');
  assert.equal(current.accounting.netGainBaseUnits, '0');
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

test('V226 [fixture]: obsolete owner credentials cannot mutate owner controls or enter the journal', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  await f.service.start(f.owner, f.wallet, request());
  const before = await f.pool.query('SELECT count(*)::int AS count FROM falcon_mesh.analyses WHERE owner_id=$1', [f.owner]);
  for (const method of ['linkWallet', 'prepareDelegation', 'verifyDelegation', 'prepareRevocation', 'revoke']) {
    await assert.rejects(
      f.service[method](f.owner, f.wallet, request({ accessToken: 'owner-token-private-marker' })),
      code('INVALID_INPUT'),
    );
  }
  const after = await f.pool.query('SELECT count(*)::int AS count FROM falcon_mesh.analyses WHERE owner_id=$1', [f.owner]);
  const overview = await f.service.overview(f.owner, f.wallet);
  assert.equal(after.rows[0].count, before.rows[0].count);
  assert.equal(overview.runner.state, 'RUNNING');
  assert.equal(JSON.stringify(overview).includes('owner-token-private-marker'), false);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('V224/V226 [fixture]: delegation observation retains external revocation without admitting worker dispatch', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  assert.equal((await f.service.overview(f.owner, f.wallet)).delegation.status, 'ACTIVE');
  f.removeSigners();
  const observed = await f.service.verifyDelegation(f.owner, f.wallet, request());
  assert.equal(observed.delegation.status, 'REVOKED');
  assert.equal((await f.service.overview(f.owner, f.wallet)).delegation.status, 'REVOKED');
  await assert.rejects(f.service.start(f.owner, f.wallet, request()), code('UNAUTHORIZED'));
  assert.deepEqual(f.calls.roles, []);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('V224 [fixture]: unavailable delegation observation replaces a retained ACTIVE claim without enabling a worker', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  f.provider.verifyDelegation = async () => ({ status: 'UNAVAILABLE', policyHash: null, reason: 'PROVIDER_UNAVAILABLE' });
  const observed = await f.service.verifyDelegation(f.owner, f.wallet, request());
  assert.equal(observed.delegation.status, 'UNAVAILABLE');
  assert.equal(observed.delegation.reason, 'PROVIDER_UNAVAILABLE');
  assert.equal((await f.service.overview(f.owner, f.wallet)).delegation.status, 'UNAVAILABLE');
  await assert.rejects(f.service.start(f.owner, f.wallet, request()), code('UNAUTHORIZED'));
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('V224 [fixture]: expired retained scope can be observed without claiming signer removal', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  await f.journal.withOwner(f.owner, f.wallet, async tx => {
    const oldMandate = await tx.latest('mandate');
    const oldDelegation = await tx.latest('delegation');
    const expiresAt = new Date(Date.parse(tx.now) - 1000).toISOString();
    const mandate = (await tx.append({ kind: 'mandate', expectedHeadId: oldMandate.id,
      data: { ...oldMandate.data, mandate: { ...oldMandate.data.mandate, expiresAt } } })).record;
    await tx.append({ kind: 'delegation', expectedHeadId: oldDelegation.id, data: {
      ...oldDelegation.data, mandateId: mandate.id,
      delegation: { ...oldDelegation.data.delegation, expiresAt },
    } });
  });
  const observed = await f.service.verifyDelegation(f.owner, f.wallet, request());
  assert.equal(observed.delegation.status, 'EXPIRED');
  assert.equal((await f.service.overview(f.owner, f.wallet)).delegation.status, 'EXPIRED');
  await assert.rejects(f.service.start(f.owner, f.wallet, request()), code('CONFLICT'));
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('V227/V228/V229 [fixture]: quote precedes SOL funding and owner setup finality precedes readiness without a mandate', { skip: !databaseUrl }, async t => {
  const f = await harness(t, { enroll: false, accountsMissing: true, nativeBalanceLamports: '0' });
  f.config.executionEnabled = false;
  f.config.reviewGrants = [];
  f.config.feeBps = null;
  f.config.feeRecipient = null;
  await f.service.linkWallet(f.owner, f.wallet, request());
  assert.equal((await f.service.overview(f.owner, f.wallet)).setupStatus, 'NOT_OBSERVED');
  assert.equal(f.calls.quote, 0);
  const unfunded = (await f.service.quoteAccounts(f.owner, f.wallet, request())).setupQuote;
  assert.equal(unfunded.nativeBalanceLamports, '0');
  assert.equal(unfunded.rentLamports, '600');
  await assert.rejects(f.service.prepareAccounts(f.owner, f.wallet, request({ quoteId: unfunded.quoteId })), code('CONFLICT'));
  f.setNative('1000');
  const funded = (await f.service.quoteAccounts(f.owner, f.wallet, request())).setupQuote;
  const ownerAction = (await f.service.prepareAccounts(f.owner, f.wallet, request({ quoteId: funded.quoteId }))).ownerAction;
  assert.equal(ownerAction.prepared.action, 'setup');
  assert.equal(ownerAction.prepared.amountBaseUnits, '0');
  const submitted = await f.service.submitOwnerSignature(f.owner, f.wallet, request({
    actionId: ownerAction.actionId, signedTransactionBase64: f.signedTransactionBase64,
  }));
  assert.equal(submitted.action.status, 'SUBMISSION_UNKNOWN');
  assert.equal(f.calls.durableAtSend.status, 'SUBMISSION_UNKNOWN');
  await f.service.capture(f.owner, f.wallet, request());
  const pending = await f.service.overview(f.owner, f.wallet);
  assert.notEqual(pending.setupStatus, 'READY');
  assert.equal(pending.setupIssues.includes('SETUP_ACTION_UNRESOLVED'), true);
  f.confirm();
  const settled = await f.service.reconcile(f.owner, f.wallet, request({ actionId: ownerAction.actionId }));
  assert.equal(settled.action.status, 'CONFIRMED');
  const ready = await f.service.overview(f.owner, f.wallet);
  assert.equal(ready.setupStatus, 'READY');
  assert.equal(ready.portfolio.cashBaseUnits, '0');
  assert.equal(ready.mandate, null);
  assert.equal(ready.accounting.status, 'UNAVAILABLE');
  assert.deepEqual(ready.setupCosts, { knownCostUsdcBaseUnits: '105', hasUnpricedCost: false, feeLamports: '100', rentLamports: '600' });
  await f.service.reconcile(f.owner, f.wallet, request({ actionId: ownerAction.actionId }));
  assert.deepEqual((await f.service.overview(f.owner, f.wallet)).setupCosts, ready.setupCosts);
  assert.deepEqual(f.calls.roles, []);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 1);
});

test('V227/V228 [fixture]: setup rejects caller quote contents, superseded quotes and stale ownership before preparing', { skip: !databaseUrl }, async t => {
  const f = await harness(t, { enroll: false, accountsMissing: true, nativeBalanceLamports: '1000' });
  await f.service.linkWallet(f.owner, f.wallet, request());
  const first = (await f.service.quoteAccounts(f.owner, f.wallet, request())).setupQuote;
  const current = (await f.service.quoteAccounts(f.owner, f.wallet, request())).setupQuote;
  await assert.rejects(f.service.prepareAccounts(f.owner, f.wallet, request({
    quoteId: current.quoteId, quote: { ...current, rentLamports: '0' },
  })), code('INVALID_INPUT'));
  await assert.rejects(f.service.prepareAccounts(f.owner, f.wallet, request({ quoteId: first.quoteId })), code('CONFLICT'));
  const original = f.provider.verifyWalletLink;
  f.provider.verifyWalletLink = async (...args) => ({ ...await original(...args), userId: 'different-customer' });
  await assert.rejects(f.service.prepareAccounts(f.owner, f.wallet, request({ quoteId: current.quoteId })), code('UNAUTHORIZED'));
  assert.equal(f.calls.setupPrepare, 0);
  assert.equal(f.calls.submit, 0);
  assert.equal((await f.service.overview(f.owner, f.wallet)).actions.length, 0);
});

test('V229 [fixture]: unpriced native setup cost survives later USDC funding and mandate enrollment', { skip: !databaseUrl }, async t => {
  const f = await harness(t, { enroll: false, accountsMissing: true, nativeBalanceLamports: '1000', unpricedSetup: true });
  await f.service.linkWallet(f.owner, f.wallet, request());
  const quote = (await f.service.quoteAccounts(f.owner, f.wallet, request())).setupQuote;
  assert.equal(quote.maxTotalCostUsdcBaseUnits, null);
  const ownerAction = (await f.service.prepareAccounts(f.owner, f.wallet, request({ quoteId: quote.quoteId }))).ownerAction;
  await f.service.submitOwnerSignature(f.owner, f.wallet, request({ actionId: ownerAction.actionId, signedTransactionBase64: f.signedTransactionBase64 }));
  f.confirm();
  await f.service.reconcile(f.owner, f.wallet, request({ actionId: ownerAction.actionId }));
  f.setCash('1000000');
  await f.setup();
  const overview = await f.service.overview(f.owner, f.wallet);
  assert.equal(overview.setupCosts.hasUnpricedCost, true);
  assert.equal(overview.setupCosts.feeLamports, '100');
  assert.equal(overview.accounting.feeUnavailableReason, 'unpriced_setup_cost');
  assert.equal(overview.accounting.netGainBaseUnits, null);
  assert.equal(overview.accounting.feeOwedBaseUnits, null);
  assert.equal(overview.accounting.depositsBaseUnits, '0');
});

test('V227/V222 [fixture]: missing canonical accounts put the running monitor on HOLD before any paid review', { skip: !databaseUrl }, async t => {
  const f = await harness(t);
  await f.service.start(f.owner, f.wallet, request());
  f.setAccountsReady(false);
  await f.service.tick(f.owner, f.wallet);
  assert.equal((await f.service.overview(f.owner, f.wallet)).setupStatus, 'REQUIRED');
  assert.deepEqual(f.calls.roles, []);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('V220/V221/V222 [fixture]: a rotation finalizes its receipt exit before a separately reviewed bounded entry', { skip: !databaseUrl }, async t => {
  const f = await harness(t, { enroll: false });
  f.setCash('100000000');
  f.setReceipt(0, '200000000');
  await f.setup();
  await f.service.start(f.owner, f.wallet, request());
  await f.service.tick(f.owner, f.wallet);
  const exit = (await f.service.overview(f.owner, f.wallet)).actions[0];
  assert.equal(exit.action, 'redeem');
  assert.equal(exit.reserveAddress, f.reserves[0].reserveAddress);
  assert.equal(exit.amountBaseUnits, '150000000');
  assert.equal(exit.status, 'SUBMISSION_UNKNOWN');
  await f.journal.withOwner(f.owner, f.wallet, async tx => {
    const runner = await tx.latest('runner');
    await tx.append({ kind: 'runner', data: { ...runner.data, nextRunAt: tx.now, lease: null } });
  });
  await f.service.tick(f.owner, f.wallet);
  assert.deepEqual(f.calls.roles, ['lead', 'risk']);
  assert.equal(f.calls.submit, 1, 'An unfinalized exit must not authorize a dependent entry.');
  f.confirm();
  await f.service.reconcile(f.owner, f.wallet, request({ actionId: exit.actionId }));
  f.pending();
  // Controlled elapsed-cooldown observation. The production database-time guard is unchanged.
  await f.journal.withOwner(f.owner, f.wallet, async tx => {
    const runner = await tx.latest('runner');
    await tx.append({ kind: 'runner', data: { ...runner.data, nextRunAt: tx.now, lease: null,
      lastActionAt: new Date(Date.parse(tx.now) - 61000).toISOString() } });
  });
  await f.service.tick(f.owner, f.wallet);
  const entry = (await f.service.overview(f.owner, f.wallet)).actions[0];
  assert.notEqual(entry.actionId, exit.actionId);
  assert.equal(entry.action, 'supply');
  assert.equal(entry.reserveAddress, f.reserves[1].reserveAddress);
  assert.equal(entry.amountBaseUnits, '150000000');
  assert.deepEqual(f.calls.roles, ['lead', 'risk', 'lead', 'risk']);
  f.confirm();
  await f.service.reconcile(f.owner, f.wallet, request({ actionId: entry.actionId }));
  const final = await f.service.overview(f.owner, f.wallet);
  assert.equal(final.portfolio.cashBaseUnits, '100000000');
  assert.deepEqual(final.portfolio.positions.map(position => position.receiptBaseUnits), ['50000000', '150000000']);
  assert.equal(final.accounting.transactionCostsBaseUnits, '30');
  assert.equal(final.accounting.earnedFeeBaseUnits, '0');
  assert.equal((await f.journal.withOwner(f.owner, f.wallet, tx => tx.latest('runner'))).data.rotation, null);
});
