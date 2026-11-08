import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import BN from 'bn.js';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  PROGRAM_ID,
  depositReserveLiquidity,
  noopSigner,
  refreshReserve,
} from '@kamino-finance/klend-sdk';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  none,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
  createSolanaLendingAdapter,
  DEFAULT_LENDING_RESERVES,
  SolanaLendingError,
  USDC_MINT,
} from '../cfo/solana-lending.mjs';

const walletKeypair = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const wallet = walletKeypair.publicKey.toBase58();
const [reviewed] = DEFAULT_LENDING_RESERVES;
const receiptMint = 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D';
const marketAuthority = new PublicKey(Uint8Array.from({ length: 32 }, () => 19)).toBase58();
const reserveVault = new PublicKey(Uint8Array.from({ length: 32 }, () => 21)).toBase58();
const instructionsSysvar = 'Sysvar1nstructions1111111111111111111111111';
const blockhash = new PublicKey(Uint8Array.from({ length: 32 }, () => 9)).toBase58();
const baseTimeMs = Date.parse('2026-11-08T10:00:00.000Z');
const baseTimeSeconds = Math.floor(baseTimeMs / 1000);

function ata(owner, mint) {
  const [addressValue] = PublicKey.findProgramAddressSync([
    new PublicKey(owner).toBuffer(),
    new PublicKey(TOKEN_PROGRAM_ADDRESS.toString()).toBuffer(),
    new PublicKey(mint).toBuffer(),
  ], new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString()));
  return addressValue.toBase58();
}

function encodeSignature(signature) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${Buffer.from(signature).toString('hex')}`);
  let out = '';
  while (value > 0n) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of signature) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function buildUnsignedSupply(amountBaseUnits) {
  const usdcAta = ata(wallet, USDC_MINT);
  const receiptAta = ata(wallet, receiptMint);
  const ownerSigner = noopSigner(address(wallet));
  const refresh = refreshReserve({
    reserve: address(reviewed.reserveAddress),
    lendingMarket: address(reviewed.marketAddress),
    pythOracle: none(),
    switchboardPriceOracle: none(),
    switchboardTwapOracle: none(),
    scopePrices: none(),
  }, undefined, address(PROGRAM_ID.toString()));
  const supply = depositReserveLiquidity({
    liquidityAmount: new BN(amountBaseUnits),
  }, {
    owner: ownerSigner,
    reserve: address(reviewed.reserveAddress),
    lendingMarket: address(reviewed.marketAddress),
    lendingMarketAuthority: address(marketAuthority),
    reserveLiquidityMint: address(USDC_MINT),
    reserveLiquiditySupply: address(reserveVault),
    reserveCollateralMint: address(receiptMint),
    userSourceLiquidity: address(usdcAta),
    userDestinationCollateral: address(receiptAta),
    collateralTokenProgram: TOKEN_PROGRAM_ADDRESS,
    liquidityTokenProgram: TOKEN_PROGRAM_ADDRESS,
    instructionSysvarAccount: address(instructionsSysvar),
  }, undefined, address(PROGRAM_ID.toString()));
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayer(address(wallet), tx),
    tx => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight: 9000n }, tx),
    tx => appendTransactionMessageInstructions([refresh, supply], tx),
  );
  const transaction = compileTransaction(message);
  return {
    amountBaseUnits,
    usdcAta,
    receiptAta,
    supplyInstruction: supply,
    transactionBase64: getBase64EncodedWireTransaction(transaction),
    messageSha256: createHash('sha256').update(transaction.messageBytes).digest('hex'),
  };
}

function preparedSupply(amountBaseUnits = '1000', { priceAgeSeconds = 120 } = {}) {
  const built = buildUnsignedSupply(amountBaseUnits);
  const now = new Date(baseTimeMs).toISOString();
  const sourcePriceTime = new Date(baseTimeMs - priceAgeSeconds * 1000).toISOString();
  return {
    schemaVersion: 1,
    chain: 'solana',
    network: 'mainnet-beta',
    wallet,
    action: 'supply',
    reserveAddress: reviewed.reserveAddress,
    amountBaseUnits,
    amountUnit: 'usdc-base-units',
    recipient: wallet,
    transactionBase64: built.transactionBase64,
    messageSha256: built.messageSha256,
    signature: null,
    blockhash,
    lastValidBlockHeight: 9000,
    observedAt: now,
    expiresAt: new Date(baseTimeMs + 120_000).toISOString(),
    feeLamports: '5000',
    rentLamports: '0',
    expectedEffects: {
      usdcDebitBaseUnits: amountBaseUnits,
      usdcCreditBaseUnits: '0',
      receiptDebitBaseUnits: '0',
      receiptCreditBaseUnits: '7',
    },
    source: { slot: 466_900_000, programId: PROGRAM_ID.toString(), adapterVersion: 'kamino-mainnet-lending/1' },
    nativePriceUsdMicros: '150000000',
    usdcPriceUsdMicros: '1000000',
    nativePriceObservedAt: sourcePriceTime,
    usdcPriceObservedAt: sourcePriceTime,
    nativePriceSourceReserveAddress: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q',
    usdcPriceSourceReserveAddress: reviewed.reserveAddress,
    sourceTokenAccount: built.usdcAta,
    destinationTokenAccount: built.receiptAta,
    receiptMint,
    feeRecipient: null,
    costEvidence: { maxFeeLamports: '10000', priceMaxAgeSeconds: 60 },
    built,
  };
}

function signPrepared(prepared) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, 'base64'));
  transaction.sign([walletKeypair]);
  const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString('base64');
  return { transaction, signedTransactionBase64, signature: encodeSignature(transaction.signatures[0]) };
}

function jsonRpcFetch({ getTransaction = () => null, height = 8_000, onCall = () => {} } = {}) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    onCall(request.method);
    let result;
    if (request.method === 'getGenesisHash') result = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    else if (request.method === 'getBlockHeight') result = height;
    else if (request.method === 'getTransaction') result = getTransaction(request.params[0]);
    else throw new Error(`Unexpected deterministic RPC method ${request.method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  };
}

