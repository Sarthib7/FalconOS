import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import BN from 'bn.js';
import { createAccounting, feeOwed } from '../cfo/lending-accounting.mjs';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  LendingMarket,
  PROGRAM_ID,
  depositReserveLiquidity,
  noopSigner,
  refreshReserve,
  Reserve,
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
const require = createRequire(import.meta.url);
const requireKamino = createRequire(require.resolve('@kamino-finance/klend-sdk'));
const kaminoAxios = requireKamino('axios');
const { priceUpdateV2 } = require('@kamino-finance/klend-sdk/dist/@codegen/pyth_rec/accounts/priceUpdateV2.js');

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
const secondReceiptMint = new PublicKey(Uint8Array.from({ length: 32 }, () => 23)).toBase58();
const setupQuoteId = '22222222-2222-4222-8222-222222222222';
const setupRentPerAccount = 2_039_280;
const wrappedSolMint = 'So11111111111111111111111111111111111111112';
const pythReceiverProgram = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ';
const nativePriceReserves = [
  { marketAddress: DEFAULT_LENDING_RESERVES[0].marketAddress, reserveAddress: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q' },
  { marketAddress: DEFAULT_LENDING_RESERVES[1].marketAddress, reserveAddress: 'DmaDuxw9NZMAZhsSrGnYSbd7rg6bvqqx3Y76MTkFubRY' },
];

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

const setupReceiptMints = [receiptMint, secondReceiptMint];
const upgradeableLoader = 'BPFLoaderUpgradeab1e11111111111111111111111';
const bpfLoader = 'BPFLoader2111111111111111111111111111111111';
const nativeLoader = 'NativeLoader1111111111111111111111111111111';
const setupReceiptSlot = 466_900_123;

function rpcAccount(owner, bytes, { executable = false, lamports = 1 } = {}) {
  return {
    owner, executable, lamports, rentEpoch: 0,
    data: [Buffer.from(bytes).toString('base64'), 'base64'],
    space: Buffer.byteLength(bytes),
  };
}

function setupMintAccount(mint, supply = 1_000_000n, decimals = 6) {
  const bytes = Buffer.alloc(82);
  bytes.writeBigUInt64LE(supply, 36);
  bytes[44] = decimals;
  bytes[45] = 1;
  return rpcAccount(TOKEN_PROGRAM_ADDRESS.toString(), bytes);
}

function setupTokenAccount(mint, owner, amount = 0n) {
  const bytes = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(bytes, 0);
  new PublicKey(owner).toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(amount, 64);
  bytes[108] = 1;
  return rpcAccount(TOKEN_PROGRAM_ADDRESS.toString(), bytes, { lamports: setupRentPerAccount });
}

function setupReserveBytes(config, mint, {
  mintDecimals = 6,
  marketPrice = 1n,
  priceTimestamp = baseTimeSeconds - 1,
  oracleAddress = null,
  supplyVault = null,
  totalAvailableAmount = 0n,
} = {}) {
  const zero = Buffer.alloc(Reserve.layout.span + 8);
  Reserve.discriminator.copy(zero);
  const json = Reserve.decode(zero).toJSON();
  json.lendingMarket = config.marketAddress;
  json.liquidity.mintPubkey = mintDecimals === 9 ? wrappedSolMint : USDC_MINT;
  json.liquidity.tokenProgram = TOKEN_PROGRAM_ADDRESS.toString();
  json.liquidity.mintDecimals = String(mintDecimals);
  json.liquidity.marketPriceSf = (BigInt(marketPrice) << 60n).toString();
  json.liquidity.marketPriceLastUpdatedTs = String(priceTimestamp);
  json.liquidity.totalAvailableAmount = totalAvailableAmount.toString();
  if (supplyVault !== null) json.liquidity.supplyVault = supplyVault;
  if (oracleAddress !== null) json.config.tokenInfo.pythConfiguration.price = oracleAddress;
  json.collateral.mintPubkey = mint;
  json.collateral.mintTotalSupply = '1000000';
  json.config.debtTermSeconds = '0';
  json.config.debtMaturityTimestamp = '0';
  const reserve = Reserve.fromJSON(json);
  const bytes = Buffer.alloc(Reserve.layout.span + 8);
  Reserve.discriminator.copy(bytes);
  Reserve.layout.encode(reserve, bytes, 8);
  return bytes;
}

function setupFixture({ nativeLamports = 0n, slot = 466_900_000 } = {}) {
  const accounts = new Map();
  const receiptMints = [...setupReceiptMints];
  const empty = Buffer.alloc(0);
  accounts.set(PROGRAM_ID.toString(), rpcAccount(upgradeableLoader, empty, { executable: true }));
  accounts.set(TOKEN_PROGRAM_ADDRESS.toString(), rpcAccount(upgradeableLoader, empty, { executable: true }));
  accounts.set(ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString(), rpcAccount(bpfLoader, empty, { executable: true }));
  accounts.set('11111111111111111111111111111111', rpcAccount(nativeLoader, empty, { executable: true }));
  for (let index = 0; index < DEFAULT_LENDING_RESERVES.length; index += 1) {
    const config = DEFAULT_LENDING_RESERVES[index];
    const market = Buffer.alloc(LendingMarket.layout.span + 8);
    LendingMarket.discriminator.copy(market);
    accounts.set(config.marketAddress, rpcAccount(PROGRAM_ID.toString(), market));
    accounts.set(config.reserveAddress, rpcAccount(PROGRAM_ID.toString(), setupReserveBytes(config, receiptMints[index])));
    accounts.set(receiptMints[index], setupMintAccount(receiptMints[index]));
  }
  accounts.set(USDC_MINT, setupMintAccount(USDC_MINT));
  const fixture = {
    accounts,
    receiptMints,
    slot,
    responseSlot: slot,
    feeLamports: 5000,
    rentLamports: setupRentPerAccount,
    receipt: null,
    calls: [],
    setWalletLamports(value) {
      if (BigInt(value) === 0n) accounts.delete(wallet);
      else accounts.set(wallet, rpcAccount('11111111111111111111111111111111', empty, { lamports: Number(value) }));
    },
    setTokenAccount(addressValue, mint, owner, amount = 0n) {
      accounts.set(addressValue, setupTokenAccount(mint, owner, amount));
    },
  };
  fixture.setWalletLamports(nativeLamports);
  fixture.fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    fixture.calls.push(request.method);
    let result;
    if (request.method === 'getGenesisHash') result = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    else if (request.method === 'getSlot') result = fixture.slot;
    else if (request.method === 'getAccountInfo') result = { context: { slot: fixture.responseSlot }, value: accounts.get(String(request.params[0])) ?? null };
    else if (request.method === 'getMultipleAccounts') {
      const keys = request.params[0].map(String);
      result = { context: { slot: fixture.responseSlot }, value: keys.map(key => accounts.get(key) ?? null) };
    } else if (request.method === 'getMinimumBalanceForRentExemption') result = fixture.rentLamports;
    else if (request.method === 'getLatestBlockhash') {
      result = { context: { slot: fixture.responseSlot }, value: { blockhash, lastValidBlockHeight: 9000 } };
    } else if (request.method === 'getBlockHeight') result = 8000;
    else if (request.method === 'getBlockTime') result = baseTimeSeconds;
    else if (request.method === 'getFeeForMessage') {
      result = { context: { slot: fixture.responseSlot }, value: fixture.feeLamports };
    } else if (request.method === 'simulateTransaction') {
      const requested = request.params[1]?.accounts?.addresses;
      result = { context: { slot: fixture.responseSlot }, value: { err: null, unitsConsumed: 1200,
        ...(requested ? { accounts: requested.map(value => fixture.simulationAccounts?.get(String(value)) ?? accounts.get(String(value)) ?? null) } : {}) } };
    } else if (request.method === 'getTransaction') result = fixture.receipt;
    else throw new Error(`Unexpected setup RPC method ${request.method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return fixture;
}


function marketAuthorityFor(market) {
  const [authority] = PublicKey.findProgramAddressSync([
    Buffer.from('lma'),
    new PublicKey(market).toBuffer(),
  ], new PublicKey(PROGRAM_ID.toString()));
  return authority.toBase58();
}

function pythUpdateBytes(price, slot) {
  const priceMicros = (price * 1_000_000n).toString();
  const update = priceUpdateV2.fromJSON({
    writeAuthority: '11111111111111111111111111111111',
    verificationLevel: { kind: 'Full' },
    priceMessage: {
      feedId: Array(32).fill(0),
      price: priceMicros,
      conf: '0',
      exponent: -6,
      publishTime: String(baseTimeSeconds - 1),
      prevPublishTime: String(baseTimeSeconds - 1),
      emaPrice: priceMicros,
      emaConf: '0',
    },
    postedSlot: String(slot),
  });
  const buffer = Buffer.alloc(256);
  priceUpdateV2.discriminator.copy(buffer);
  const encodedSize = priceUpdateV2.layout.encode({
    writeAuthority: update.writeAuthority,
    verificationLevel: update.verificationLevel.toEncodable(),
    priceMessage: update.priceMessage.toEncodable(),
    postedSlot: update.postedSlot,
  }, buffer, 8);
  const bytes = Buffer.from(buffer.subarray(0, 8 + encodedSize));
  priceUpdateV2.decode(bytes);
  return bytes;
}

function setupPolicyFixture({ withPriceFeeds = true, totalAvailableAmount = 0n } = {}) {
  const fixture = setupFixture();
  const vaults = [
    reserveVault,
    new PublicKey(Uint8Array.from({ length: 32 }, () => 22)).toBase58(),
  ];
  const definitions = [
    ...DEFAULT_LENDING_RESERVES.map((config, index) => ({
      config, mint: fixture.receiptMints[index], mintDecimals: 6, marketPrice: 1n, supplyVault: vaults[index],
    })),
    ...nativePriceReserves.map(config => ({
      config, mint: wrappedSolMint, mintDecimals: 9, marketPrice: 150n, supplyVault: null,
    })),
  ];
  for (let index = 0; index < definitions.length; index += 1) {
    const item = definitions[index];
    const oracleAddress = new PublicKey(Uint8Array.from(
      { length: 32 }, (_, byte) => 50 + index * 7 + byte % 5,
    )).toBase58();
    const reserve = setupReserveBytes(item.config, item.mint, {
      mintDecimals: item.mintDecimals,
      marketPrice: item.marketPrice,
      priceTimestamp: baseTimeSeconds - 1,
      oracleAddress,
      supplyVault: item.supplyVault,
      totalAvailableAmount,
    });
    fixture.accounts.set(item.config.reserveAddress, rpcAccount(PROGRAM_ID.toString(), reserve));
    if (withPriceFeeds) fixture.accounts.set(oracleAddress, rpcAccount(pythReceiverProgram, pythUpdateBytes(item.marketPrice, fixture.slot)));
    if (item.supplyVault !== null) {
      fixture.accounts.set(item.supplyVault, setupTokenAccount(USDC_MINT, marketAuthorityFor(item.config.marketAddress), totalAvailableAmount));
    }
  }
  fixture.accounts.set(wrappedSolMint, setupMintAccount(wrappedSolMint, 1_000_000n, 9));
  return fixture;
}

async function withKaminoSlotDuration(callback) {
  const originalGet = kaminoAxios.get;
  kaminoAxios.get = async () => ({ data: { recentSlotDurationInMs: 400 } });
  try { return await callback(); }
  finally { kaminoAxios.get = originalGet; }
}

function setupAdapter(fixture) {
  return createSolanaLendingAdapter({
    rpcUrl: 'https://rpc.invalid',
    now: () => new Date(baseTimeMs).toISOString(),
    fetchImpl: fixture.fetchImpl,
  });
}

async function quoteAndPrepareSetup(fixture, { nativeLamports = 10_000_000n } = {}) {
  const adapter = setupAdapter(fixture);
  const quoted = await adapter.quoteAccountSetup({ wallet });
  const quote = { ...quoted, quoteId: setupQuoteId };
  if (nativeLamports !== null) fixture.setWalletLamports(nativeLamports);
  const prepared = await adapter.prepareAccountSetup({ wallet, quote });
  return { adapter, quote, prepared };
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

function successfulSetupReceipt(signed, prepared, { fee = 5000, existingAccounts = [], slot = setupReceiptSlot } = {}) {
  const keys = signed.transaction.message.staticAccountKeys;
  const walletIndex = keys.findIndex(key => key.toBase58() === wallet);
  const perAccountRent = BigInt(prepared.costEvidence.rentPerAccountLamports);
  const chargedRent = perAccountRent * BigInt(prepared.accountSetup.accounts.filter(item => item.wasMissing && !existingAccounts.includes(item.address)).length);
  const setupAddresses = new Set(prepared.accountSetup.accounts.filter(item => item.wasMissing).map(item => item.address));
  const preBalances = keys.map((key, index) => {
    const addressValue = key.toBase58();
    if (index === walletIndex) return 50_000_000;
    return existingAccounts.includes(addressValue) ? Number(perAccountRent) : 0;
  });
  const postBalances = keys.map((key, index) => {
    const addressValue = key.toBase58();
    if (index === walletIndex) return 50_000_000 - fee - Number(chargedRent);
    return setupAddresses.has(addressValue) ? Number(perAccountRent) : 0;
  });
  const preTokenBalances = [];
  const postTokenBalances = [];
  for (const account of prepared.accountSetup.accounts) {
    const existedBefore = existingAccounts.includes(account.address);
    if (existedBefore) preTokenBalances.push(tokenBalance(signed.transaction, account.address, account.mint, '17'));
    postTokenBalances.push(tokenBalance(signed.transaction, account.address, account.mint, existedBefore ? '17' : '0'));
  }
  return {
    slot, blockTime: baseTimeSeconds + 1, version: 0,
    transaction: [signed.signedTransactionBase64, 'base64'],
    meta: {
      err: null, fee, preBalances, postBalances, preTokenBalances, postTokenBalances,
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
test('V227: setup quote proves three canonical missing ATAs before SOL funding and separates native from USD cost', async () => {
  const fixture = setupFixture();
  const adapter = setupAdapter(fixture);
  const quote = await adapter.quoteAccountSetup({ wallet });
  const expectedMints = [USDC_MINT, ...setupReceiptMints];
  assert.equal(quote.status, 'QUOTED');
  assert.equal(quote.wallet, wallet);
  assert.equal(quote.chain, 'solana');
  assert.equal(quote.network, 'mainnet-beta');
  assert.equal(quote.nativeBalanceLamports, '0');
  assert.equal(quote.accounts.length, 3);
  assert.deepEqual(quote.accounts.map(item => [
    item.address, item.mint, item.owner, item.tokenProgram, item.exists, item.balanceBaseUnits,
  ]), expectedMints.map(mint => [
    ata(wallet, mint), mint, wallet, TOKEN_PROGRAM_ADDRESS.toString(), false, '0',
  ]));
  assert.equal(quote.feeLamports, '5000');
  assert.equal(quote.maxFeeLamports, quote.feeLamports);
  assert.equal(quote.rentLamports, String(setupRentPerAccount * 3));
  assert.equal(quote.maxTotalCostUsdcBaseUnits, null);
  assert.equal(quote.costEvidence.nativePriceUsdMicros, null);
  assert.equal(quote.costEvidence.usdcPriceUsdMicros, null);
  assert.equal(quote.costEvidence.walletLamports, '0');
  assert.deepEqual(quote.reasons, []);
  assert.ok(fixture.calls.includes('getFeeForMessage'));
});

test('V227: RPC-proven ATA absence is zero but malformed or wrong-owner accounts are NO_DATA', async () => {
  const otherWallet = Keypair.generate().publicKey.toBase58();
  const wrongOwnerFixture = setupFixture();
  wrongOwnerFixture.setTokenAccount(ata(wallet, USDC_MINT), USDC_MINT, otherWallet, 7n);
  const wrongOwnerQuote = await setupAdapter(wrongOwnerFixture).quoteAccountSetup({ wallet });
  assert.equal(wrongOwnerQuote.status, 'NO_DATA');
  assert.ok(wrongOwnerQuote.reasons.includes('SOLANA_IDENTITY_MISMATCH'));

  const malformedFixture = setupFixture();
  malformedFixture.accounts.set(
    ata(wallet, USDC_MINT),
    rpcAccount('11111111111111111111111111111111', Buffer.alloc(165)),
  );
  const malformedQuote = await setupAdapter(malformedFixture).quoteAccountSetup({ wallet });
  assert.equal(malformedQuote.status, 'NO_DATA');
  assert.ok(malformedQuote.reasons.includes('SOLANA_DATA_INVALID'));
});

test('V228: setup prepares only pinned SDK idempotent ATA creates and permits SOL funding after quote', async () => {
  const fixture = setupFixture();
  const { adapter, quote, prepared } = await quoteAndPrepareSetup(fixture);
  assert.equal(quote.nativeBalanceLamports, '0');
  assert.equal(prepared.action, 'setup');
  assert.equal(prepared.reserveAddress, null);
  assert.equal(prepared.amountBaseUnits, '0');
  assert.equal(prepared.amountUnit, 'usdc-base-units');
  assert.equal(prepared.recipient, wallet);
  assert.equal(prepared.feeLamports, '5000');
  assert.equal(prepared.rentLamports, String(setupRentPerAccount * 3));
  assert.equal(prepared.maxTotalCostUsdcBaseUnits, null);
  assert.deepEqual(prepared.expectedEffects, {
    usdcDebitBaseUnits: '0', usdcCreditBaseUnits: '0', receiptDebitBaseUnits: '0', receiptCreditBaseUnits: '0',
  });
  assert.equal(prepared.accountSetup.quoteId, setupQuoteId);
  assert.deepEqual(prepared.accountSetup.accounts.map(item => item.wasMissing), [true, true, true]);
  assert.deepEqual(prepared.accountSetup.accounts.map(item => item.address), [USDC_MINT, ...setupReceiptMints].map(mint => ata(wallet, mint)));

  const transaction = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, 'base64'));
  assert.equal(transaction.message.compiledInstructions.length, 3);
  for (let index = 0; index < transaction.message.compiledInstructions.length; index += 1) {
    const instruction = transaction.message.compiledInstructions[index];
    const mint = [USDC_MINT, ...setupReceiptMints][index];
    const accounts = instruction.accountKeyIndexes.map(keyIndex => transaction.message.staticAccountKeys[keyIndex].toBase58());
    assert.equal(transaction.message.staticAccountKeys[instruction.programIdIndex].toBase58(), ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString());
    assert.deepEqual([...instruction.data], [1]);
    assert.deepEqual(accounts, [
      wallet, ata(wallet, mint), wallet, mint, '11111111111111111111111111111111', TOKEN_PROGRAM_ADDRESS.toString(),
    ]);
  }
  const signed = signPrepared(prepared);
  const verified = await adapter.verifySigned({ prepared, signedTransactionBase64: signed.signedTransactionBase64 });
  assert.equal(verified.signature, signed.signature);
  assert.equal(verified.messageSha256, prepared.messageSha256);
});

test('V228: stale account evidence, wrong quote ownership, insufficient SOL, and ready accounts fail closed', async () => {
  const expiredFixture = setupFixture();
  const expiredAdapter = setupAdapter(expiredFixture);
  const expiredQuote = { ...(await expiredAdapter.quoteAccountSetup({ wallet })), quoteId: setupQuoteId };
  expiredFixture.setWalletLamports(10_000_000n);
  await assert.rejects(expiredAdapter.prepareAccountSetup({
    wallet, quote: { ...expiredQuote, expiresAt: new Date(baseTimeMs - 1000).toISOString() },
  }), error => error instanceof SolanaLendingError && error.code === 'SOLANA_SETUP_QUOTE_STALE');

  const changedFixture = setupFixture();
  const changedAdapter = setupAdapter(changedFixture);
  const changedQuote = { ...(await changedAdapter.quoteAccountSetup({ wallet })), quoteId: setupQuoteId };
  changedFixture.setWalletLamports(10_000_000n);
  changedFixture.setTokenAccount(ata(wallet, USDC_MINT), USDC_MINT, wallet, 0n);
  await assert.rejects(changedAdapter.prepareAccountSetup({ wallet, quote: changedQuote }),
    error => error instanceof SolanaLendingError && error.code === 'SOLANA_SETUP_QUOTE_STALE');

  const mismatchFixture = setupFixture();
  const mismatchAdapter = setupAdapter(mismatchFixture);
  const mismatchQuote = { ...(await mismatchAdapter.quoteAccountSetup({ wallet })), quoteId: setupQuoteId };
  mismatchFixture.setWalletLamports(10_000_000n);
  const wrongOwnerQuote = structuredClone(mismatchQuote);
  wrongOwnerQuote.accounts[0].owner = Keypair.generate().publicKey.toBase58();
  await assert.rejects(mismatchAdapter.prepareAccountSetup({ wallet, quote: wrongOwnerQuote }),
    error => error instanceof SolanaLendingError && error.code === 'SOLANA_SETUP_QUOTE_STALE');
  const wrongMintQuote = structuredClone(mismatchQuote);
  wrongMintQuote.accounts[1].mint = secondReceiptMint;
  await assert.rejects(mismatchAdapter.prepareAccountSetup({ wallet, quote: wrongMintQuote }),
    error => error instanceof SolanaLendingError && error.code === 'SOLANA_SETUP_QUOTE_STALE');

  const unfundedFixture = setupFixture();
  const unfundedAdapter = setupAdapter(unfundedFixture);
  const unfundedQuote = { ...(await unfundedAdapter.quoteAccountSetup({ wallet })), quoteId: setupQuoteId };
  await assert.rejects(unfundedAdapter.prepareAccountSetup({ wallet, quote: unfundedQuote }),
    error => error instanceof SolanaLendingError && error.code === 'SOLANA_INSUFFICIENT_SOL');

  const readyFixture = setupFixture();
  for (const mint of [USDC_MINT, ...setupReceiptMints]) {
    readyFixture.setTokenAccount(ata(wallet, mint), mint, wallet, 0n);
  }
  const readyAdapter = setupAdapter(readyFixture);
  const readyQuote = await readyAdapter.quoteAccountSetup({ wallet });
  assert.equal(readyQuote.status, 'READY');
  await assert.rejects(readyAdapter.prepareAccountSetup({ wallet, quote: readyQuote }),
    error => error instanceof SolanaLendingError && error.code === 'SOLANA_SETUP_ALREADY_READY');
});

test('V228: owner verification rejects setup messages or account proofs changed after preparation', async () => {
  const fixture = setupFixture();
  const { adapter, prepared } = await quoteAndPrepareSetup(fixture);
  const signed = signPrepared(prepared);
  const wrongOwner = structuredClone(prepared);
  wrongOwner.wallet = Keypair.generate().publicKey.toBase58();
  await assert.rejects(adapter.verifySigned({ prepared: wrongOwner, signedTransactionBase64: signed.signedTransactionBase64 }),
    error => error instanceof SolanaLendingError && error.code === 'INVALID_SIGNED_TRANSACTION');

  const wrongAccount = structuredClone(prepared);
  const alternateMint = new PublicKey(Uint8Array.from({ length: 32 }, () => 41)).toBase58();
  wrongAccount.accountSetup.accounts[1].mint = alternateMint;
  wrongAccount.accountSetup.accounts[1].address = ata(wallet, alternateMint);
  await assert.rejects(adapter.verifySigned({ prepared: wrongAccount, signedTransactionBase64: signed.signedTransactionBase64 }),
    error => error instanceof SolanaLendingError && error.code === 'INVALID_PREPARED_ACTION');

  const changedSupply = buildUnsignedSupply('1000');
  const wrongMessage = {
    ...prepared,
    transactionBase64: changedSupply.transactionBase64,
    messageSha256: changedSupply.messageSha256,
  };
  const supplySignature = signPrepared(wrongMessage);
  await assert.rejects(adapter.verifySigned({
    prepared: wrongMessage, signedTransactionBase64: supplySignature.signedTransactionBase64,
  }), error => error instanceof SolanaLendingError && error.code === 'INVALID_PREPARED_ACTION');
});

test('V228: finalized setup proves zero transaction-local principal and actual fee plus reduced rent', async () => {
  const fixture = setupFixture();
  const { adapter, prepared } = await quoteAndPrepareSetup(fixture);
  const signed = signPrepared(prepared);
  const [createdElsewhere, ...createdByTransaction] = prepared.accountSetup.accounts;
  fixture.setTokenAccount(createdElsewhere.address, createdElsewhere.mint, wallet, 17n);
  const verified = await adapter.verifySigned({ prepared, signedTransactionBase64: signed.signedTransactionBase64 });
  assert.equal(verified.signature, signed.signature);
  for (const account of createdByTransaction) fixture.setTokenAccount(account.address, account.mint, wallet, 0n);
  const receipt = successfulSetupReceipt(signed, prepared, { existingAccounts: [createdElsewhere.address] });
  fixture.receipt = receipt;
  fixture.responseSlot = receipt.slot + 1;
  fixture.setTokenAccount(createdElsewhere.address, createdElsewhere.mint, wallet, 900n);
  fixture.setTokenAccount(createdByTransaction[0].address, createdByTransaction[0].mint, wallet, 3n);
  fixture.setTokenAccount(createdByTransaction[1].address, createdByTransaction[1].mint, wallet, 4n);

  const result = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.accountSetup.quoteId, setupQuoteId);
  assert.equal(result.accountSetup.slot, receipt.slot + 1);
  assert.equal(result.accountSetup.observedAt, new Date(baseTimeMs).toISOString());
  assert.deepEqual(result.accountSetup.accounts.map(item => [
    item.address, item.mint, item.owner, item.tokenProgram, item.exists, item.balanceBaseUnits,
  ]), [
    [createdElsewhere.address, createdElsewhere.mint, wallet, TOKEN_PROGRAM_ADDRESS.toString(), true, '900'],
    [createdByTransaction[0].address, createdByTransaction[0].mint, wallet, TOKEN_PROGRAM_ADDRESS.toString(), true, '3'],
    [createdByTransaction[1].address, createdByTransaction[1].mint, wallet, TOKEN_PROGRAM_ADDRESS.toString(), true, '4'],
  ]);
  assert.deepEqual({
    usdcDebitBaseUnits: result.amounts.usdcDebitBaseUnits,
    usdcCreditBaseUnits: result.amounts.usdcCreditBaseUnits,
    receiptDebitBaseUnits: result.amounts.receiptDebitBaseUnits,
    receiptCreditBaseUnits: result.amounts.receiptCreditBaseUnits,
  }, {
    usdcDebitBaseUnits: '0', usdcCreditBaseUnits: '0', receiptDebitBaseUnits: '0', receiptCreditBaseUnits: '0',
  });
  assert.equal(result.amounts.feeLamports, '5000');
  assert.equal(result.amounts.rentLamports, String(setupRentPerAccount * 2));
  assert.equal(result.amounts.costUsdcBaseUnits, null);
});

test('V228: stale post-receipt context and invalid canonical post-accounts stay unverified', async () => {
  const staleFixture = setupFixture();
  const stale = await quoteAndPrepareSetup(staleFixture);
  const staleSigned = signPrepared(stale.prepared);
  for (const item of stale.prepared.accountSetup.accounts) staleFixture.setTokenAccount(item.address, item.mint, wallet, 0n);
  staleFixture.receipt = successfulSetupReceipt(staleSigned, stale.prepared);
  staleFixture.responseSlot = staleFixture.receipt.slot - 1;
  const staleResult = await stale.adapter.reconcile({ prepared: stale.prepared, signature: staleSigned.signature });
  assert.equal(staleResult.status, 'UNVERIFIED');
  assert.equal(staleResult.reason, 'SOLANA_DATA_INVALID');
  assert.equal(staleResult.amounts, null);

  const invalidFixture = setupFixture();
  const invalid = await quoteAndPrepareSetup(invalidFixture);
  const invalidSigned = signPrepared(invalid.prepared);
  const [usdcAccount, ...receiptAccounts] = invalid.prepared.accountSetup.accounts;
  invalidFixture.setTokenAccount(usdcAccount.address, secondReceiptMint, wallet, 0n);
  for (const item of receiptAccounts) invalidFixture.setTokenAccount(item.address, item.mint, wallet, 0n);
  invalidFixture.receipt = successfulSetupReceipt(invalidSigned, invalid.prepared);
  invalidFixture.responseSlot = invalidFixture.receipt.slot + 1;
  const invalidResult = await invalid.adapter.reconcile({ prepared: invalid.prepared, signature: invalidSigned.signature });
  assert.equal(invalidResult.status, 'UNVERIFIED');
  assert.equal(invalidResult.reason, 'SOLANA_IDENTITY_MISMATCH');
  assert.equal(invalidResult.amounts, null);
});

test('V227: capture readiness survives unavailable price evidence but invalid ATA identity stays unknown', async () => {
  const absentFixture = setupPolicyFixture({ withPriceFeeds: false });
  const absent = await withKaminoSlotDuration(() => setupAdapter(absentFixture).capture({ wallet }));
  assert.equal(absent.status, 'NO_DATA');
  assert.equal(absent.accountSetupReady, false);
  assert.equal(absent.accountSetupObservedAt, new Date(baseTimeMs).toISOString());
  assert.equal(absent.accountSetupSlot, absentFixture.slot);
  assert.equal(absent.cashBaseUnits, null);

  const readyFixture = setupPolicyFixture({ withPriceFeeds: false });
  for (const mint of [USDC_MINT, ...setupReceiptMints]) {
    readyFixture.setTokenAccount(ata(wallet, mint), mint, wallet, 0n);
  }
  const ready = await withKaminoSlotDuration(() => setupAdapter(readyFixture).capture({ wallet }));
  assert.equal(ready.status, 'NO_DATA');
  assert.equal(ready.accountSetupReady, true);
  assert.equal(ready.accountSetupSlot, readyFixture.slot);

  const wrongOwnerFixture = setupPolicyFixture({ withPriceFeeds: false });
  wrongOwnerFixture.setTokenAccount(ata(wallet, USDC_MINT), USDC_MINT, Keypair.generate().publicKey.toBase58(), 1n);
  const wrongOwner = await withKaminoSlotDuration(() => setupAdapter(wrongOwnerFixture).capture({ wallet }));
  assert.equal(wrongOwner.status, 'NO_DATA');
  assert.equal(wrongOwner.accountSetupReady, null);
  assert.equal(wrongOwner.accountSetupObservedAt, null);
  assert.equal(wrongOwner.cashBaseUnits, null);
});

test('V228: delegated policy stays six Kamino-only rules and admits no setup-shaped scope', async () => {
  const fixture = setupPolicyFixture();
  const adapter = setupAdapter(fixture);
  const mandate = {
    action: 'setup',
    reserves: DEFAULT_LENDING_RESERVES.map(item => item.reserveAddress),
    maxActionBaseUnits: '1000',
    maxFeeLamports: '10000',
    expiresAt: new Date(baseTimeMs + 120_000).toISOString(),
  };
  const rules = await withKaminoSlotDuration(() => adapter.policyRules({ wallet, mandate }));
  assert.equal(rules.length, 6);
  const programIds = rules.map(rule => rule.conditions.find(condition =>
    condition.field_source === 'solana_program_instruction' && condition.field === 'programId')?.value);
  assert.deepEqual(programIds, Array(6).fill(PROGRAM_ID.toString()));
  const instructionNames = rules.map(rule => rule.conditions.find(condition =>
    condition.field_source === 'solana_instruction_data' && condition.field === 'instruction_name')?.value).sort();
  assert.deepEqual(instructionNames, [
    'depositReserveLiquidity', 'depositReserveLiquidity',
    'redeemReserveCollateral', 'redeemReserveCollateral',
    'refreshReserve', 'refreshReserve',
  ]);
  assert.ok(!programIds.includes(ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString()));
  assert.ok(!programIds.includes('11111111111111111111111111111111'));
  assert.ok(!programIds.includes(TOKEN_PROGRAM_ADDRESS.toString()));

  const callsAfterValidPolicy = fixture.calls.length;
  await assert.rejects(adapter.policyRules({
    wallet, mandate: { action: 'setup', maxFeeLamports: '5000' },
  }), error => error instanceof SolanaLendingError && error.code === 'INVALID_POLICY');
  assert.equal(fixture.calls.length, callsAfterValidPolicy);
  const noSetupFixture = setupFixture();
  await assert.rejects(setupAdapter(noSetupFixture).prepare({
    wallet, action: 'setup', reserveAddress: reviewed.reserveAddress,
    amountBaseUnits: '0', maxFeeLamports: '5000', maxEvidenceAgeSeconds: 60,
  }), error => error instanceof SolanaLendingError && error.code === 'INVALID_INPUT');
  assert.deepEqual(noSetupFixture.calls, []);
});

test('V219/V221: full SDK snapshot prepares and verifies direct liquidity without creating an obligation', async () => {
  const fixture = setupPolicyFixture({ totalAvailableAmount: 1_000_000n });
  fixture.setWalletLamports(50_000_000n);
  fixture.setTokenAccount(ata(wallet, USDC_MINT), USDC_MINT, wallet, 1_000_000n);
  for (const mint of fixture.receiptMints) fixture.setTokenAccount(ata(wallet, mint), mint, wallet, 200_000n);
  const adapter = setupAdapter(fixture);
  await withKaminoSlotDuration(async () => {
    fixture.simulationAccounts = new Map([
      [ata(wallet, USDC_MINT), setupTokenAccount(USDC_MINT, wallet, 900_000n)],
      [ata(wallet, fixture.receiptMints[0]), setupTokenAccount(fixture.receiptMints[0], wallet, 300_000n)],
    ]);
    const supply = await adapter.prepare({ wallet, action: 'supply', reserveAddress: reviewed.reserveAddress,
      amountBaseUnits: '100000', maxFeeLamports: '10000', maxEvidenceAgeSeconds: 300 });
    assert.equal(supply.expectedEffects.usdcDebitBaseUnits, '100000');
    assert.equal(supply.expectedEffects.receiptCreditBaseUnits, '100000');
    const supplySigned = signPrepared(supply);
    assert.equal((await adapter.verifySigned({ prepared: supply, signedTransactionBase64: supplySigned.signedTransactionBase64 })).signature, supplySigned.signature);
    fixture.simulationAccounts = new Map([
      [ata(wallet, fixture.receiptMints[0]), setupTokenAccount(fixture.receiptMints[0], wallet, 100_000n)],
      [ata(wallet, USDC_MINT), setupTokenAccount(USDC_MINT, wallet, 1_100_000n)],
    ]);
    const redeem = await adapter.prepare({ wallet, action: 'redeem', reserveAddress: reviewed.reserveAddress,
      amountBaseUnits: '100000', maxFeeLamports: '10000', maxEvidenceAgeSeconds: 300 });
    assert.equal(redeem.expectedEffects.receiptDebitBaseUnits, '100000');
    assert.equal(redeem.expectedEffects.usdcCreditBaseUnits, '100000');
    const redeemSigned = signPrepared(redeem);
    assert.equal((await adapter.verifySigned({ prepared: redeem, signedTransactionBase64: redeemSigned.signedTransactionBase64 })).signature, redeemSigned.signature);
    fixture.simulationAccounts = new Map([
      [ata(wallet, USDC_MINT), setupTokenAccount(USDC_MINT, wallet, 900_001n)],
      [ata(wallet, fixture.receiptMints[0]), setupTokenAccount(fixture.receiptMints[0], wallet, 300_000n)],
    ]);
    await assert.rejects(adapter.prepare({ wallet, action: 'supply', reserveAddress: reviewed.reserveAddress,
      amountBaseUnits: '100000', maxFeeLamports: '10000', maxEvidenceAgeSeconds: 300 }),
    error => error instanceof SolanaLendingError && error.code === 'SOLANA_SIMULATION_MISMATCH');
    fixture.setTokenAccount(ata(wallet, USDC_MINT), USDC_MINT, wallet, 0n);
    await assert.rejects(adapter.prepare({ wallet, action: 'supply', reserveAddress: reviewed.reserveAddress,
      amountBaseUnits: '1', maxFeeLamports: '10000', maxEvidenceAgeSeconds: 300 }),
    error => error instanceof SolanaLendingError && error.code === 'SOLANA_INSUFFICIENT_USDC');
  });
});

test('V223: a full SDK capture enrolls observed principal without treating redeemability advice as a missing valuation', async () => {
  const fixture = setupPolicyFixture({ totalAvailableAmount: 1_000_000n });
  fixture.setWalletLamports(50_000_000n);
  fixture.setTokenAccount(ata(wallet, USDC_MINT), USDC_MINT, wallet, 1_000_000n);
  for (const mint of fixture.receiptMints) fixture.setTokenAccount(ata(wallet, mint), mint, wallet, 200_000n);
  const portfolio = await withKaminoSlotDuration(() => setupAdapter(fixture).capture({ wallet }));
  assert.equal(portfolio.status, 'OBSERVED', JSON.stringify(portfolio.issues));
  const terms = { feeBps: 1000, feeRecipient: Keypair.generate().publicKey.toBase58() };
  const state = createAccounting({ portfolio, ...terms });
  assert.equal(state.enrollmentCapitalBaseUnits, '1400000');
  assert.equal(feeOwed(state), '0');
  assert.ok(portfolio.warnings.some(warning => warning.includes('SIMULATION_REQUIRED')));
  const contradictory = createAccounting({ portfolio: { ...portfolio, issues: ['CONTRADICTORY_OBSERVATION'] }, ...terms });
  assert.equal(feeOwed(contradictory), null);
  const missingValue = createAccounting({ portfolio: { ...portfolio,
    positions: portfolio.positions.map((position, index) => index === 0 ? { ...position, usdcValueBaseUnits: null } : position),
  }, ...terms });
  assert.equal(feeOwed(missingValue), null);
});

test('V228/V229 failed setup retains only the exact bounded network fee and rejects contradictory native effects', async () => {
  const fixture = setupFixture();
  const { adapter, prepared } = await quoteAndPrepareSetup(fixture);
  const signed = signPrepared(prepared);
  const receipt = successfulSetupReceipt(signed, prepared);
  receipt.meta.err = { InstructionError: [0, { Custom: 1 }] };
  receipt.meta.postBalances = [...receipt.meta.preBalances];
  receipt.meta.postBalances[0] -= 5000;
  receipt.meta.postTokenBalances = [];
  fixture.receipt = receipt;
  const failed = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(failed.status, 'FAILED');
  assert.deepEqual(failed.amounts, {
    usdcDebitBaseUnits: '0', usdcCreditBaseUnits: '0', receiptDebitBaseUnits: '0', receiptCreditBaseUnits: '0',
    feeLamports: '5000', rentLamports: '0', costUsdcBaseUnits: null,
  });
  assert.equal(failed.accountSetup, undefined);
  receipt.meta.fee = 5001;
  receipt.meta.postBalances[0] = receipt.meta.preBalances[0] - 5001;
  const overCap = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(overCap.status, 'UNVERIFIED');
  assert.equal(overCap.amounts, null);
  receipt.meta.fee = 5000;
  receipt.meta.postBalances[0] = receipt.meta.preBalances[0] - 4999;
  const contradictory = await adapter.reconcile({ prepared, signature: signed.signature });
  assert.equal(contradictory.status, 'UNVERIFIED');
  assert.equal(contradictory.amounts, null);
});

test('V219/V228 a contradictory reserve vault cannot produce a policy or a valued portfolio', async () => {
  const fixture = setupPolicyFixture({ totalAvailableAmount: 1_000_000n });
  fixture.accounts.set(reserveVault, setupTokenAccount(USDC_MINT, marketAuthorityFor(reviewed.marketAddress), 999_999n));
  const adapter = setupAdapter(fixture);
  await withKaminoSlotDuration(() => assert.rejects(adapter.policyRules({ wallet, mandate: {
    reserves: DEFAULT_LENDING_RESERVES.map(item => item.reserveAddress), maxActionBaseUnits: '1000',
    maxFeeLamports: '10000', expiresAt: new Date(baseTimeMs + 120_000).toISOString(),
  } }), error => error instanceof SolanaLendingError && error.code === 'SOLANA_STATE_CHANGED'));
  const observed = await withKaminoSlotDuration(() => adapter.capture({ wallet }));
  assert.equal(observed.status, 'NO_DATA');
  assert.equal(observed.cashBaseUnits, null);
  assert.ok(observed.issues.includes('SOLANA_STATE_CHANGED'));
});
