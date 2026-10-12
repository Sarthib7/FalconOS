import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { createApi, parseTokenHashes } from '../http.mjs';
import { MeshError } from '../domain.mjs';
import { LENDING_CONFIG as C, deriveAccounts, buildLendingTransaction } from '../kamino-wire.mjs';
import { readWalletStatus } from '../wallet-status.mjs';
import { inspectTransaction } from '../transaction-inspection.mjs';

const signer = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const wallet = signer.publicKey.toBase58();
const accounts = deriveAccounts(wallet);
const blockhash = new PublicKey(Uint8Array.from({ length: 32 }, () => 9)).toBase58();
const testToken = 'read-only-api-test-token-000000000000000000';
const tokenHashes = parseTokenHashes(JSON.stringify({
  [createHash('sha256').update(testToken).digest('hex')]: 'read_only_test',
}));

function mintAccount(decimals = C.decimals) {
  const bytes = Buffer.alloc(82);
  bytes[44] = decimals;
  bytes[45] = 1;
  return { owner: C.tokenProgram, executable: false, data: [bytes.toString('base64'), 'base64'], space: bytes.length };
}

function tokenAccount(mint, owner, amount = '0', state = 1) {
  const bytes = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(bytes, 0);
  new PublicKey(owner).toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(BigInt(amount), 64);
  bytes[108] = state;
  return { owner: C.tokenProgram, executable: false, data: [bytes.toString('base64'), 'base64'], space: bytes.length };
}

function rpcFetch({ genesisHash = C.genesisHash, values = [null, null, null, mintAccount(), mintAccount()], malformed = false, oversized = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, ...request });
    const result = request.method === 'getGenesisHash' ? genesisHash : { context: { slot: 456 }, value: values };
    const body = oversized ? ' '.repeat(64 * 1024 + 1) : malformed ? 'not-json' : JSON.stringify({ jsonrpc: '2.0', id: 1, result });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('V156: wallet status validates fixed context, reports missing accounts and exact base units', async () => {
  const rpc = rpcFetch({ values: [
    { lamports: 0, owner: C.systemProgram, executable: false },
    tokenAccount(C.liquidityMint, wallet, '0'),
    null,
    mintAccount(),
    mintAccount(),
  ] });
  const status = await readWalletStatus({ wallet }, { fetchImpl: rpc.fetchImpl, now: () => '2026-10-12T12:00:00.000Z' });
  assert.deepEqual(rpc.calls.map(call => call.method), ['getGenesisHash', 'getMultipleAccounts']);
  assert.equal(rpc.calls[0].url, C.rpcUrl);
  assert.deepEqual(rpc.calls[1].params[0], [wallet, accounts.walletLiquidity, accounts.walletReceipt, C.liquidityMint, C.receiptMint]);
  assert.equal(status.walletAddress, wallet);
  assert.equal(status.chain, 'solana');
  assert.equal(status.network, 'devnet');
  assert.equal(status.capturedAt, '2026-10-12T12:00:00.000Z');
  assert.equal(status.slot, 456);
  assert.deepEqual(status.sol, { balanceLamports: '0' });
  assert.deepEqual(status.usdc, { mint: C.liquidityMint, tokenAccount: accounts.walletLiquidity, exists: true, balanceBaseUnits: '0', decimals: 6 });
  assert.deepEqual(status.receipt, { mint: C.receiptMint, tokenAccount: accounts.walletReceipt, exists: false, balanceBaseUnits: '0', decimals: 6 });
  assert.deepEqual(status.missing, ['SOL_FOR_FEES', 'USDC_BALANCE_ZERO']);
  assert.equal(status.faucet.humanOnly, true);
  assert.equal(status.faucet.links.solFaucet, 'https://faucet.solana.com/');
  assert.equal(status.faucet.links.usdcFaucet, 'https://faucet.circle.com/');
  assert.equal(status.executionReady, false);

  const exactRpc = rpcFetch({ values: [
    { lamports: 100, owner: C.systemProgram, executable: false },
    tokenAccount(C.liquidityMint, wallet, '9007199254740993'),
    tokenAccount(C.receiptMint, wallet, '42'),
    mintAccount(),
    mintAccount(),
  ] });
  const exact = await readWalletStatus({ wallet }, { fetchImpl: exactRpc.fetchImpl });
  assert.equal(exact.usdc.balanceBaseUnits, '9007199254740993');
  assert.equal(exact.receipt.balanceBaseUnits, '42');
  assert.deepEqual(exact.missing, []);

  const redeemRpc = rpcFetch({ values: [{ lamports: 2, owner: C.systemProgram, executable: false }, null, null, mintAccount(), mintAccount()] });
  const redeem = await readWalletStatus({ wallet, forAction: 'redeem' }, { fetchImpl: redeemRpc.fetchImpl });
  assert.deepEqual(redeem.missing, ['RECEIPT_ASSOCIATED_TOKEN_ACCOUNT']);
});

