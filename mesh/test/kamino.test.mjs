import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { LENDING_CONFIG as C, ADAPTER_VERSION, deriveAccounts, buildLendingTransaction, validateLendingTransaction, deserializeLendingTransaction } from '../kamino-wire.mjs';
import { prepareLending, verifySignedLending, verifyLendingVersions, readLendingReceipt } from '../kamino.mjs';

// These deterministic keys are test-only. No RPC call or real wallet is used.
const signer = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const wallet = signer.publicKey.toBase58();
const a = deriveAccounts(wallet);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kamino-public-accounts.json', import.meta.url), 'utf8'));
const now = () => fixture.capturedAt;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blockhash = new PublicKey(Uint8Array.from({ length: 32 }, () => 9)).toBase58();
const lifetime = { blockhash, lastValidBlockHeight: 123456789 };

function token(mint, owner, amount) {
  const bytes = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(bytes, 0);
  new PublicKey(owner).toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(BigInt(amount), 64); bytes[108] = 1;
  return { data: [bytes.toString('base64'), 'base64'], owner: C.tokenProgram, executable: false, lamports: 2039280, space: 165 };
}

function editBytes(account, edit) {
  const bytes = Buffer.from(account.data[0], 'base64'); edit(bytes); account.data[0] = bytes.toString('base64');
}

function capture({ action = 'supply', inputBaseUnits = '1000000', receiptMissing = false, liquidityMissing = false,
  snapshotEdit, simulationEdit, genesis = C.genesisHash, responseEdit } = {}) {
  const accounts = structuredClone(fixture.accounts);
  accounts[a.walletLiquidity] = liquidityMissing ? null : token(C.liquidityMint, wallet, 5000000n);
  accounts[a.walletReceipt] = receiptMissing ? null : token(C.receiptMint, wallet, 2000000n);
  accounts[wallet] = { data: ['', 'base64'], owner: C.systemProgram, executable: false, lamports: 100000000, space: 0 };
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, C.rpcUrl); assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body); calls.push(request);
    let result;
    if (request.method === 'getGenesisHash') result = genesis;
    else if (request.method === 'getMultipleAccounts') {
      result = { context: { slot: fixture.slot }, value: request.params[0].map(id => structuredClone(accounts[id])) };
      snapshotEdit?.(result);
    } else if (request.method === 'getLatestBlockhash') result = { context: { slot: fixture.slot }, value: lifetime };
    else if (request.method === 'simulateTransaction') {
      const tx = deserializeLendingTransaction(Buffer.from(request.params[0], 'base64'));
      assert.equal(tx.message.recentBlockhash, blockhash);
      assert.equal(request.params[1].replaceRecentBlockhash, false);
      assert.equal(request.params[1].sigVerify, false);
      assert.deepEqual(request.params[1].accounts.addresses, [a.walletLiquidity, a.walletReceipt, a.liquidityVault]);
      const n = BigInt(inputBaseUnits); const sign = action === 'supply' ? 1n : -1n;
      result = { context: { slot: fixture.slot }, value: { err: null, unitsConsumed: 92000, accounts: [
        token(C.liquidityMint, wallet, (liquidityMissing ? 0n : 5000000n) - sign * n),
        token(C.receiptMint, wallet, (receiptMissing ? 0n : 2000000n) + sign * n),
        token(C.liquidityMint, a.marketAuthority, 252145908n + sign * n),
      ] } };
      simulationEdit?.(result);
    } else throw new Error(`Unexpected method ${request.method}`);
    const envelope = { jsonrpc: '2.0', id: request.id, result };
    return responseEdit?.(envelope) ?? new Response(JSON.stringify(envelope), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl, input: { wallet, action, inputBaseUnits } };
}

async function prepared(options) {
  const mock = capture(options);
  return { intent: await prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), mock };
}

function signed(intent, keypair = signer) {
  const tx = deserializeLendingTransaction(Buffer.from(intent.transactionBase64, 'base64'));
  tx.sign([keypair]);
  const transactionBase64 = Buffer.from(tx.serialize()).toString('base64');
  return { transactionBase64, signature: verifySignedLending(intent, transactionBase64), tx };
}