function tokenBalance(transaction, account, mint, amount) {
  const accountIndex = transaction.message.staticAccountKeys.findIndex(key => key.toBase58() === account);
  assert.notEqual(accountIndex, -1);
  return {
    accountIndex,
    mint,
    owner: wallet,
    programId: TOKEN_PROGRAM_ADDRESS.toString(),
    uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: '0' },
  };
}

function successfulSupplyReceipt(signed, prepared, { blockTime = baseTimeSeconds + 1 } = {}) {
  const keys = signed.transaction.message.staticAccountKeys;
  const walletIndex = keys.findIndex(key => key.toBase58() === wallet);
  const preBalances = keys.map((_, index) => index === walletIndex ? 50_000_000 : 0);
  const postBalances = keys.map((_, index) => index === walletIndex ? 49_995_000 : 0);
  const amount = BigInt(prepared.amountBaseUnits);
  return {
    slot: 466_900_123,
    blockTime,
    version: 0,
    transaction: [signed.signedTransactionBase64, 'base64'],
    meta: {
      err: null,
      fee: 5000,
      preBalances,
      postBalances,
      preTokenBalances: [
        tokenBalance(signed.transaction, prepared.sourceTokenAccount, USDC_MINT, '2000000'),
        tokenBalance(signed.transaction, prepared.destinationTokenAccount, prepared.receiptMint, '10'),
      ],
      postTokenBalances: [
        tokenBalance(signed.transaction, prepared.sourceTokenAccount, USDC_MINT, (2_000_000n - amount).toString()),
        tokenBalance(signed.transaction, prepared.destinationTokenAccount, prepared.receiptMint, '17'),
      ],
    },
  };
}

test('R1.1 rejects noncanonical amounts and unreviewed reserve identities before RPC', async () => {
  let calls = 0;
  const adapter = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    fetchImpl: async () => { calls += 1; throw new Error('should not call RPC'); },
  });
  await assert.rejects(adapter.prepare({
    wallet,
    action: 'supply',
    reserveAddress: '11111111111111111111111111111111',
    amountBaseUnits: '1000',
    maxFeeLamports: '10000',
    maxEvidenceAgeSeconds: 60,
  }), error => error instanceof SolanaLendingError && error.code === 'INVALID_INPUT');
  await assert.rejects(adapter.prepare({
    wallet,
    action: 'supply',
    reserveAddress: reviewed.reserveAddress,
    amountBaseUnits: '01',
    maxFeeLamports: '10000',
    maxEvidenceAgeSeconds: 60,
  }), error => error instanceof SolanaLendingError && error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('R1.1 builds the SDK reserve-liquidity instruction for the exact wallet, reserve, mint, and amount', async () => {
  const prepared = preparedSupply('1000');
  const instruction = prepared.built.supplyInstruction;
  assert.equal(instruction.programAddress.toString(), PROGRAM_ID.toString());
  assert.equal(Buffer.from(instruction.data).readBigUInt64LE(8), 1000n);
  assert.deepEqual(instruction.accounts.map(meta => meta.address.toString()), [
    wallet,
    reviewed.reserveAddress,
    reviewed.marketAddress,
    marketAuthority,
    USDC_MINT,
    reserveVault,
    receiptMint,
    prepared.sourceTokenAccount,
    prepared.destinationTokenAccount,
    TOKEN_PROGRAM_ADDRESS.toString(),
    TOKEN_PROGRAM_ADDRESS.toString(),
    instructionsSysvar,
  ]);
  const signed = signPrepared(prepared);
  const adapter = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    now: () => new Date(baseTimeMs).toISOString(),
    fetchImpl: jsonRpcFetch(),
  });
  const verified = await adapter.verifySigned({ prepared, signedTransactionBase64: signed.signedTransactionBase64 });
  assert.equal(verified.signature, signed.signature);
  assert.equal(verified.messageSha256, prepared.messageSha256);
});