test('V156: invalid wallet/context and RPC/schema errors are rejected without fabricated balances', async () => {
  let calls = 0;
  const fetchImpl = async (...args) => { calls++; return rpcFetch().fetchImpl(...args); };
  for (const input of [
    { wallet: 'not-a-public-key' },
    { wallet, network: 'mainnet-beta' },
    { wallet, chain: null },
    { wallet, forAction: null },
    { wallet, extra: true },
  ]) {
    await assert.rejects(readWalletStatus(input, { fetchImpl }), error => error.code === 'INVALID_INPUT');
  }
  assert.equal(calls, 0);
  await assert.rejects(readWalletStatus({ wallet }, { fetchImpl: rpcFetch({ genesisHash: 'wrong-cluster' }).fetchImpl }), error => error.code === 'STORAGE_UNAVAILABLE');
  await assert.rejects(readWalletStatus({ wallet }, { fetchImpl: rpcFetch({ malformed: true }).fetchImpl }), error => error.code === 'STORAGE_UNAVAILABLE');
  await assert.rejects(readWalletStatus({ wallet }, { fetchImpl: rpcFetch({ oversized: true }).fetchImpl }), error => error.code === 'STORAGE_UNAVAILABLE');
  const malformedAccounts = rpcFetch({ values: [null, { ...tokenAccount(C.liquidityMint, wallet), owner: 'wrong-token-program' }, null, mintAccount(), mintAccount()] });
  await assert.rejects(readWalletStatus({ wallet }, { fetchImpl: malformedAccounts.fetchImpl }), error => error.code === 'STORAGE_UNAVAILABLE');
});

function wire(instructions, { versioned = false, lookupTables = [] } = {}) {
  if (!versioned) {
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(...instructions);
    return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  }
  const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

test('V157: decoder reports canonical legacy instructions and known exact amounts without signing or sending', () => {
  const reference = buildLendingTransaction({ wallet, action: 'supply', inputBaseUnits: '1000000', blockhash, lastValidBlockHeight: 100, createDestinationAta: true }).message;
  const referenceInstruction = (index, data) => {
    const compiled = reference.compiledInstructions[index];
    return new TransactionInstruction({ programId: reference.staticAccountKeys[compiled.programIdIndex], data,
      keys: [...compiled.accountKeyIndexes].map(index => ({ pubkey: reference.staticAccountKeys[index], isSigner: reference.isAccountSigner(index), isWritable: reference.isAccountWritable(index) })) });
  };
  const kaminoData = Buffer.alloc(16);
  Buffer.from([169, 201, 30, 126, 6, 205, 102, 68]).copy(kaminoData, 0);
  kaminoData.writeBigUInt64LE(1234567n, 8);
  const kaminoIx = referenceInstruction(2, kaminoData);
  const transfer = SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(Buffer.alloc(32, 7)), lamports: 98765 });
  const tokenData = Buffer.alloc(9);
  tokenData[0] = 3;
  tokenData.writeBigUInt64LE(65536n, 1);
  const tokenTransfer = new TransactionInstruction({
    programId: new PublicKey(C.tokenProgram),
    keys: [
      { pubkey: new PublicKey(Buffer.alloc(32, 8)), isWritable: true },
      { pubkey: new PublicKey(Buffer.alloc(32, 9)), isWritable: true },
      { pubkey: signer.publicKey, isSigner: true },
    ],
    data: tokenData,
  });
  const ataCreate = referenceInstruction(0, Buffer.from([1]));
  const transactionBase64 = wire([transfer, tokenTransfer, ataCreate, kaminoIx]);
  const original = transactionBase64;
  let signCalls = 0;
  let fetchCalls = 0;
  const originalSign = VersionedTransaction.prototype.sign;
  const originalFetch = globalThis.fetch;
  VersionedTransaction.prototype.sign = function (...args) { signCalls++; return originalSign.apply(this, args); };
  globalThis.fetch = async (...args) => { fetchCalls++; return originalFetch(...args); };
  let result;
  try { result = inspectTransaction({ transactionBase64 }); }
  finally { VersionedTransaction.prototype.sign = originalSign; globalThis.fetch = originalFetch; }
  assert.equal(signCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(transactionBase64, original);
  assert.equal(result.transactionVersion, 'legacy');
  assert.equal(result.feePayer, wallet);
  assert.deepEqual(result.requiredSigners, [wallet]);
  assert.equal(result.signatureState, 'unsigned');
  assert.deepEqual(result.instructions.map(instruction => instruction.parsed), [
    { kind: 'system.transfer', lamports: '98765' },
    { kind: 'spl-token.transfer', amountBaseUnits: '65536' },
    { kind: 'associated-token.createIdempotent' },
    { kind: 'kamino.supply', amountBaseUnits: '1234567' },
  ]);
  assert.equal(result.networkAttestation, 'requested-context-only');
  assert.equal(result.executionReady, false);
  assert.equal(result.safeToSign, false);
  assert.ok(result.riskFlags.includes('NETWORK_NOT_ATTESTED'));
});