function receiptFixture(intent, { liquidity = 1000000n, collateral = 1000000n } = {}) {
  const auth = signed(intent); const keys = auth.tx.message.staticAccountKeys.map(k => k.toBase58());
  const row = (account, mint, owner, amount) => ({ accountIndex: keys.indexOf(account), mint, owner,
    programId: C.tokenProgram, uiTokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: null } });
  const beforeLiquidity = BigInt(intent.snapshot.decoded.walletLiquidityBaseUnits);
  const beforeReceipt = BigInt(intent.snapshot.decoded.walletReceiptBaseUnits);
  const supply = intent.action === 'supply'; const sign = supply ? 1n : -1n;
  const preTokenBalances = [row(a.walletLiquidity, C.liquidityMint, wallet, beforeLiquidity),
    row(a.walletReceipt, C.receiptMint, wallet, beforeReceipt), row(a.liquidityVault, C.liquidityMint, a.marketAuthority, 252145908n)];
  const preBalances = keys.map(() => 2039280);
  if (intent.createDestinationAta) {
    const destination = supply ? a.walletReceipt : a.walletLiquidity;
    preTokenBalances.splice(preTokenBalances.findIndex(r => r.accountIndex === keys.indexOf(destination)), 1);
    preBalances[keys.indexOf(destination)] = 0;
  }
  return { ...auth, value: { slot: fixture.slot + 1, version: 0, transaction: [auth.transactionBase64, 'base64'], meta: {
    err: null, preBalances, preTokenBalances, postTokenBalances: [
      row(a.walletLiquidity, C.liquidityMint, wallet, beforeLiquidity - sign * liquidity),
      row(a.walletReceipt, C.receiptMint, wallet, beforeReceipt + sign * collateral),
      row(a.liquidityVault, C.liquidityMint, a.marketAuthority, 252145908n + sign * liquidity),
    ],
  } } };
}

function receiptRpc(receipt, genesis = C.genesisHash, height = lifetime.lastValidBlockHeight - 1) {
  return async (url, options) => {
    assert.equal(url, C.rpcUrl); const request = JSON.parse(options.body);
    assert.ok(['getGenesisHash', 'getTransaction', 'getBlockHeight'].includes(request.method));
    if (request.method === 'getTransaction') assert.deepEqual(request.params[1], { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (request.method === 'getBlockHeight') assert.deepEqual(request.params, [{ commitment: 'confirmed' }]);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'getGenesisHash' ? genesis : request.method === 'getBlockHeight' ? height : receipt }));
  };
}

test('V97,V99: preparation retains coherent chain evidence and builds the exact obligation-free ABI', async () => {
  const { intent, mock } = await prepared({ receiptMissing: true });
  assert.deepEqual(mock.calls.map(c => c.method), ['getGenesisHash', 'getMultipleAccounts', 'getLatestBlockhash', 'simulateTransaction']);
  assert.equal(intent.walletControl, 'unverified'); assert.equal(intent.snapshot.slot, fixture.slot);
  assert.equal(intent.accounts.marketAuthority, '7Aoc3MHQkYSB5y3g3ipyFKWF2TBsYdvqNWHbQ2btWXJt');
  assert.equal(intent.createDestinationAta, true); assert.ok(Object.isFrozen(intent.snapshot.graph.nodes));
  assert.equal(intent.snapshot.graph.edges.some(e => e.source === wallet && e.target === a.walletReceipt), false);
  for (const exchange of intent.snapshot.exchanges) assert.equal(hash(Buffer.from(exchange.response.bodyBase64, 'base64')), exchange.response.sha256);
  const tx = deserializeLendingTransaction(Buffer.from(intent.transactionBase64, 'base64'));
  assert.equal(validateLendingTransaction(tx, intent), true);
  assert.equal(tx.message.header.numRequiredSignatures, 1); assert.deepEqual(tx.message.addressTableLookups, []);
  const ix = tx.message.compiledInstructions;
  assert.deepEqual([...ix[0].data], [1]);
  assert.deepEqual([...ix[1].data], [2, 218, 138, 235, 79, 201, 25, 102]);
  assert.deepEqual([...ix[2].data.subarray(0, 8)], [169, 201, 30, 126, 6, 205, 102, 68]);
  assert.equal(new DataView(ix[2].data.buffer, ix[2].data.byteOffset).getBigUint64(8, true), 1000000n);
  assert.deepEqual(Array.from(ix[2].accountKeyIndexes, index => tx.message.staticAccountKeys[index].toBase58()), [
    wallet, C.reserve, C.market, a.marketAuthority, C.liquidityMint, C.liquidityVault, C.receiptMint,
    a.walletLiquidity, a.walletReceipt, C.tokenProgram, C.tokenProgram, C.instructionsSysvar,
  ]);
});