test('R1.1 rejects a wallet signature over a changed SDK instruction message', async () => {
  const prepared = preparedSupply('1000');
  const changed = signPrepared(preparedSupply('1001'));
  const adapter = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    now: () => new Date(baseTimeMs).toISOString(),
    fetchImpl: jsonRpcFetch(),
  });
  await assert.rejects(adapter.verifySigned({
    prepared,
    signedTransactionBase64: changed.signedTransactionBase64,
  }), error => error instanceof SolanaLendingError && error.code === 'INVALID_SIGNED_TRANSACTION');
});

test('R1.1 reconciles exact finalized owner deltas but leaves stale native cost valuation unavailable', async () => {
  const prepared = preparedSupply('1000', { priceAgeSeconds: 120 });
  const signed = signPrepared(prepared);
  const receipt = successfulSupplyReceipt(signed, prepared);
  const adapter = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    fetchImpl: jsonRpcFetch({ getTransaction: () => receipt }),
  });
  const result = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.amounts.usdcDebitBaseUnits, '1000');
  assert.equal(result.amounts.usdcCreditBaseUnits, '0');
  assert.equal(result.amounts.receiptDebitBaseUnits, '0');
  assert.equal(result.amounts.receiptCreditBaseUnits, '7');
  assert.equal(result.amounts.feeLamports, '5000');
  assert.equal(result.amounts.costUsdcBaseUnits, null);
});

test('R1.1 reports a finalized failed transaction fee without claiming token movement or a stale USD cost', async () => {
  const prepared = preparedSupply('1000', { priceAgeSeconds: 120 });
  const signed = signPrepared(prepared);
  const receipt = successfulSupplyReceipt(signed, prepared);
  receipt.meta.err = { InstructionError: [1, 'Custom'] };
  const adapter = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    fetchImpl: jsonRpcFetch({ getTransaction: () => receipt }),
  });
  const result = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.amounts.usdcDebitBaseUnits, '0');
  assert.equal(result.amounts.usdcCreditBaseUnits, '0');
  assert.equal(result.amounts.receiptDebitBaseUnits, '0');
  assert.equal(result.amounts.receiptCreditBaseUnits, '0');
  assert.equal(result.amounts.feeLamports, '5000');
  assert.equal(result.amounts.costUsdcBaseUnits, null);
});

test('R1.1 refuses to confirm a finalized receipt whose message differs from the prepared action', async () => {
  const prepared = preparedSupply('1000');
  const signed = signPrepared(preparedSupply('1001'));
  const receipt = successfulSupplyReceipt(signed, prepared);
  const adapter = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    fetchImpl: jsonRpcFetch({ getTransaction: () => receipt }),
  });
  const result = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.amounts, null);
  assert.equal(result.reason, 'INVALID_SIGNED_TRANSACTION');
});

test('R1.1 treats absent settlement as pending before expiry and unverified after expiry', async () => {
  const prepared = preparedSupply('1000');
  const signed = signPrepared(prepared);
  const beforeExpiry = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid', fetchImpl: jsonRpcFetch({ getTransaction: () => null, height: 8999 }),
  });
  const pending = await beforeExpiry.reconcile({ prepared, signature: signed.signature });
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.amounts, null);

  const afterExpiry = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid', fetchImpl: jsonRpcFetch({ getTransaction: () => null, height: 9001 }),
  });
  const absent = await afterExpiry.reconcile({ prepared, signature: signed.signature });
  assert.equal(absent.status, 'UNVERIFIED');
  assert.equal(absent.amounts, null);
});

test('R1.1 isExpired uses finalized chain height and does not guess on RPC failure', async () => {
  const prepared = preparedSupply('1000');
  const current = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid', fetchImpl: jsonRpcFetch({ height: 9001 }),
  });
  assert.equal(await current.isExpired({ prepared }), true);

  const unavailable = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  });
  await assert.rejects(unavailable.isExpired({ prepared }), error => error instanceof SolanaLendingError && error.code === 'SOLANA_RPC_UNAVAILABLE');
});

test('V221: finalized token effects cannot hide inconsistent native fee balances', async () => {
  const prepared = preparedSupply('1000');
  const signed = signPrepared(prepared);
  const receipt = successfulSupplyReceipt(signed, prepared);
  receipt.meta.postBalances = [...receipt.meta.preBalances];
  const adapter = createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    fetchImpl: jsonRpcFetch({ getTransaction: () => receipt }),
  });
  const result = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.reason, 'SOLANA_RECEIPT_MISMATCH');
  assert.equal(result.amounts, null);
});