test('V157: unknown programs and unresolved lookup addresses stay explicit risks', () => {
  const unknownProgram = new PublicKey(Buffer.alloc(32, 77));
  const unknownIx = new TransactionInstruction({
    programId: unknownProgram,
    keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: true }],
    data: Buffer.from([1, 2, 3]),
  });
  const unknown = inspectTransaction({ transactionBase64: wire([unknownIx]) });
  assert.equal(unknown.instructions[0].programId, unknownProgram.toBase58());
  assert.ok(unknown.riskFlags.includes(`UNKNOWN_PROGRAM:${unknownProgram.toBase58()}`));

  const destination = new PublicKey(Buffer.alloc(32, 88));
  const tableKey = new PublicKey(Buffer.alloc(32, 99));
  const table = new AddressLookupTableAccount({
    key: tableKey,
    state: {
      deactivationSlot: 18446744073709551615n,
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      addresses: [destination],
    },
  });
  const v0Base64 = wire([SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: destination, lamports: 9 })], { versioned: true, lookupTables: [table] });
  const v0 = inspectTransaction({ transactionBase64: v0Base64 });
  assert.equal(v0.transactionVersion, 0);
  assert.equal(v0.lookupTables[0].address, tableKey.toBase58());
  assert.equal(v0.lookupTables[0].resolved, false);
  assert.equal(v0.instructions[0].accounts.find(account => account.address === null).resolved, false);
  assert.ok(v0.riskFlags.includes('UNRESOLVED_LOOKUP_ADDRESSES'));
  assert.equal(v0.safeToSign, false);
});

test('V157: malformed, noncanonical, oversized and unsupported decode inputs fail closed', () => {
  for (const input of [
    {},
    { transactionBase64: '%%%=' },
    { transactionBase64: Buffer.alloc(1233).toString('base64') },
    { transactionBase64: Buffer.alloc(1).toString('base64'), network: 'mainnet-beta' },
    { transactionBase64: Buffer.alloc(1).toString('base64'), chain: null },
    { transactionBase64: wire([SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: signer.publicKey, lamports: 1 })]), extra: true },
  ]) assert.throws(() => inspectTransaction(input), error => error.code === 'INVALID_INPUT');
});

test('V156/V157: public routes need no bearer, inject real handlers, and reserve source/global budget before body work', async t => {
  const seen = [];
  const server = createApi({
    store: {},
    tokenHashes,
    walletLookupMaxPerSource: 10,
    walletLookupMaxGlobal: 10,
    walletStatus: async input => { seen.push(['status', input]); return { walletAddress: input.wallet, executionReady: false }; },
    transactionInspection: async input => { seen.push(['decode', input]); return { networkAttestation: 'requested-context-only', safeToSign: false }; },
  });
  const base = await listen(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const status = await post('/v1/wallet/status', { wallet });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).walletAddress, wallet);
  const decoded = await post('/v1/transactions/decode', { transactionBase64: 'AA==' });
  assert.equal(decoded.status, 200);
  assert.equal((await decoded.json()).safeToSign, false);
  assert.deepEqual(seen.map(([name]) => name), ['status', 'decode']);
  assert.equal((await post('/v1/wallet/status?network=mainnet', { wallet })).status, 400);

  const limited = createApi({
    store: {}, tokenHashes,
    walletLookupMaxPerSource: 1,
    walletLookupMaxGlobal: 1,
    walletStatus: async () => { throw new MeshError('INVALID_INPUT', 'bad request'); },
    transactionInspection: async () => { throw new Error('must not reach handler'); },
  });
  const limitedBase = await listen(limited);
  t.after(async () => { limited.closeAllConnections(); await new Promise(resolve => limited.close(resolve)); });
  const tooLarge = await fetch(limitedBase + '/v1/wallet/status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, padding: 'x'.repeat(600) }),
  });
  assert.equal(tooLarge.status, 413);
  const preLimited = await fetch(limitedBase + '/v1/transactions/decode', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactionBase64: 'AA==' }),
  });
  assert.equal(preLimited.status, 429);
  assert.equal((await preLimited.json()).error.code, 'RATE_LIMITED');
});