test('V97: redeem uses receipt units and exact redemption account order', async () => {
  const { intent } = await prepared({ action: 'redeem' });
  const tx = deserializeLendingTransaction(Buffer.from(intent.transactionBase64, 'base64'));
  const ix = tx.message.compiledInstructions.at(-1);
  assert.deepEqual([...ix.data.subarray(0, 8)], [234, 117, 181, 125, 185, 142, 220, 29]);
  assert.deepEqual(Array.from(ix.accountKeyIndexes, index => tx.message.staticAccountKeys[index].toBase58()), [
    wallet, C.market, C.reserve, a.marketAuthority, C.liquidityMint, C.receiptMint, C.liquidityVault,
    a.walletReceipt, a.walletLiquidity, C.tokenProgram, C.tokenProgram, C.instructionsSysvar,
  ]);
});

test('V97: invalid amount and supply cap fail before any RPC', async () => {
  for (const value of ['0', '-1', '01', '1.0', '1000001', '18446744073709551616']) {
    const mock = capture({ inputBaseUnits: value });
    await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), { code: 'INVALID_INPUT' });
    assert.equal(mock.calls.length, 0);
  }
});

test('V99: wrong genesis cannot progress to account reads', async () => {
  const mock = capture({ genesis: 'mainnet' });
  await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), /not Solana Devnet/);
  assert.equal(mock.calls.length, 1);
});

test('V97,V99: account identity, version, ownership, clock and stale oracle failures block preparation', async () => {
  const changes = [
    value => { value[0].owner = C.systemProgram; },
    value => editBytes(value[0], b => b.writeBigUInt64LE(2n, 8)),
    value => editBytes(value[0], b => b.fill(0, 128, 160)),
    value => editBytes(value[1], b => { b[122] = 1; }),
    value => editBytes(value[0], b => { b[4864] = 1; }),
    value => editBytes(value[0], b => { b[4862] = 1; }),
    value => editBytes(value[0], b => b.writeBigUInt64LE(1n, 5016)),
    value => editBytes(value[5], b => b.fill(0, 32, 64)),
    value => editBytes(value[4], b => b.writeBigUInt64LE(1n, 64)),
    value => { value[8].executable = false; },
    value => editBytes(value[9], b => { b[40] = 0; }),
    value => editBytes(value[9], b => b.writeBigInt64LE(1790500000n, 93)),
    value => editBytes(value[10], b => b.writeBigUInt64LE(1n, 0)),
  ];
  for (const change of changes) {
    const mock = capture({ snapshotEdit: result => change(result.value) });
    await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), { code: 'INVALID_INPUT' });
    assert.equal(mock.calls.length, 2);
  }
});

test('V97: supply rejects required permission; direct redemption remains available with cToken usage disabled', async () => {
  const snapshotEdit = result => {
    editBytes(result.value[1], b => { signer.publicKey.toBuffer().copy(b, 3400); b.writeBigUInt64LE(1n, 3432); });
    editBytes(result.value[0], b => { b[4862] = 1; });
  };
  const mock = capture({ snapshotEdit });
  await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), /supply is disabled/);
  const permission = capture({ snapshotEdit: result => editBytes(result.value[1], b => {
    signer.publicKey.toBuffer().copy(b, 3400); b.writeBigUInt64LE(1n, 3432);
  }) });
  await assert.rejects(prepareLending(permission.input, { fetchImpl: permission.fetchImpl, now }), /another signer/);
  assert.equal((await prepared({ action: 'redeem', snapshotEdit })).intent.action, 'redeem');
});

test('V97: redemption cannot use queued liquidity or bypass a withdrawal cap', async () => {
  for (const edit of [
    b => b.writeBigUInt64LE(252145908n, 6968),
    b => { b.writeBigInt64LE(1n, 5416); b.writeBigInt64LE(0n, 5424); b.writeBigUInt64LE(1790500600n, 5432); b.writeBigUInt64LE(3600n, 5440); },
  ]) {
    const mock = capture({ action: 'redeem', snapshotEdit: r => editBytes(r.value[0], edit) });
    await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), { code: 'INVALID_INPUT' });
  }
});

test('V97: simulation failure, missing accounts, changed owner and inconsistent deltas cannot prepare an intent', async () => {
  for (const simulationEdit of [
    r => { r.value.err = { InstructionError: [1, 'Custom'] }; },
    r => { r.value.accounts = null; },
    r => { r.context.slot = fixture.slot - 1; },
    r => editBytes(r.value.accounts[0], b => b.fill(0, 32, 64)),
    r => editBytes(r.value.accounts[2], b => b.writeBigUInt64LE(252145908n, 64)),
  ]) {
    const mock = capture({ simulationEdit });
    await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), { code: 'INVALID_INPUT' });
  }
});

test('V99: oversized and malformed RPC responses fail with safe transport errors', async () => {
  for (const responseEdit of [() => new Response('x'.repeat(128 * 1024 + 1)), () => new Response('not-json'),
    () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'SECRET_SENTINEL' } }))]) {
    const mock = capture({ responseEdit });
    await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), error => {
      assert.equal(error.code, 'STORAGE_UNAVAILABLE'); assert.ok(!error.message.includes('SECRET_SENTINEL')); return true;
    });
  }
});

test('V97: signed registration proves the sole wallet signature and rejects altered messages', async () => {
  const { intent } = await prepared(); const valid = signed(intent);
  assert.equal(verifySignedLending(intent, valid.transactionBase64), valid.signature);
  assert.throws(() => verifySignedLending(intent, intent.transactionBase64), { code: 'INVALID_INPUT' });
  const changed = deserializeLendingTransaction(Buffer.from(intent.transactionBase64, 'base64'));
  changed.message.compiledInstructions.at(-1).data[8] ^= 1; changed.sign([signer]);
  assert.throws(() => verifySignedLending(intent, Buffer.from(changed.serialize()).toString('base64')), { code: 'INVALID_INPUT' });
  assert.throws(() => verifySignedLending({ ...intent, network: 'mainnet' }, valid.transactionBase64), { code: 'INVALID_INPUT' });
  assert.throws(() => verifySignedLending({ ...intent, messageSha256: '0'.repeat(64) }, valid.transactionBase64), { code: 'INVALID_INPUT' });
  assert.throws(() => deserializeLendingTransaction(new Uint8Array(1233)), /limit/);
});

test('V97: receipt verifies transaction-local deltas, including new ATA and rounded supply debit', async () => {
  for (const receiptMissing of [false, true]) {
    const { intent } = await prepared({ receiptMissing });
    const fixture = receiptFixture(intent, { liquidity: 999999n, collateral: 999990n });
    const result = await readLendingReceipt(intent, fixture.signature, { fetchImpl: receiptRpc(fixture.value), now });
    assert.equal(result.status, 'CONFIRMED');
    assert.deepEqual(result.amounts, { liquidityBaseUnits: '999999', receiptBaseUnits: '999990' });
    assert.equal(result.signature, fixture.signature); assert.equal(result.exchanges.length, 2);
  }
});

test('V97: redemption receipt burns exact requested receipt units and records actual USDC', async () => {
  const { intent } = await prepared({ action: 'redeem', liquidityMissing: true });
  const fixture = receiptFixture(intent, { liquidity: 1000011n, collateral: 1000000n });
  const result = await readLendingReceipt(intent, fixture.signature, { fetchImpl: receiptRpc(fixture.value), now });
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.amounts.liquidityBaseUnits, '1000011');
  fixture.value.meta.postTokenBalances[1].uiTokenAmount.amount = '1000001';
  assert.equal((await readLendingReceipt(intent, fixture.signature, { fetchImpl: receiptRpc(fixture.value), now })).status, 'UNVERIFIED');
});