test('V156/V157: route validation rejects addresses and context before RPC', async t => {
  let rpcCalls = 0;
  const fetchImpl = async () => { rpcCalls++; throw new Error('unexpected RPC call'); };
  const server = createApi({
    store: {}, tokenHashes,
    walletLookupMaxPerSource: 10, walletLookupMaxGlobal: 10,
    walletStatus: input => readWalletStatus(input, { fetchImpl }),
    transactionInspection: inspectTransaction,
  });
  const base = await listen(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const post = (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const body of [{ wallet: 'not-a-wallet' }, { wallet, network: 'mainnet-beta' }]) {
    const response = await post('/v1/wallet/status', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_INPUT');
  }
  const decoded = await post('/v1/transactions/decode', { transactionBase64: '%%%=' });
  assert.equal(decoded.status, 400);
  assert.equal((await decoded.json()).error.code, 'INVALID_INPUT');
  assert.equal(rpcCalls, 0);
});

test('V156/V157: successful public reads consume pre-auth source and global budgets', async t => {
  let handlerCalls = 0;
  const server = createApi({
    store: {}, tokenHashes, walletLookupMaxPerSource: 1, walletLookupMaxGlobal: 1,
    walletStatus: async () => { handlerCalls++; return { executionReady: false }; },
    transactionInspection: async () => { handlerCalls++; return { safeToSign: false }; },
  });
  const base = await listen(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const first = await fetch(base + '/v1/wallet/status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet }),
  });
  assert.equal(first.status, 200);
  const second = await fetch(base + '/v1/transactions/decode', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactionBase64: 'AA==' }),
  });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'RATE_LIMITED');
  assert.equal(handlerCalls, 1);
});

test('V157: signed legacy and V0 wire is classified as present but unverified', () => {
  const instruction = SystemProgram.transfer({
    fromPubkey: signer.publicKey,
    toPubkey: new PublicKey(Buffer.alloc(32, 11)),
    lamports: 10,
  });
  const legacy = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(instruction);
  legacy.sign(signer);
  const legacyResult = inspectTransaction({ transactionBase64: legacy.serialize().toString('base64') });
  assert.equal(legacyResult.transactionVersion, 'legacy');
  assert.equal(legacyResult.signatureState, 'signed');
  assert.ok(legacyResult.riskFlags.includes('SIGNATURES_NOT_VERIFIED'));

  const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [instruction] }).compileToV0Message();
  const versioned = new VersionedTransaction(message);
  versioned.sign([signer]);
  const versionedResult = inspectTransaction({ transactionBase64: Buffer.from(versioned.serialize()).toString('base64') });
  assert.equal(versionedResult.transactionVersion, 0);
  assert.equal(versionedResult.signatureState, 'signed');
  assert.ok(versionedResult.riskFlags.includes('SIGNATURES_NOT_VERIFIED'));
  assert.equal(versionedResult.safeToSign, false);
});

test('V157: known opcodes with missing account metas remain unparsed risks', () => {
  const system = Buffer.alloc(12); system.writeUInt32LE(2); system.writeBigUInt64LE(7n, 4);
  const token = Buffer.alloc(9); token[0] = 3; token.writeBigUInt64LE(7n, 1);
  const kamino = Buffer.alloc(16); Buffer.from([169, 201, 30, 126, 6, 205, 102, 68]).copy(kamino);
  for (const [programId, data] of [[C.systemProgram, system], [C.tokenProgram, token], [C.associatedTokenProgram, Buffer.from([1])], [C.program, kamino]]) {
    const result = inspectTransaction({ transactionBase64: wire([new TransactionInstruction({ programId: new PublicKey(programId), keys: [], data })]) });
    assert.equal(result.instructions[0].parsed, undefined);
    assert.ok(result.riskFlags.includes(`UNPARSED_INSTRUCTION:${programId}`));
    assert.equal(result.safeToSign, false);
  }
});

test('V156: executable or non-System native accounts cannot imply usable fee funds', async () => {
  for (const account of [{ lamports: 1, owner: C.loader, executable: false }, { lamports: 1, owner: C.systemProgram, executable: true }]) {
    const rpc = rpcFetch({ values: [account, null, null, mintAccount(), mintAccount()] });
    await assert.rejects(readWalletStatus({ wallet }, { fetchImpl: rpc.fetchImpl }), error => error.code === 'STORAGE_UNAVAILABLE');
  }
});