test('V97,V99: wrong chain, message, mint, owner, account, missing or duplicate balances never confirm', async () => {
  const { intent } = await prepared();
  const changes = [
    r => { r.meta = null; }, r => { r.meta.postTokenBalances = null; },
    r => { r.meta.postTokenBalances[0].mint = C.receiptMint; },
    r => { r.meta.postTokenBalances[0].owner = C.systemProgram; },
    r => { r.meta.preTokenBalances.splice(0, 1); },
    r => { r.meta.postTokenBalances[2].uiTokenAmount.amount = '252145908'; },
    r => { r.meta.postTokenBalances[1].accountIndex = r.meta.postTokenBalances[0].accountIndex; },
    r => { r.transaction[0] = intent.transactionBase64; },
  ];
  for (const change of changes) {
    const fixture = receiptFixture(intent); change(fixture.value);
    const result = await readLendingReceipt(intent, fixture.signature, { fetchImpl: receiptRpc(fixture.value), now });
    assert.equal(result.status, 'UNVERIFIED'); assert.equal(result.amounts, null);
  }
  const fixture = receiptFixture(intent);
  assert.equal((await readLendingReceipt(intent, fixture.signature, { fetchImpl: receiptRpc(fixture.value, 'mainnet'), now })).status, 'UNVERIFIED');
});

test('V97: unavailable and failed transactions remain distinct from confirmed effects', async () => {
  const { intent } = await prepared(); const fixture = receiptFixture(intent);
  assert.equal((await readLendingReceipt(intent, fixture.signature, { fetchImpl: receiptRpc(null), now })).status, 'PENDING');
  fixture.value.meta.err = { InstructionError: [1, { Custom: 6000 }] };
  const failed = await readLendingReceipt(intent, fixture.signature, { fetchImpl: receiptRpc(fixture.value), now });
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.amounts, null);
});

test('V102: missing receipt after blockhash expiry is unverified rather than pending forever', async () => {
  const { intent } = await prepared(); const { signature } = signed(intent);
  const result = await readLendingReceipt(intent, signature, { fetchImpl: receiptRpc(null, C.genesisHash, lifetime.lastValidBlockHeight + 1), now });
  assert.equal(result.status, 'UNVERIFIED'); assert.equal(result.amounts, null);
  assert.match(result.reason, /expired/i);
  assert.match(result.reason, /does not prove/i);
  assert.deepEqual(result.exchanges.map(exchange => exchange.request.rpcMethod), ['getGenesisHash', 'getTransaction', 'getBlockHeight']);
  const pending = await readLendingReceipt(intent, signature, { fetchImpl: receiptRpc(null, C.genesisHash, lifetime.lastValidBlockHeight), now });
  assert.equal(pending.status, 'PENDING');
  const malformed = await readLendingReceipt(intent, signature, { fetchImpl: receiptRpc(null, C.genesisHash, 'invalid'), now });
  assert.equal(malformed.status, 'UNVERIFIED');
});

test('A1: preparation stamps policy and adapter versions and drift is rejected as a conflict', async () => {
  const { intent } = await prepared();
  assert.equal(intent.policyVersion, 'mesh-public-evidence/1');
  assert.equal(intent.adapterVersion, ADAPTER_VERSION);
  assert.equal(verifyLendingVersions(intent), undefined);
  assert.throws(() => verifyLendingVersions({ ...intent, adapterVersion: 'kamino-devnet-adapter/0' }), { code: 'CONFLICT' });
  assert.throws(() => verifyLendingVersions({ ...intent, policyVersion: 'mesh-public-evidence/0' }), { code: 'CONFLICT' });
  assert.throws(() => verifyLendingVersions({ ...intent, adapterVersion: undefined }), { code: 'CONFLICT' });
});

test('null wallet system account fails with exact SOL balance message', async () => {
  // Index 7 in getMultipleAccounts result = wallet system account
  const mock = capture({ snapshotEdit: r => { r.value[7] = null; } });
  await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), {
    code: 'INVALID_INPUT',
    message: 'Wallet has no usable Devnet SOL balance.',
  });
});

test('null wallet USDC token account on supply fails with exact USDC account message', async () => {
  // Index 5 in getMultipleAccounts result = walletLiquidity account
  const mock = capture({ snapshotEdit: r => { r.value[5] = null; } });
  await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), {
    code: 'INVALID_INPUT',
    message: 'Wallet has no Devnet USDC token account.',
  });
});

test('null wallet receipt token account on redeem fails with exact receipt message', async () => {
  // Index 6 in getMultipleAccounts result = walletReceipt account
  const mock = capture({ action: 'redeem', snapshotEdit: r => { r.value[6] = null; } });
  await assert.rejects(prepareLending(mock.input, { fetchImpl: mock.fetchImpl, now }), {
    code: 'INVALID_INPUT',
    message: 'Wallet has no Kamino receipt tokens to redeem.',
  });
});
