import { createHash, createPublicKey, verify } from 'node:crypto';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  getTransferCheckedInstruction,
} from '@solana-program/token';
import {
  PROGRAM_ID,
  KaminoAction,
  KaminoMarket,
  KaminoReserve,
  LendingMarket,
  PermissionedOp,
  Reserve,
  VanillaObligation,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  getMedianSlotDurationInMsFromLastEpochs,
  getTokenOracleDataSync,
  isNotNullPubkey,
  noopSigner,
  refreshReserve,
  resolveLedgerInstantForSlot,
} from '@kamino-finance/klend-sdk';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  none,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  some,
} from '@solana/kit';

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const DEFAULT_LENDING_RESERVES = Object.freeze([
  Object.freeze({ reserveAddress: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', marketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF', mint: USDC_MINT, symbol: 'USDC', decimals: 6 }),
  Object.freeze({ reserveAddress: 'Ga4rZytCpq1unD4DbEJ5bkHeUz9g3oh9AAFEi6vSauXp', marketAddress: 'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek', mint: USDC_MINT, symbol: 'USDC', decimals: 6 }),
]);

const ADAPTER_VERSION = 'kamino-mainnet-lending/1';
const NETWORK = 'mainnet-beta';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MAINNET_KLEND_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
// Verified current float-rate SOL reserves in the two reviewed USDC markets; these provide USD valuation.
const NATIVE_PRICE_RESERVES = Object.freeze([
  Object.freeze({ marketAddress: DEFAULT_LENDING_RESERVES[0].marketAddress, reserveAddress: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q' }),
  Object.freeze({ marketAddress: DEFAULT_LENDING_RESERVES[1].marketAddress, reserveAddress: 'DmaDuxw9NZMAZhsSrGnYSbd7rg6bvqqx3Y76MTkFubRY' }),
]);
const PYTH_RECEIVER_PROGRAM = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ';
const SWITCHBOARD_PROGRAM = 'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f';
const SCOPE_PROGRAM = 'HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ';
const U64_MAX = (1n << 64n) - 1n;
const FIXED_POINT_ONE = 1n << 60n;
const MAX_RPC_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TRANSACTION_BYTES = 1232;
const RPC_TIMEOUT_MS = 10_000;
const TOKEN_ACCOUNT_SIZE = 165;
const TOKEN_MINT_SIZE = 82;
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const BPF_LOADER = 'BPFLoader2111111111111111111111111111111111';
const NATIVE_LOADER = 'NativeLoader1111111111111111111111111111111';
const COST_PRICE_MAX_AGE_SECONDS = 60;
const COST_DENOMINATOR = 1000n;
const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const CANONICAL_U64_RE = /^(0|[1-9][0-9]{0,19})$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export class SolanaLendingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SolanaLendingError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new SolanaLendingError(code, message);
}

function normalizeError(error, fallbackCode = 'SOLANA_DATA_UNAVAILABLE') {
  if (error instanceof SolanaLendingError) return error;
  return new SolanaLendingError(fallbackCode, 'Solana lending evidence is unavailable or invalid.');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isoNow(now) {
  const value = now();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('INVALID_CLOCK', 'The lending adapter clock must return canonical ISO timestamps.');
  }
  return value;
}

function canonicalAddress(value, label = 'address') {
  if (typeof value !== 'string' || !BASE58_ADDRESS_RE.test(value)) fail('INVALID_INPUT', `${label} is invalid.`);
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) fail('INVALID_INPUT', `${label} is not canonical.`);
    return value;
  } catch {
    fail('INVALID_INPUT', `${label} is invalid.`);
  }
}

function walletAddress(value) {
  const wallet = canonicalAddress(value, 'Wallet');
  if (!PublicKey.isOnCurve(new PublicKey(wallet).toBytes())) fail('INVALID_INPUT', 'Wallet must be an Ed25519 signer address.');
  return wallet;
}

function canonicalAmount(value, label, { positive = false, maximum = U64_MAX } = {}) {
  if (typeof value !== 'string' || !CANONICAL_U64_RE.test(value)) fail('INVALID_INPUT', `${label} must be a canonical unsigned integer string.`);
  const amount = BigInt(value);
  if ((positive && amount === 0n) || amount > maximum) fail('INVALID_INPUT', `${label} is outside the supported range.`);
  return amount;
}

function safeInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('SOLANA_DATA_INVALID', `${label} is invalid.`);
  return value;
}

function asBigInt(value, label, { minimum = 0n } = {}) {
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('SOLANA_DATA_INVALID', `${label} is not an exact integer.`);
    const result = typeof value === 'bigint' ? value : BigInt(value);
    if (result < minimum) fail('SOLANA_DATA_INVALID', `${label} is invalid.`);
    return result;
  } catch {
    fail('SOLANA_DATA_INVALID', `${label} is invalid.`);
  }
}

function asSlot(value) {
  const slot = asBigInt(value, 'RPC context slot', { minimum: 1n });
  if (slot > BigInt(Number.MAX_SAFE_INTEGER)) fail('SOLANA_DATA_INVALID', 'RPC context slot exceeds the safe range.');
  return Number(slot);
}

function decodeBase64(value, maximumBytes = MAX_RPC_BODY_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximumBytes / 3) * 4) fail('SOLANA_DATA_INVALID', 'Base64 data is invalid.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximumBytes || bytes.toString('base64') !== value) fail('SOLANA_DATA_INVALID', 'Base64 data is invalid.');
  return bytes;
}

async function boundedBody(response) {
  if (!response?.body?.getReader) {
    if (typeof response?.arrayBuffer !== 'function') fail('SOLANA_RPC_UNAVAILABLE', 'RPC response body is unavailable.');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_RPC_BODY_BYTES) fail('SOLANA_RPC_UNAVAILABLE', 'RPC response exceeds its size limit.');
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RPC_BODY_BYTES) {
        await reader.cancel();
        fail('SOLANA_RPC_UNAVAILABLE', 'RPC response exceeds its size limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, size);
}

function validateRpcEnvelope(requestPayload, responsePayload) {
  const requests = Array.isArray(requestPayload) ? requestPayload : [requestPayload];
  const responses = Array.isArray(responsePayload) ? responsePayload : [responsePayload];
  if (Array.isArray(requestPayload) !== Array.isArray(responsePayload) || requests.length !== responses.length) {
    fail('SOLANA_RPC_UNAVAILABLE', 'RPC returned an invalid response envelope.');
  }
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    const response = responses[index];
    if (!request || !response || response.jsonrpc !== '2.0' || response.id !== request.id
        || (Object.hasOwn(response, 'result') === Object.hasOwn(response, 'error'))) {
      fail('SOLANA_RPC_UNAVAILABLE', 'RPC returned an invalid response envelope.');
    }
  }
  return responsePayload;
}

function makeRpc(rpcUrl, fetchImpl) {
  return createSolanaRpcFromTransport(async ({ payload, signal }) => {
    let body;
    try { body = JSON.stringify(payload); }
    catch { fail('SOLANA_RPC_UNAVAILABLE', 'RPC request could not be encoded.'); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetchImpl(rpcUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, redirect: 'error', signal: controller.signal,
      });
      if (!response?.ok || response.redirected) fail('SOLANA_RPC_UNAVAILABLE', 'Mainnet RPC request failed.');
      const raw = await boundedBody(response);
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
      catch { fail('SOLANA_RPC_UNAVAILABLE', 'Mainnet RPC returned invalid JSON.'); }
      return validateRpcEnvelope(payload, parsed);
    } catch (error) {
      if (error instanceof SolanaLendingError) throw error;
      throw new SolanaLendingError('SOLANA_RPC_UNAVAILABLE', 'Mainnet RPC evidence is unavailable.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  });
}

function readAccountBytes(account, owner, expectedSize = null) {
  if (!account || account.owner !== owner || account.executable !== false
      || !Array.isArray(account.data) || account.data.length !== 2 || account.data[1] !== 'base64') {
    fail('SOLANA_DATA_INVALID', 'An on-chain account has an unexpected owner or encoding.');
  }
  const bytes = decodeBase64(account.data[0]);
  if ((expectedSize !== null && bytes.length !== expectedSize)
      || (account.space !== undefined && asBigInt(account.space, 'Account data size') !== BigInt(bytes.length))) {
    fail('SOLANA_DATA_INVALID', 'An on-chain account has an unexpected size.');
  }
  return bytes;
}

function verifyProgramAccount(account, expectedLoader) {
  if (!account || account.executable !== true || account.owner !== expectedLoader) {
    fail('SOLANA_IDENTITY_MISMATCH', 'An expected Solana program has an unexpected loader identity.');
  }
}

function verifyMint(account, mint, expectedDecimals = 6, expectedSupply = null) {
  const data = readAccountBytes(account, TOKEN_PROGRAM_ADDRESS.toString(), TOKEN_MINT_SIZE);
  const supply = data.readBigUInt64LE(36);
  if (data[45] !== 1 || data[44] !== expectedDecimals || (expectedSupply !== null && supply !== expectedSupply)) {
    fail('SOLANA_IDENTITY_MISMATCH', 'A native or receipt mint identity is invalid.');
  }
  return { address: mint, supply, decimals: data[44] };
}

function tokenAccount(account, mint, owner, { allowAbsent = false } = {}) {
  if (account === null && allowAbsent) return null;
  const data = readAccountBytes(account, TOKEN_PROGRAM_ADDRESS.toString(), TOKEN_ACCOUNT_SIZE);
  const actualMint = new PublicKey(data.subarray(0, 32)).toBase58();
  const actualOwner = new PublicKey(data.subarray(32, 64)).toBase58();
  if (actualMint !== mint || actualOwner !== owner || data[108] !== 1) {
    fail('SOLANA_IDENTITY_MISMATCH', 'A token account does not match the expected owner, mint, or initialized state.');
  }
  return { amount: data.readBigUInt64LE(64), data };
}

function stableAddressList(values) {
  return [...new Set(values.map(value => canonicalAddress(String(value))))].map(value => address(value));
}

function mapAccounts(keys, response) {
  if (!response || !Array.isArray(response.value) || response.value.length !== keys.length) {
    fail('SOLANA_DATA_INVALID', 'Mainnet account snapshot is incomplete.');
  }
  const result = new Map();
  keys.forEach((key, index) => result.set(key.toString(), response.value[index]));
  return result;
}

function getOracleAddresses(reserveState) {
  const info = reserveState?.config?.tokenInfo;
  if (!info) fail('SOLANA_DATA_INVALID', 'Kamino oracle configuration is incomplete.');
  return [
    info.pythConfiguration?.price,
    info.switchboardConfiguration?.priceAggregator,
    info.switchboardConfiguration?.twapAggregator,
    info.scopeConfiguration?.priceFeed,
  ].filter(value => typeof value === 'string' && isNotNullPubkey(value));
}

function oracleAccountMap(accounts, oracleAddresses) {
  const result = new Map();
  for (const key of oracleAddresses) {
    const accountInfo = accounts.get(key);
    if (accountInfo !== null && accountInfo !== undefined) {
      result.set(key, { ...accountInfo, programAddress: accountInfo.owner, address: address(key) });
    }
  }
  return result;
}

function verifyOracleAccountOwners(entries, accounts) {
  const expected = new Map();
  for (const { state } of entries) {
    const info = state?.config?.tokenInfo;
    if (!info) fail('SOLANA_DATA_INVALID', 'Kamino oracle account configuration is incomplete.');
    const feeds = [
      [info.pythConfiguration?.price, PYTH_RECEIVER_PROGRAM],
      [info.switchboardConfiguration?.priceAggregator, SWITCHBOARD_PROGRAM],
      [info.switchboardConfiguration?.twapAggregator, SWITCHBOARD_PROGRAM],
      [info.scopeConfiguration?.priceFeed, SCOPE_PROGRAM],
    ];
    for (const [feed, program] of feeds) {
      if (typeof feed !== 'string' || !isNotNullPubkey(feed)) continue;
      const prior = expected.get(feed);
      if (prior && prior !== program) fail('SOLANA_IDENTITY_MISMATCH', 'Oracle account is configured for multiple program identities.');
      expected.set(feed, program);
    }
  }
  for (const [feed, program] of expected) {
    const account = accounts.get(feed);
    if (account !== null && account !== undefined && account.owner !== program) {
      fail('SOLANA_IDENTITY_MISMATCH', 'Configured Kamino oracle account has an unexpected owner program.');
    }
  }
}

function oracleObservations(entries, accountMap) {
  return new Map(getTokenOracleDataSync(accountMap, entries).map(([entry, observation]) => [entry.address, observation ?? null]));
}

function ensureFloatRate(state, marketAddress, expectedMint, label) {
  if (!state || state.lendingMarket !== marketAddress || state.liquidity.mintPubkey !== expectedMint
      || state.config.debtTermSeconds.toString() !== '0' || state.config.debtMaturityTimestamp.toString() !== '0') {
    fail('SOLANA_IDENTITY_MISMATCH', `${label} is not the pinned float-rate reserve in its market.`);
  }
}

function equalSdkState(left, right, label) {
  if (!left || !right || JSON.stringify(left.toJSON()) !== JSON.stringify(right.toJSON())) {
    fail('SOLANA_STATE_CHANGED', `${label} changed during evidence collection.`);
  }
}

function sourceTime(timestamp) {
  let seconds;
  try { seconds = BigInt(timestamp); } catch { return null; }
  if (seconds <= 0n || seconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

function usdMicros(price, rounding) {
  if (!price || typeof price.toString !== 'function') return null;
  let value;
  try { value = new Decimal(price.toString()).mul(1_000_000).toDecimalPlaces(0, rounding); }
  catch { return null; }
  if (!value.isFinite() || value.lte(0)) return null;
  return BigInt(value.toFixed(0));
}

function choosePrice(candidates, rounding, direction, asOf, maxAgeSeconds = null) {
  const values = [];
  const asOfSeconds = Math.floor(Date.parse(asOf) / 1000);
  for (const candidate of candidates) {
    const observation = candidate.observation;
    if (observation?.valid !== true) continue;
    const micros = usdMicros(observation.price, rounding);
    const observedAt = sourceTime(observation.timestamp);
    if (micros === null || observedAt === null) continue;
    const observedSeconds = Math.floor(Date.parse(observedAt) / 1000);
    const age = asOfSeconds - observedSeconds;
    if (age < 0 || (maxAgeSeconds !== null && age > maxAgeSeconds)) continue;
    values.push({ ...candidate, micros, observedAt, ageSeconds: age });
  }
  if (values.length === 0) return null;
  values.sort((left, right) => left.micros < right.micros ? -1 : left.micros > right.micros ? 1 : 0);
  return direction === 'min' ? values[0] : values[values.length - 1];
}

function costUsdcBaseUnits(lamports, nativePriceUsdMicros, usdcPriceUsdMicros) {
  const numerator = BigInt(lamports) * BigInt(nativePriceUsdMicros);
  const denominator = COST_DENOMINATOR * BigInt(usdcPriceUsdMicros);
  if (denominator <= 0n) fail('SOLANA_PRICE_UNAVAILABLE', 'Native transaction cost valuation is unavailable.');
  return ((numerator + denominator - 1n) / denominator).toString();
}

function encodeSignature(signature) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${Buffer.from(signature).toString('hex')}`);
  let output = '';
  while (value > 0n) {
    output = alphabet[Number(value % 58n)] + output;
    value /= 58n;
  }
  for (const byte of signature) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output;
}

function canonicalTransaction(value) {
  return decodeBase64(value, MAX_TRANSACTION_BYTES);
}

function decodeSignedTransaction(prepared, signedTransactionBase64) {
  if (!prepared || typeof prepared !== 'object' || !['supply', 'redeem', 'fee'].includes(prepared.action)
      || prepared.schemaVersion !== 1 || prepared.chain !== 'solana' || prepared.network !== NETWORK
      || prepared.source?.adapterVersion !== ADAPTER_VERSION || prepared.source?.programId !== PROGRAM_ID.toString()
      || !Number.isSafeInteger(prepared.source?.slot) || prepared.source.slot <= 0
      || !SHA256_RE.test(prepared.messageSha256) || typeof prepared.transactionBase64 !== 'string') {
    fail('INVALID_PREPARED_ACTION', 'Prepared transaction evidence is invalid.');
  }
  const wallet = walletAddress(prepared.wallet);
  canonicalAddress(prepared.blockhash, 'Prepared blockhash');
  if (!Number.isSafeInteger(prepared.lastValidBlockHeight) || prepared.lastValidBlockHeight <= 0
      || typeof prepared.expiresAt !== 'string' || !Number.isFinite(Date.parse(prepared.expiresAt))) {
    fail('INVALID_PREPARED_ACTION', 'Prepared transaction lifetime is invalid.');
  }
  const bytes = canonicalTransaction(signedTransactionBase64);
  let transaction;
  try { transaction = VersionedTransaction.deserialize(bytes); }
  catch { fail('INVALID_SIGNED_TRANSACTION', 'Signed transaction encoding is invalid.'); }
  if (!Buffer.from(transaction.serialize()).equals(bytes)) fail('INVALID_SIGNED_TRANSACTION', 'Signed transaction encoding is not canonical.');
  const message = Buffer.from(transaction.message.serialize());
  const unsignedBytes = canonicalTransaction(prepared.transactionBase64);
  let unsigned;
  try { unsigned = VersionedTransaction.deserialize(unsignedBytes); }
  catch { fail('INVALID_PREPARED_ACTION', 'Prepared transaction encoding is invalid.'); }
  const unsignedMessage = Buffer.from(unsigned.message.serialize());
  if (!message.equals(unsignedMessage) || sha256(message) !== prepared.messageSha256
      || sha256(unsignedMessage) !== prepared.messageSha256
      || transaction.message.version !== 0 || transaction.message.addressTableLookups.length !== 0
      || transaction.message.header.numRequiredSignatures !== 1 || transaction.signatures.length !== 1
      || unsigned.signatures.length !== 1 || !unsigned.signatures[0].every(byte => byte === 0)
      || transaction.message.staticAccountKeys.length === 0
      || transaction.message.staticAccountKeys[0].toBase58() !== wallet
      || transaction.message.recentBlockhash !== prepared.blockhash) {
    fail('INVALID_SIGNED_TRANSACTION', 'Signed transaction does not match the exact prepared wallet message.');
  }
  const signatureBytes = transaction.signatures[0];
  if (!signatureBytes || signatureBytes.every(byte => byte === 0)) fail('INVALID_SIGNED_TRANSACTION', 'Wallet signature is missing.');
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new PublicKey(wallet).toBuffer()]),
      format: 'der', type: 'spki',
    });
  } catch {
    fail('INVALID_PREPARED_ACTION', 'Prepared wallet signing identity is invalid.');
  }
  if (!verify(null, message, publicKey, signatureBytes)) fail('INVALID_SIGNED_TRANSACTION', 'Wallet signature does not verify.');
  return {
    signature: encodeSignature(signatureBytes),
    signedTransactionBase64: bytes.toString('base64'),
    messageSha256: sha256(message),
    transaction,
  };
}


function normalizeError(error, fallbackCode = 'SOLANA_DATA_UNAVAILABLE') {
  if (error instanceof SolanaLendingError) return error;
  return new SolanaLendingError(fallbackCode, 'Solana lending evidence is unavailable or invalid.');
}

function expectedReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length !== DEFAULT_LENDING_RESERVES.length) fail('INVALID_INPUT', 'Only the two reviewed Kamino USDC reserves are supported.');
  const requested = reserves.map(entry => {
    if (!entry || typeof entry !== 'object') fail('INVALID_INPUT', 'Kamino reserve configuration is invalid.');
    const reserveAddress = canonicalAddress(entry.reserveAddress, 'Reserve address');
    const marketAddress = canonicalAddress(entry.marketAddress, 'Market address');
    const expected = DEFAULT_LENDING_RESERVES.find(item => item.reserveAddress === reserveAddress && item.marketAddress === marketAddress);
    if (!expected || entry.mint !== USDC_MINT || entry.symbol !== 'USDC' || entry.decimals !== 6) fail('INVALID_INPUT', 'Only the reviewed native USDC reserves are supported.');
    return expected;
  });
  if (new Set(requested.map(item => item.reserveAddress)).size !== requested.length) fail('INVALID_INPUT', 'Kamino reserve configuration contains duplicates.');
  return DEFAULT_LENDING_RESERVES.map(item => requested.find(value => value.reserveAddress === item.reserveAddress));
}

function amountForReceipt(reserve, receiptAmount) {
  const receipt = BigInt(receiptAmount);
  if (receipt === 0n) return { usdcValueBaseUnits: '0', redeemableBaseUnits: '0' };
  const supplySf = BigInt(reserve.getTotalSupplySf().toString());
  const receiptSupply = BigInt(reserve.state.collateral.mintTotalSupply.toString());
  if (supplySf <= 0n || receiptSupply <= 0n) fail('SOLANA_DATA_INVALID', 'Canonical Kamino receipt conversion is unavailable.');
  const divisor = receiptSupply * FIXED_POINT_ONE;
  const value = receipt * supplySf / divisor;
  const liquidity = BigInt(reserve.state.liquidity.totalAvailableAmount.toString());
  const queueReceipts = BigInt(reserve.state.withdrawQueue.queuedCollateralAmount.toString());
  const queueLiquidity = queueReceipts * supplySf / divisor;
  const freeLiquidity = liquidity > queueLiquidity ? liquidity - queueLiquidity : 0n;
  const freeReceipts = freeLiquidity * receiptSupply * FIXED_POINT_ONE / supplySf;
  return { usdcValueBaseUnits: value.toString(), redeemableBaseUnits: (receipt < freeReceipts ? receipt : freeReceipts).toString() };
}

function tokenPolicyIdl(instructionName, discriminator, accounts, args = []) {
  return {
    address: PROGRAM_ID.toString(),
    metadata: { name: 'kamino_lending', version: '1.25.0', spec: '0.1.0' },
    instructions: [{ name: instructionName, discriminator, accounts: accounts.map(([name, writable, signer]) => ({ name, writable, signer })), args }],
  };
}

function makePolicyRule(name, conditions) {
  return { name, method: 'signTransaction', conditions, action: 'ALLOW' };
}

export function createSolanaLendingAdapter({ rpcUrl, reserves = DEFAULT_LENDING_RESERVES, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() }) {
  if (typeof rpcUrl !== 'string' || !rpcUrl || typeof fetchImpl !== 'function') fail('INVALID_INPUT', 'Mainnet RPC URL and fetch implementation are required.');
  let endpoint;
  try { endpoint = new URL(rpcUrl); }
  catch { fail('INVALID_INPUT', 'Mainnet RPC URL is invalid.'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) fail('INVALID_INPUT', 'RPC endpoint must be HTTP(S) and contain no URL credentials.');
  const supportedReserves = expectedReserves(reserves);
  const rpc = createSolanaRpcFromTransport(async ({ payload, signal }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: controller.signal });
      if (!response?.ok || response.redirected) fail('SOLANA_RPC_UNAVAILABLE', 'Mainnet RPC request failed.');
      const raw = await boundedBody(response);
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
      catch { fail('SOLANA_RPC_UNAVAILABLE', 'Mainnet RPC returned invalid JSON.'); }
      return validateRpcEnvelope(payload, value);
    } catch (error) {
      if (error instanceof SolanaLendingError) throw error;
      throw new SolanaLendingError('SOLANA_RPC_UNAVAILABLE', 'Mainnet RPC evidence is unavailable.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  });

  async function assertMainnet() {
    let genesis;
    try { genesis = await rpc.getGenesisHash().send(); }
    catch { fail('SOLANA_RPC_UNAVAILABLE', 'Solana network identity is unavailable.'); }
    if (genesis !== MAINNET_GENESIS) fail('SOLANA_NETWORK_MISMATCH', 'RPC does not report Solana mainnet-beta genesis.');
  }

  async function readCurrent(wallet, { allowMissingWalletAccounts = false, additionalOwners = [] } = {}) {
    const owner = walletAddress(wallet);
    await assertMainnet();
    const initialSlot = asSlot(await rpc.getSlot({ commitment: 'confirmed' }).send());
    let recentSlotDurationMs;
    try { recentSlotDurationMs = await getMedianSlotDurationInMsFromLastEpochs(rpc); }
    catch { fail('SOLANA_RPC_UNAVAILABLE', 'Current Solana slot timing is unavailable.'); }
    if (!Number.isFinite(recentSlotDurationMs) || recentSlotDurationMs <= 0) fail('SOLANA_DATA_INVALID', 'Current Solana slot timing is invalid.');

    const markets = [...new Set(supportedReserves.map(item => item.marketAddress))];
    const firstAddresses = stableAddressList([
      PROGRAM_ID.toString(), TOKEN_PROGRAM_ADDRESS.toString(), ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString(), SYSTEM_PROGRAM,
      ...markets, ...supportedReserves.map(item => item.reserveAddress), ...NATIVE_PRICE_RESERVES.map(item => item.reserveAddress),
    ]);
    const firstResponse = await rpc.getMultipleAccounts(firstAddresses, { commitment: 'confirmed', encoding: 'base64', minContextSlot: BigInt(initialSlot) }).send();
    const firstAccounts = mapAccounts(firstAddresses, firstResponse);
    const firstSlot = asSlot(firstResponse.context?.slot);
    if (firstSlot < initialSlot) fail('SOLANA_DATA_INVALID', 'First account snapshot is older than its requested minimum slot.');
    const klendProgram = PROGRAM_ID.toString();
    if (klendProgram !== MAINNET_KLEND_PROGRAM) fail('SOLANA_IDENTITY_MISMATCH', 'Pinned Kamino program does not match reviewed mainnet identity.');
    verifyProgramAccount(firstAccounts.get(klendProgram), UPGRADEABLE_LOADER);
    verifyProgramAccount(firstAccounts.get(TOKEN_PROGRAM_ADDRESS.toString()), UPGRADEABLE_LOADER);
    verifyProgramAccount(firstAccounts.get(ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString()), BPF_LOADER);
    verifyProgramAccount(firstAccounts.get(SYSTEM_PROGRAM), NATIVE_LOADER);

    const marketStates = new Map();
    const reserveStates = new Map();
    const nativeStates = new Map();
    for (const marketAddress of markets) {
      const state = LendingMarket.decode(readAccountBytes(firstAccounts.get(marketAddress), klendProgram, LendingMarket.layout.span + 8));
      if (!state) fail('SOLANA_IDENTITY_MISMATCH', 'Kamino market account could not be decoded.');
      marketStates.set(marketAddress, state);
    }
    for (const config of supportedReserves) {
      const state = Reserve.decode(readAccountBytes(firstAccounts.get(config.reserveAddress), klendProgram, Reserve.layout.span + 8));
      ensureFloatRate(state, config.marketAddress, USDC_MINT, 'Configured USDC');
      if (state.liquidity.mintDecimals.toString() !== '6' || state.liquidity.tokenProgram !== TOKEN_PROGRAM_ADDRESS.toString()) {
        fail('SOLANA_IDENTITY_MISMATCH', 'Configured Kamino reserve is not standard six-decimal USDC.');
      }
      reserveStates.set(config.reserveAddress, state);
    }
    for (const config of NATIVE_PRICE_RESERVES) {
      const state = Reserve.decode(readAccountBytes(firstAccounts.get(config.reserveAddress), klendProgram, Reserve.layout.span + 8));
      if (state.liquidity.mintDecimals.toString() !== '9' || state.liquidity.tokenProgram !== TOKEN_PROGRAM_ADDRESS.toString()) {
        fail('SOLANA_IDENTITY_MISMATCH', 'Native price reserve is not standard wrapped SOL.');
      }
      nativeStates.set(config.reserveAddress, state);
    }

    const receiptMints = new Map();
    const walletAtas = new Map();
    for (const config of supportedReserves) {
      const receiptMint = reserveStates.get(config.reserveAddress).collateral.mintPubkey;
      if (!receiptMint) fail('SOLANA_IDENTITY_MISMATCH', 'Kamino reserve receipt mint is missing.');
      receiptMints.set(config.reserveAddress, receiptMint);
      const usdcAta = await getAssociatedTokenAddress(address(USDC_MINT), address(owner), TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
      const receiptAta = await getAssociatedTokenAddress(address(receiptMint), address(owner), TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
      walletAtas.set(config.reserveAddress, { usdc: usdcAta.toString(), receipt: receiptAta.toString() });
    }
    const recipientAtas = new Map();
    for (const recipient of additionalOwners) {
      const recipientAddress = canonicalAddress(recipient, 'Recipient');
      const ata = await getAssociatedTokenAddress(address(USDC_MINT), address(recipientAddress), TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
      recipientAtas.set(recipientAddress, ata.toString());
    }
    const reserveEntries = [
      ...supportedReserves.map(config => ({ address: config.reserveAddress, state: reserveStates.get(config.reserveAddress) })),
      ...NATIVE_PRICE_RESERVES.map(config => ({ address: config.reserveAddress, state: nativeStates.get(config.reserveAddress) })),
    ];
    const oracleAddresses = [...new Set(reserveEntries.flatMap(entry => getOracleAddresses(entry.state)))];
    const finalAddresses = stableAddressList([
      ...firstAddresses.map(item => item.toString()), USDC_MINT, WRAPPED_SOL_MINT, ...receiptMints.values(),
      ...supportedReserves.flatMap(config => [walletAtas.get(config.reserveAddress).usdc, walletAtas.get(config.reserveAddress).receipt]),
      ...recipientAtas.values(), owner, ...oracleAddresses,
    ]);
    const finalResponse = await rpc.getMultipleAccounts(finalAddresses, { commitment: 'confirmed', encoding: 'base64', minContextSlot: BigInt(firstSlot) }).send();
    const accounts = mapAccounts(finalAddresses, finalResponse);
    const slot = asSlot(finalResponse.context?.slot);
    if (slot < firstSlot) fail('SOLANA_DATA_INVALID', 'Final account snapshot is older than reserve discovery.');

    const finalMarketStates = new Map();
    const finalReserveStates = new Map();
    const finalNativeStates = new Map();
    for (const marketAddress of markets) {
      const state = LendingMarket.decode(readAccountBytes(accounts.get(marketAddress), klendProgram, LendingMarket.layout.span + 8));
      equalSdkState(marketStates.get(marketAddress), state, 'Kamino market');
      finalMarketStates.set(marketAddress, state);
    }
    for (const config of supportedReserves) {
      const state = Reserve.decode(readAccountBytes(accounts.get(config.reserveAddress), klendProgram, Reserve.layout.span + 8));
      equalSdkState(reserveStates.get(config.reserveAddress), state, 'Kamino USDC reserve');
      ensureFloatRate(state, config.marketAddress, USDC_MINT, 'Configured USDC');
      finalReserveStates.set(config.reserveAddress, state);
    }
    for (const config of NATIVE_PRICE_RESERVES) {
      const state = Reserve.decode(readAccountBytes(accounts.get(config.reserveAddress), klendProgram, Reserve.layout.span + 8));
      equalSdkState(nativeStates.get(config.reserveAddress), state, 'Kamino native price reserve');
      ensureFloatRate(state, config.marketAddress, WRAPPED_SOL_MINT, 'Native price');
      finalNativeStates.set(config.reserveAddress, state);
    }

    verifyMint(accounts.get(USDC_MINT), USDC_MINT, 6);
    const receiptMintInfo = new Map();
    for (const config of supportedReserves) {
      const state = finalReserveStates.get(config.reserveAddress);
      const mint = receiptMints.get(config.reserveAddress);
      receiptMintInfo.set(config.reserveAddress, verifyMint(accounts.get(mint), mint, 6, BigInt(state.collateral.mintTotalSupply.toString())));
    }
    verifyMint(accounts.get(WRAPPED_SOL_MINT), WRAPPED_SOL_MINT, 9);
    verifyOracleAccountOwners(reserveEntries, accounts);
    const oracleMap = oracleAccountMap(accounts, oracleAddresses);
    const observations = oracleObservations(reserveEntries, oracleMap);
    const targetObservations = new Map(supportedReserves.map(config => [config.reserveAddress, observations.get(config.reserveAddress)]));
    const nativeObservations = new Map(NATIVE_PRICE_RESERVES.map(config => [config.reserveAddress, observations.get(config.reserveAddress)]));
    const ledgerInstant = await resolveLedgerInstantForSlot(rpc, BigInt(slot), 'Solana lending snapshot');
    const blockTime = Number(ledgerInstant.blockTime);
    if (!Number.isSafeInteger(blockTime) || blockTime <= 0) fail('SOLANA_DATA_INVALID', 'Mainnet account snapshot block time is unavailable.');
    const observedAt = new Date(blockTime * 1000).toISOString();
    const capturedAt = isoNow(now);
    if (Date.parse(observedAt) > Date.parse(capturedAt)) fail('SOLANA_DATA_INVALID', 'Mainnet account snapshot is ahead of the adapter clock.');
    const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(TOKEN_ACCOUNT_SIZE), { commitment: 'confirmed' }).send();
    const associatedAccountRentLamports = asBigInt(rent, 'Associated token account rent').toString();

    const walletAccount = accounts.get(owner);
    let walletLamports = null;
    if (walletAccount !== null) {
      if (walletAccount.owner !== SYSTEM_PROGRAM || walletAccount.executable !== false
          || !Array.isArray(walletAccount.data) || decodeBase64(walletAccount.data[0]).length !== 0) {
        fail('SOLANA_IDENTITY_MISMATCH', 'Wallet native account identity is invalid.');
      }
      walletLamports = asBigInt(walletAccount.lamports, 'Wallet lamports').toString();
    }
    const walletTokenAccounts = new Map();
    for (const config of supportedReserves) {
      const ata = walletAtas.get(config.reserveAddress);
      walletTokenAccounts.set(config.reserveAddress, {
        usdc: tokenAccount(accounts.get(ata.usdc), USDC_MINT, owner, { allowAbsent: allowMissingWalletAccounts }),
        receipt: tokenAccount(accounts.get(ata.receipt), receiptMints.get(config.reserveAddress), owner, { allowAbsent: allowMissingWalletAccounts }),
        accounts: ata,
      });
    }
    const recipientAccounts = new Map();
    for (const [recipient, ata] of recipientAtas) {
      recipientAccounts.set(recipient, { ata, info: tokenAccount(accounts.get(ata), USDC_MINT, recipient, { allowAbsent: true }) });
    }

    const kaminoReserves = new Map();
    const marketsByAddress = new Map();
    const marketAuthorities = new Map();
    for (const config of supportedReserves) {
      const state = finalReserveStates.get(config.reserveAddress);
      const oracle = targetObservations.get(config.reserveAddress);
      if (!oracle) fail('SOLANA_PRICE_UNAVAILABLE', 'Kamino reserve oracle evidence is unavailable.');
      const marketState = finalMarketStates.get(config.marketAddress);
      const reserve = KaminoReserve.fromAccountData(
        address(config.reserveAddress),
        readAccountBytes(accounts.get(config.reserveAddress), klendProgram, Reserve.layout.span + 8),
        oracle,
        rpc,
        recentSlotDurationMs,
        Number(marketState.reserveRewardsMaxAprBps.toString()),
        undefined,
        address(klendProgram),
      );
      if (!reserve.getKind().isFloatRate()) fail('SOLANA_IDENTITY_MISMATCH', 'Reviewed reserve is no longer a float-rate reserve.');
      const map = new Map([[address(config.reserveAddress), reserve]]);
      const market = KaminoMarket.loadWithReserves(rpc, marketState, map, address(config.marketAddress), recentSlotDurationMs, address(klendProgram));
      const selected = market.getExistingFloatRateReserveByMint(address(USDC_MINT));
      if (selected.address.toString() !== config.reserveAddress) fail('SOLANA_IDENTITY_MISMATCH', 'USDC float-rate reserve no longer matches the reviewed address.');
      const authority = await market.getLendingMarketAuthority();
      const vault = tokenAccount(accounts.get(state.liquidity.supplyVault), USDC_MINT, authority.toString());
      if (vault.amount !== BigInt(state.liquidity.totalAvailableAmount.toString())) fail('SOLANA_STATE_CHANGED', 'Reserve USDC vault balance does not match its current reserve state.');
      kaminoReserves.set(config.reserveAddress, reserve);
      marketsByAddress.set(config.marketAddress, market);
      marketAuthorities.set(config.marketAddress, authority.toString());
    }
    for (const config of NATIVE_PRICE_RESERVES) {
      if (finalNativeStates.get(config.reserveAddress).liquidity.mintPubkey !== WRAPPED_SOL_MINT) fail('SOLANA_IDENTITY_MISMATCH', 'Native price reserve mint changed.');
    }

    const nowIso = capturedAt;
    const nativePrice = choosePrice(NATIVE_PRICE_RESERVES.map(config => ({ reserveAddress: config.reserveAddress, observation: nativeObservations.get(config.reserveAddress) })), Decimal.ROUND_CEIL, 'max', nowIso);
    const usdcPrice = choosePrice(supportedReserves.map(config => ({ reserveAddress: config.reserveAddress, observation: targetObservations.get(config.reserveAddress) })), Decimal.ROUND_FLOOR, 'min', nowIso);
    return {
      wallet: owner, slot, observedAt, capturedAt, recentSlotDurationMs, ledgerInstant, accounts,
      finalMarketStates, finalReserveStates, finalNativeStates, receiptMints, receiptMintInfo,
      walletAtas, walletTokenAccounts, recipientAccounts, marketAuthorities, kaminoReserves, marketsByAddress,
      targetObservations, nativeObservations, nativePrice, usdcPrice, walletLamports,
      associatedAccountRentLamports, oracleAddresses,
    };
  }

  function priceEvidence(snapshot, maxAgeSeconds = null) {
    const nowIso = isoNow(now);
    const native = choosePrice(NATIVE_PRICE_RESERVES.map(config => ({ reserveAddress: config.reserveAddress, observation: snapshot.nativeObservations.get(config.reserveAddress) })), Decimal.ROUND_CEIL, 'max', nowIso, maxAgeSeconds);
    const usdc = choosePrice(supportedReserves.map(config => ({ reserveAddress: config.reserveAddress, observation: snapshot.targetObservations.get(config.reserveAddress) })), Decimal.ROUND_FLOOR, 'min', nowIso, maxAgeSeconds);
    if (!native || !usdc) fail('SOLANA_PRICE_UNAVAILABLE', 'Fresh SOL/USD and USDC/USD oracle evidence is required.');
    const accountAge = (Date.parse(nowIso) - Date.parse(snapshot.observedAt)) / 1000;
    if (accountAge < 0 || (maxAgeSeconds !== null && accountAge > maxAgeSeconds)) fail('SOLANA_STALE_EVIDENCE', 'Account snapshot exceeds the allowed evidence age.');
    return {
      nativePriceUsdMicros: native.micros.toString(), nativePriceObservedAt: native.observedAt,
      nativePriceSourceReserveAddress: native.reserveAddress, nativePriceAgeSeconds: native.ageSeconds,
      usdcPriceUsdMicros: usdc.micros.toString(), usdcPriceObservedAt: usdc.observedAt,
      usdcPriceSourceReserveAddress: usdc.reserveAddress, usdcPriceAgeSeconds: usdc.ageSeconds,
      sourceSlot: snapshot.slot,
      maxAgeSeconds,
    };
  }
  function requireFreshObservation(observation, maxAgeSeconds, label) {
    if (!observation || observation.valid !== true || !observation.price || !observation.timestamp) {
      fail('SOLANA_PRICE_UNAVAILABLE', `${label} oracle data is unavailable or invalid.`);
    }
    const price = new Decimal(observation.price.toString());
    const observedAt = sourceTime(observation.timestamp);
    if (!price.isFinite() || price.lte(0) || !observedAt) fail('SOLANA_PRICE_UNAVAILABLE', `${label} oracle data is unavailable or invalid.`);
    const age = (Date.parse(isoNow(now)) - Date.parse(observedAt)) / 1000;
    if (age < 0 || age > maxAgeSeconds) fail('SOLANA_STALE_EVIDENCE', `${label} oracle data is stale.`);
  }


  function refreshInstruction(config, reserveState) {
    const tokenInfo = reserveState?.config?.tokenInfo;
    if (!tokenInfo || reserveState.lendingMarket !== config.marketAddress) fail('SOLANA_IDENTITY_MISMATCH', 'Kamino reserve refresh identity is invalid.');
    const optional = value => isNotNullPubkey(value) ? some(address(value)) : none();
    return refreshReserve({
      reserve: address(config.reserveAddress),
      lendingMarket: address(config.marketAddress),
      pythOracle: optional(tokenInfo.pythConfiguration.price),
      switchboardPriceOracle: optional(tokenInfo.switchboardConfiguration.priceAggregator),
      switchboardTwapOracle: optional(tokenInfo.switchboardConfiguration.twapAggregator),
      scopePrices: optional(tokenInfo.scopeConfiguration.priceFeed),
    }, undefined, address(PROGRAM_ID.toString()));
  }

  function createUnsignedMessage(wallet, blockhash, lastValidBlockHeight, instructions) {
    return pipe(
      createTransactionMessage({ version: 0 }),
      message => setTransactionMessageFeePayer(address(wallet), message),
      message => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) }, message),
      message => appendTransactionMessageInstructions(instructions, message),
    );
  }

  function validateLendingInstructions(instructions, action, config, snapshot, amount) {
    if (instructions.length !== 2 || instructions.some(item => item.programAddress.toString() !== PROGRAM_ID.toString())) {
      fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Kamino SDK generated an unsupported lending instruction set.');
    }
    const refresh = instructions[0];
    const operation = instructions[1];
    if (!Buffer.from(refresh.data).equals(Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]))) {
      fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Transaction does not include the exact Kamino reserve refresh instruction.');
    }
    const data = Buffer.from(operation.data);
    const discriminator = action === 'supply'
      ? Buffer.from([169, 201, 30, 126, 6, 205, 102, 68])
      : Buffer.from([234, 117, 181, 125, 185, 142, 220, 29]);
    if (data.length !== 16 || !data.subarray(0, 8).equals(discriminator) || data.readBigUInt64LE(8) !== amount) {
      fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Kamino SDK instruction amount or discriminator does not match the exact request.');
    }
    const walletAccounts = snapshot.walletAtas.get(config.reserveAddress);
    const receiptMint = snapshot.receiptMints.get(config.reserveAddress);
    const common = snapshot.finalReserveStates.get(config.reserveAddress);
    const authority = snapshot.marketAuthorities.get(config.marketAddress);
    const expected = action === 'supply'
      ? [snapshot.wallet, config.reserveAddress, config.marketAddress, authority, USDC_MINT, common.liquidity.supplyVault,
        receiptMint, walletAccounts.usdc, walletAccounts.receipt, TOKEN_PROGRAM_ADDRESS.toString(),
        common.liquidity.tokenProgram, INSTRUCTIONS_SYSVAR]
      : [snapshot.wallet, config.marketAddress, config.reserveAddress, authority, USDC_MINT, receiptMint,
        common.liquidity.supplyVault, walletAccounts.receipt, walletAccounts.usdc, TOKEN_PROGRAM_ADDRESS.toString(),
        common.liquidity.tokenProgram, INSTRUCTIONS_SYSVAR];
    const actual = operation.accounts.map(meta => meta.address.toString());
    if (actual.length !== expected.length || expected.some((value, index) => actual[index] !== value)) {
      fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Kamino SDK instruction accounts do not match current reserve and wallet identities.');
    }
    const refreshAccounts = refresh.accounts.map(meta => meta.address.toString());
    const expectedRefresh = [
      config.reserveAddress, config.marketAddress,
      isNotNullPubkey(common.config.tokenInfo.pythConfiguration.price) ? common.config.tokenInfo.pythConfiguration.price : PROGRAM_ID.toString(),
      isNotNullPubkey(common.config.tokenInfo.switchboardConfiguration.priceAggregator) ? common.config.tokenInfo.switchboardConfiguration.priceAggregator : PROGRAM_ID.toString(),
      isNotNullPubkey(common.config.tokenInfo.switchboardConfiguration.twapAggregator) ? common.config.tokenInfo.switchboardConfiguration.twapAggregator : PROGRAM_ID.toString(),
      isNotNullPubkey(common.config.tokenInfo.scopeConfiguration.priceFeed) ? common.config.tokenInfo.scopeConfiguration.priceFeed : PROGRAM_ID.toString(),
    ];
    if (refreshAccounts.length !== expectedRefresh.length || expectedRefresh.some((value, index) => refreshAccounts[index] !== value)) {
      fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Kamino reserve refresh accounts do not match current oracle configuration.');
    }
  }

  function validateFeeInstructions(instructions, snapshot, amount, sourceAddress, destinationAddress, recipient, createsAta) {
    const expectedLength = createsAta ? 2 : 1;
    if (instructions.length !== expectedLength) fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Fee transaction contains unsupported instructions.');
    let transferIndex = 0;
    if (createsAta) {
      const create = instructions[0];
      if (create.programAddress.toString() !== ASSOCIATED_TOKEN_PROGRAM_ADDRESS.toString()
          || !Buffer.from(create.data).equals(Buffer.from([1]))) fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Fee transaction ATA instruction is not idempotent create.');
      const ataAccounts = create.accounts.map(meta => meta.address.toString());
      const expected = [snapshot.wallet, destinationAddress, recipient, USDC_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM_ADDRESS.toString()];
      if (ataAccounts.length !== expected.length || expected.some((value, index) => ataAccounts[index] !== value)) {
        fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Fee ATA instruction is not scoped to the exact payer, recipient, and USDC mint.');
      }
      transferIndex = 1;
    }
    const transfer = instructions[transferIndex];
    const data = Buffer.from(transfer.data);
    const actualAccounts = transfer.accounts.map(meta => meta.address.toString());
    if (transfer.programAddress.toString() !== TOKEN_PROGRAM_ADDRESS.toString() || data.length !== 10
        || data[0] !== 12 || data.readBigUInt64LE(1) !== amount || data[9] !== 6
        || actualAccounts.length !== 4
        || actualAccounts[0] !== sourceAddress || actualAccounts[1] !== USDC_MINT
        || actualAccounts[2] !== destinationAddress || actualAccounts[3] !== snapshot.wallet) {
      fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Owner-only fee transfer is not exact native USDC TransferChecked.');
    }
  }

  async function finishPreparation({ snapshot, wallet, action, reserveAddress, amount, amountUnit, recipient, instructions, sourceAccount, destinationAccount, sourceAddress, destinationAddress, maxFeeLamports, rentLamports, priceEvidence: prices, maxEvidenceAgeSeconds, receiptMint = null, feeRecipient = null }) {
    const latest = await rpc.getLatestBlockhash({ commitment: 'confirmed', minContextSlot: BigInt(snapshot.slot) }).send();
    const blockhash = latest?.value?.blockhash;
    const lastValidBlockHeight = Number(latest?.value?.lastValidBlockHeight);
    const latestSlot = asSlot(latest?.context?.slot);
    if (latestSlot < snapshot.slot || typeof blockhash !== 'string' || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
      fail('SOLANA_DATA_INVALID', 'Current transaction blockhash evidence is invalid.');
    }
    const currentHeight = asBigInt(await rpc.getBlockHeight({ commitment: 'confirmed', minContextSlot: BigInt(latestSlot) }).send(), 'Current block height');
    const lastValidHeight = BigInt(lastValidBlockHeight);
    if (currentHeight > lastValidHeight) fail('SOLANA_BLOCKHASH_EXPIRED', 'Current blockhash has expired.');
    const message = createUnsignedMessage(wallet, blockhash, lastValidHeight, instructions);
    const compiled = compileTransaction(message);
    const requiredSigners = Object.keys(compiled.signatures);
    if (requiredSigners.length !== 1 || requiredSigners[0] !== wallet) fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Prepared message requires a non-wallet signer.');
    const transactionBase64 = getBase64EncodedWireTransaction(compiled);
    const rawTransaction = decodeBase64(transactionBase64, MAX_TRANSACTION_BYTES);
    if (rawTransaction.length > MAX_TRANSACTION_BYTES) fail('SOLANA_TRANSACTION_TOO_LARGE', 'Prepared transaction exceeds Solana packet size.');
    const messageBytes = Buffer.from(compiled.messageBytes);
    const messageSha256 = sha256(messageBytes);
    const feeQuote = await rpc.getFeeForMessage(messageBytes.toString('base64'), { commitment: 'confirmed' }).send();
    if (asSlot(feeQuote?.context?.slot) < snapshot.slot || feeQuote?.value === null || feeQuote?.value === undefined) {
      fail('SOLANA_COST_UNAVAILABLE', 'Exact transaction fee quote is unavailable.');
    }
    const feeLamports = asBigInt(feeQuote.value, 'Transaction fee quote');
    const totalLamports = feeLamports + rentLamports;
    if (feeLamports > maxFeeLamports) fail('SOLANA_FEE_CAP_EXCEEDED', 'Exact transaction fee exceeds the authorized fee cap.');
    if (snapshot.walletLamports === null) fail('SOLANA_BALANCE_UNAVAILABLE', 'Wallet native balance is unavailable.');
    if (totalLamports > BigInt(snapshot.walletLamports)) fail('SOLANA_INSUFFICIENT_SOL', 'Wallet SOL balance cannot cover fee and rent.');

    const simAddresses = [...new Set([sourceAddress, destinationAddress])];
    const simulation = await rpc.simulateTransaction(transactionBase64, {
      encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false,
      minContextSlot: BigInt(snapshot.slot),
      accounts: { encoding: 'base64', addresses: simAddresses.map(value => address(value)) },
    }).send();
    if (asSlot(simulation?.context?.slot) < snapshot.slot || simulation?.value?.err !== null
        || !Array.isArray(simulation?.value?.accounts) || simulation.value.accounts.length !== simAddresses.length) {
      fail('SOLANA_SIMULATION_FAILED', 'Exact transaction simulation failed or returned incomplete account evidence.');
    }
    const after = new Map(simAddresses.map((key, index) => [key, simulation.value.accounts[index]]));
    const sourceMint = action === 'redeem' ? receiptMint : USDC_MINT;
    const destinationMint = action === 'supply' ? receiptMint : USDC_MINT;
    const destinationOwner = action === 'fee' ? feeRecipient : wallet;
    const sourceAfter = tokenAccount(after.get(sourceAddress), sourceMint, wallet);
    const destinationAfter = tokenAccount(after.get(destinationAddress), destinationMint, destinationOwner);
    const sourceDelta = sourceAfter.amount - sourceAccount.amount;
    const destinationDelta = destinationAfter.amount - (destinationAccount?.amount ?? 0n);
    let expectedEffects;
    if (action === 'supply') {
      if (sourceDelta !== -amount || destinationDelta <= 0n) fail('SOLANA_SIMULATION_MISMATCH', 'Simulated supply effects do not match the requested USDC amount.');
      expectedEffects = { usdcDebitBaseUnits: amount.toString(), usdcCreditBaseUnits: '0', receiptDebitBaseUnits: '0', receiptCreditBaseUnits: destinationDelta.toString() };
    } else if (action === 'redeem') {
      if (sourceDelta !== -amount || destinationDelta <= 0n) fail('SOLANA_SIMULATION_MISMATCH', 'Simulated redeem effects do not match the requested receipt amount.');
      expectedEffects = { usdcDebitBaseUnits: '0', usdcCreditBaseUnits: destinationDelta.toString(), receiptDebitBaseUnits: amount.toString(), receiptCreditBaseUnits: '0' };
    } else {
      if (sourceDelta !== -amount || destinationDelta !== amount) fail('SOLANA_SIMULATION_MISMATCH', 'Simulated owner-only USDC transfer does not match its exact amount.');
      expectedEffects = { usdcDebitBaseUnits: amount.toString(), usdcCreditBaseUnits: '0', receiptDebitBaseUnits: '0', receiptCreditBaseUnits: '0' };
    }
    const currentHeightAfterSimulation = asBigInt(await rpc.getBlockHeight({ commitment: 'confirmed', minContextSlot: BigInt(snapshot.slot) }).send(), 'Current block height');
    if (currentHeightAfterSimulation > lastValidHeight) fail('SOLANA_BLOCKHASH_EXPIRED', 'Blockhash expired during transaction preflight.');
    const preparedAt = isoNow(now);
    const evidenceExpiry = Date.parse(preparedAt) + maxEvidenceAgeSeconds * 1000;
    const heightExpiry = Date.parse(preparedAt) + Number(lastValidHeight - currentHeightAfterSimulation) * snapshot.recentSlotDurationMs;
    const expiresAt = new Date(Math.min(evidenceExpiry, heightExpiry)).toISOString();
    if (Date.parse(expiresAt) <= Date.parse(preparedAt)) fail('SOLANA_BLOCKHASH_EXPIRED', 'Prepared transaction has no remaining validity window.');
    const costCap = costUsdcBaseUnits(maxFeeLamports + rentLamports, prices.nativePriceUsdMicros, prices.usdcPriceUsdMicros);
    const unsigned = {
      schemaVersion: 1, chain: 'solana', network: NETWORK, wallet, action, reserveAddress,
      amountBaseUnits: amount.toString(), amountUnit, recipient,
      transactionBase64: rawTransaction.toString('base64'), messageSha256, signature: null,
      blockhash, lastValidBlockHeight, observedAt: snapshot.observedAt, expiresAt,
      feeLamports: feeLamports.toString(), rentLamports: rentLamports.toString(), expectedEffects,
      source: { slot: snapshot.slot, programId: PROGRAM_ID.toString(), adapterVersion: ADAPTER_VERSION },
      maxTotalCostUsdcBaseUnits: costCap,
      nativePriceUsdMicros: prices.nativePriceUsdMicros,
      nativePriceObservedAt: prices.nativePriceObservedAt,
      nativePriceSourceReserveAddress: prices.nativePriceSourceReserveAddress,
      nativePriceSlot: snapshot.slot,
      usdcPriceUsdMicros: prices.usdcPriceUsdMicros,
      usdcPriceObservedAt: prices.usdcPriceObservedAt,
      usdcPriceSourceReserveAddress: prices.usdcPriceSourceReserveAddress,
      usdcPriceSlot: snapshot.slot,
      associatedAccountRentLamports: snapshot.associatedAccountRentLamports,
      sourceTokenAccount: sourceAddress,
      destinationTokenAccount: destinationAddress,
      receiptMint,
      feeRecipient,
      costEvidence: {
        maxFeeLamports: maxFeeLamports.toString(),
        associatedAccountRentLamports: rentLamports.toString(),
        actualQuotedFeeLamports: feeLamports.toString(),
        walletLamports: snapshot.walletLamports,
        nativePriceUsdMicros: prices.nativePriceUsdMicros,
        usdcPriceUsdMicros: prices.usdcPriceUsdMicros,
        nativePriceObservedAt: prices.nativePriceObservedAt,
        usdcPriceObservedAt: prices.usdcPriceObservedAt,
        priceMaxAgeSeconds: maxEvidenceAgeSeconds,
        sourceSlot: snapshot.slot,
        feeQuoteSlot: asSlot(feeQuote.context.slot),
      },
      simulation: {
        slot: asSlot(simulation.context.slot),
        unitsConsumed: simulation.value.unitsConsumed === null || simulation.value.unitsConsumed === undefined
          ? null : safeInteger(Number(simulation.value.unitsConsumed), 'Simulation compute units'),
      },
    };
    const parsed = VersionedTransaction.deserialize(rawTransaction);
    if (parsed.message.version !== 0 || parsed.message.addressTableLookups.length !== 0
        || parsed.message.header.numRequiredSignatures !== 1
        || parsed.message.staticAccountKeys[0].toBase58() !== wallet
        || !Buffer.from(parsed.message.serialize()).equals(messageBytes)) {
      fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Compiled transaction differs from its exact single-wallet message.');
    }
    return unsigned;
  }

  function receiptAmount(reserve, receiptBaseUnits) {
    const receipt = BigInt(receiptBaseUnits);
    if (receipt === 0n) return { usdcValueBaseUnits: '0', redeemableBaseUnits: '0' };
    const supplySf = BigInt(reserve.getTotalSupplySf().toString());
    const receiptSupply = BigInt(reserve.state.collateral.mintTotalSupply.toString());
    if (supplySf <= 0n || receiptSupply <= 0n) fail('SOLANA_DATA_INVALID', 'Canonical receipt conversion is unavailable.');
    const denominator = receiptSupply * FIXED_POINT_ONE;
    const value = receipt * supplySf / denominator;
    const available = BigInt(reserve.state.liquidity.totalAvailableAmount.toString());
    const queued = BigInt(reserve.state.withdrawQueue.queuedCollateralAmount.toString());
    const queuedUsdc = queued * supplySf / denominator;
    const freeUsdc = available > queuedUsdc ? available - queuedUsdc : 0n;
    const freeReceipt = freeUsdc * receiptSupply * FIXED_POINT_ONE / supplySf;
    return { usdcValueBaseUnits: value.toString(), redeemableBaseUnits: (receipt < freeReceipt ? receipt : freeReceipt).toString() };
  }

  async function capture({ wallet }) {
    const capturedAt = isoNow(now);
    let owner;
    try { owner = walletAddress(wallet); }
    catch { return noDataPortfolio(typeof wallet === 'string' ? wallet : '', capturedAt, ['INVALID_WALLET']); }
    const result = noDataPortfolio(owner, capturedAt, []);
    try {
      const snapshot = await readCurrent(owner, { allowMissingWalletAccounts: true });
      const prices = priceEvidence(snapshot, COST_PRICE_MAX_AGE_SECONDS);
      if (snapshot.walletLamports === null) fail('SOLANA_DATA_UNAVAILABLE', 'Wallet native balance account is absent.');
      const cashAccount = snapshot.walletTokenAccounts.get(supportedReserves[0].reserveAddress)?.usdc;
      if (!cashAccount) fail('SOLANA_TOKEN_ACCOUNT_UNAVAILABLE', 'Wallet native USDC associated token account is absent.');
      const positions = [];
      for (const config of supportedReserves) {
        const accounts = snapshot.walletTokenAccounts.get(config.reserveAddress);
        const reserve = snapshot.kaminoReserves.get(config.reserveAddress);
        if (!accounts?.receipt || !reserve) fail('SOLANA_TOKEN_ACCOUNT_UNAVAILABLE', 'Wallet Kamino receipt account is absent.');
        const converted = receiptAmount(reserve, accounts.receipt.amount);
        const apy = reserve.totalSupplyAPY(snapshot.ledgerInstant);
        if (!Number.isFinite(apy) || apy < 0 || apy * 10_000 > Number.MAX_SAFE_INTEGER) fail('SOLANA_DATA_INVALID', 'Current Kamino supply rate is unavailable.');
        const lastUpdateSlot = asBigInt(reserve.state.lastUpdate.slot, 'Reserve last-update slot');
        positions.push({
          reserveAddress: config.reserveAddress,
          marketAddress: config.marketAddress,
          receiptMint: snapshot.receiptMints.get(config.reserveAddress),
          receiptDecimals: snapshot.receiptMintInfo.get(config.reserveAddress).decimals,
          receiptBaseUnits: accounts.receipt.amount.toString(),
          usdcValueBaseUnits: converted.usdcValueBaseUnits,
          redeemableBaseUnits: converted.redeemableBaseUnits,
          availableLiquidityBaseUnits: reserve.state.liquidity.totalAvailableAmount.toString(),
          supplyApyBps: Math.round(apy * 10_000),
          observedAt: snapshot.observedAt,
          slot: snapshot.slot,
          reserveLastUpdateSlot: lastUpdateSlot.toString(),
          reserveLastUpdateAt: sourceTime(reserve.state.lastUpdate.timestamp),
          redeemabilityEstimate: 'LAST_REFRESHED_RESERVE_CASH_MINUS_WITHDRAW_QUEUE; SIMULATION_REQUIRED',
        });
      }
      const nativeAge = prices.nativePriceAgeSeconds;
      const usdcAge = prices.usdcPriceAgeSeconds;
      return {
        schemaVersion: 1, chain: 'solana', network: NETWORK, wallet: owner, status: 'OBSERVED',
        capturedAt: snapshot.capturedAt, observedAt: snapshot.observedAt, slot: snapshot.slot,
        nativeLamports: snapshot.walletLamports, cashBaseUnits: cashAccount.amount.toString(), positions,
        nativePriceUsdMicros: prices.nativePriceUsdMicros,
        usdcPriceUsdMicros: prices.usdcPriceUsdMicros,
        nativePriceObservedAt: prices.nativePriceObservedAt,
        usdcPriceObservedAt: prices.usdcPriceObservedAt,
        associatedAccountRentLamports: snapshot.associatedAccountRentLamports,
        nativePriceSourceReserveAddress: prices.nativePriceSourceReserveAddress,
        usdcPriceSourceReserveAddress: prices.usdcPriceSourceReserveAddress,
        nativePriceAgeSeconds: nativeAge,
        usdcPriceAgeSeconds: usdcAge,
        nativePriceSlot: snapshot.slot,
        usdcPriceSlot: snapshot.slot,
        issues: ['REDEEMABILITY_IS_AN_ESTIMATE; SIMULATION_REQUIRED'],
      };
    } catch (error) {
      result.issues = [normalizeError(error).code];
      return result;
    }
  }

  async function prepare({ wallet, action, reserveAddress, amountBaseUnits, maxFeeLamports, maxEvidenceAgeSeconds }) {
    try {
      const owner = walletAddress(wallet);
      if (!['supply', 'redeem'].includes(action)) fail('INVALID_INPUT', 'Action must be supply or redeem.');
      const config = supportedReserves.find(item => item.reserveAddress === canonicalAddress(reserveAddress, 'Reserve address'));
      if (!config) fail('INVALID_INPUT', 'Reserve is not one of the reviewed Kamino USDC reserves.');
      const amount = canonicalAmount(amountBaseUnits, 'Action amount', { positive: true });
      const feeCap = canonicalAmount(maxFeeLamports, 'Maximum fee lamports');
      const maxAge = safeInteger(maxEvidenceAgeSeconds, 'Maximum evidence age', { minimum: 1, maximum: 31_536_000 });
      const snapshot = await readCurrent(owner, { allowMissingWalletAccounts: true });
      const prices = priceEvidence(snapshot, maxAge);
      const reserve = snapshot.kaminoReserves.get(config.reserveAddress);
      const market = snapshot.marketsByAddress.get(config.marketAddress);
      const walletAccounts = snapshot.walletTokenAccounts.get(config.reserveAddress);
      if (!reserve || !market || !walletAccounts?.usdc || !walletAccounts?.receipt) {
        fail('SOLANA_TOKEN_ACCOUNT_UNAVAILABLE', 'Wallet must have its USDC and Kamino receipt associated accounts before lending.');
      }
      if (action === 'supply' && market.requiresPermissioner(PermissionedOp.fromString('DEPOSIT'), [reserve])) {
        fail('SOLANA_UNSUPPORTED_MARKET_PERMISSION', 'This Kamino reserve requires an additional market permission signer.');
      }
      if (action === 'supply' && walletAccounts.usdc.amount < amount) fail('SOLANA_INSUFFICIENT_USDC', 'Wallet USDC balance is below the requested supply.');
      if (action === 'redeem' && walletAccounts.receipt.amount < amount) fail('SOLANA_INSUFFICIENT_RECEIPTS', 'Wallet receipt balance is below the requested redeem.');
      const targetOracle = snapshot.targetObservations.get(config.reserveAddress);
      requireFreshObservation(targetOracle, maxAge, 'Kamino reserve');
      const ownerSigner = noopSigner(address(owner));
      const obligation = new VanillaObligation(address(PROGRAM_ID.toString()));
      const actionObject = action === 'supply'
        ? await KaminoAction.buildDepositReserveLiquidityTxns({
            kaminoMarket: market, amount: amount.toString(), reserveAddress: address(config.reserveAddress), owner: ownerSigner,
            obligation, scopeRefreshConfig: undefined, extraComputeBudget: 0, includeAtaIxs: false,
            requestElevationGroup: false, currentLedgerInstant: snapshot.ledgerInstant,
          })
        : await KaminoAction.buildRedeemReserveCollateralTxns({
            kaminoMarket: market, amount: amount.toString(), reserveAddress: address(config.reserveAddress), owner: ownerSigner,
            obligation, scopeRefreshConfig: undefined, extraComputeBudget: 0, includeAtaIxs: false,
            requestElevationGroup: false, currentLedgerInstant: snapshot.ledgerInstant,
          });
      const operation = KaminoAction.actionToIxs(actionObject);
      if (operation.length !== 1) fail('SOLANA_UNSUPPORTED_INSTRUCTION', 'Kamino SDK produced an unsupported top-level lending instruction set.');
      const instructions = [refreshInstruction(config, snapshot.finalReserveStates.get(config.reserveAddress)), ...operation];
      validateLendingInstructions(instructions, action, config, snapshot, amount);
      const sourceAddress = action === 'supply' ? walletAccounts.accounts.usdc : walletAccounts.accounts.receipt;
      const destinationAddress = action === 'supply' ? walletAccounts.accounts.receipt : walletAccounts.accounts.usdc;
      return await finishPreparation({
        snapshot, wallet: owner, action, reserveAddress: config.reserveAddress, amount,
        amountUnit: action === 'supply' ? 'usdc-base-units' : 'receipt-base-units', recipient: owner,
        instructions, sourceAccount: action === 'supply' ? walletAccounts.usdc : walletAccounts.receipt,
        destinationAccount: action === 'supply' ? walletAccounts.receipt : walletAccounts.usdc,
        sourceAddress, destinationAddress, maxFeeLamports: feeCap, rentLamports: 0n, prices,
        maxEvidenceAgeSeconds: maxAge, receiptMint: snapshot.receiptMints.get(config.reserveAddress),
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function prepareFeeTransfer({ wallet, recipient, amountBaseUnits, maxFeeLamports }) {
    try {
      const owner = walletAddress(wallet);
      const recipientOwner = canonicalAddress(recipient, 'Fee recipient');
      const amount = canonicalAmount(amountBaseUnits, 'Fee amount', { positive: true });
      const feeCap = canonicalAmount(maxFeeLamports, 'Maximum fee lamports');
      const snapshot = await readCurrent(owner, { allowMissingWalletAccounts: true, additionalOwners: [recipientOwner] });
      const prices = priceEvidence(snapshot, COST_PRICE_MAX_AGE_SECONDS);
      const usdcSource = snapshot.walletTokenAccounts.get(supportedReserves[0].reserveAddress)?.usdc;
      const recipientAccount = snapshot.recipientAccounts.get(recipientOwner);
      if (!usdcSource || !recipientAccount) fail('SOLANA_TOKEN_ACCOUNT_UNAVAILABLE', 'Wallet USDC source or fee-recipient ATA evidence is unavailable.');
      if (usdcSource.amount < amount) fail('SOLANA_INSUFFICIENT_USDC', 'Wallet USDC balance is below the fee amount.');
      const payer = noopSigner(address(owner));
      const instructions = [];
      let rentLamports = 0n;
      if (recipientAccount.info === null) {
        rentLamports = BigInt(snapshot.associatedAccountRentLamports);
        const [, createAta] = await createAssociatedTokenAccountIdempotentInstruction(
          payer, address(USDC_MINT), address(recipientOwner), TOKEN_PROGRAM_ADDRESS, address(recipientAccount.ata),
        );
        instructions.push(createAta);
      }
      const transfer = getTransferCheckedInstruction({
        source: address(snapshot.walletTokenAccounts.get(supportedReserves[0].reserveAddress).accounts.usdc),
        mint: address(USDC_MINT), destination: address(recipientAccount.ata), authority: payer, amount, decimals: 6,
      });
      instructions.push(transfer);
      validateFeeInstructions(instructions, snapshot, amount, usdcSource.accounts.usdc, recipientAccount.ata, recipientOwner, recipientAccount.info === null);
      return await finishPreparation({
        snapshot, wallet: owner, action: 'fee', reserveAddress: null, amount, amountUnit: 'usdc-base-units',
        recipient: recipientOwner, instructions, sourceAccount: usdcSource, destinationAccount: recipientAccount.info,
        sourceAddress: usdcSource.accounts.usdc, destinationAddress: recipientAccount.ata,
        maxFeeLamports: feeCap, rentLamports, prices, maxEvidenceAgeSeconds: COST_PRICE_MAX_AGE_SECONDS,
        receiptMint: null, feeRecipient: recipientOwner,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }


  async function policyRules({ wallet, mandate }) {
    try {
      const owner = walletAddress(wallet);
      if (!mandate || typeof mandate !== 'object' || !Array.isArray(mandate.reserves)
          || mandate.reserves.length !== supportedReserves.length) fail('INVALID_POLICY', 'Mandate reserve scope is invalid.');
      const requested = mandate.reserves.map(value => canonicalAddress(value, 'Mandate reserve'));
      if (new Set(requested).size !== supportedReserves.length
          || supportedReserves.some(config => !requested.includes(config.reserveAddress))) {
        fail('INVALID_POLICY', 'Mandate must select exactly the two reviewed USDC reserves.');
      }
      const maxAction = canonicalAmount(mandate.maxActionBaseUnits, 'Mandate maximum action amount', { positive: true });
      canonicalAmount(mandate.maxFeeLamports, 'Mandate maximum fee');
      if (typeof mandate.expiresAt !== 'string' || !Number.isFinite(Date.parse(mandate.expiresAt))
          || new Date(mandate.expiresAt).toISOString() !== mandate.expiresAt || Date.parse(mandate.expiresAt) <= Date.parse(isoNow(now))) {
        fail('INVALID_POLICY', 'Mandate expiry must be a future canonical ISO timestamp.');
      }
      const snapshot = await readCurrent(owner, { allowMissingWalletAccounts: true });
      const expiry = String(Math.floor(Date.parse(mandate.expiresAt) / 1000));
      const expiryCondition = { field_source: 'system', field: 'current_unix_timestamp', operator: 'lte', value: expiry };
      const rules = [];
      for (const config of supportedReserves) {
        const reserveState = snapshot.finalReserveStates.get(config.reserveAddress);
        const authority = snapshot.marketAuthorities.get(config.marketAddress);
        const walletAta = snapshot.walletAtas.get(config.reserveAddress);
        const receiptMint = snapshot.receiptMints.get(config.reserveAddress);
        const refreshIx = refreshInstruction(config, reserveState);
        const refreshIdl = policyIdl('refreshReserve', [2, 218, 138, 235, 79, 201, 25, 102], [
          ['reserve', true, false], ['lendingMarket', false, false], ['pythOracle', false, false],
          ['switchboardPriceOracle', false, false], ['switchboardTwapOracle', false, false], ['scopePrices', false, false],
        ]);
        const refreshNames = ['reserve', 'lendingMarket', 'pythOracle', 'switchboardPriceOracle', 'switchboardTwapOracle', 'scopePrices'];
        const refreshAddresses = refreshIx.accounts.map(meta => meta.address.toString());
        rules.push(makePolicyRule(`Kamino reserve refresh ${config.reserveAddress}`, [
          { field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: PROGRAM_ID.toString() },
          { field_source: 'solana_instruction_data', idl: refreshIdl, field: 'instruction_name', operator: 'eq', value: 'refreshReserve' },
          ...refreshNames.map((name, index) => ({
            field_source: 'solana_instruction_data', idl: refreshIdl,
            field: `refreshReserve.accounts.${name}`, operator: 'eq', value: refreshAddresses[index],
          })),
          expiryCondition,
        ]));

        const supplyIdl = policyIdl('depositReserveLiquidity', [169, 201, 30, 126, 6, 205, 102, 68], [
          ['owner', false, true], ['reserve', true, false], ['lendingMarket', false, false],
          ['lendingMarketAuthority', false, false], ['reserveLiquidityMint', false, false],
          ['reserveLiquiditySupply', true, false], ['reserveCollateralMint', true, false],
          ['userSourceLiquidity', true, false], ['userDestinationCollateral', true, false],
          ['collateralTokenProgram', false, false], ['liquidityTokenProgram', false, false], ['instructionSysvarAccount', false, false],
        ], [{ name: 'liquidityAmount', type: 'u64' }]);
        const supplyAccounts = {
          owner,
          reserve: config.reserveAddress,
          lendingMarket: config.marketAddress,
          lendingMarketAuthority: authority,
          reserveLiquidityMint: USDC_MINT,
          reserveLiquiditySupply: reserveState.liquidity.supplyVault,
          reserveCollateralMint: receiptMint,
          userSourceLiquidity: walletAta.usdc,
          userDestinationCollateral: walletAta.receipt,
          collateralTokenProgram: TOKEN_PROGRAM_ADDRESS.toString(),
          liquidityTokenProgram: reserveState.liquidity.tokenProgram,
          instructionSysvarAccount: INSTRUCTIONS_SYSVAR,
        };
        rules.push(makePolicyRule(`Kamino USDC supply ${config.reserveAddress}`, [
          { field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: PROGRAM_ID.toString() },
          { field_source: 'solana_instruction_data', idl: supplyIdl, field: 'instruction_name', operator: 'eq', value: 'depositReserveLiquidity' },
          { field_source: 'solana_instruction_data', idl: supplyIdl, field: 'depositReserveLiquidity.args.liquidityAmount', operator: 'lte', value: maxAction.toString() },
          ...Object.entries(supplyAccounts).map(([name, value]) => ({
            field_source: 'solana_instruction_data', idl: supplyIdl,
            field: `depositReserveLiquidity.accounts.${name}`, operator: 'eq', value,
          })),
          expiryCondition,
        ]));

        const redeemIdl = policyIdl('redeemReserveCollateral', [234, 117, 181, 125, 185, 142, 220, 29], [
          ['owner', false, true], ['lendingMarket', false, false], ['reserve', true, false],
          ['lendingMarketAuthority', false, false], ['reserveLiquidityMint', false, false],
          ['reserveCollateralMint', true, false], ['reserveLiquiditySupply', true, false],
          ['userSourceCollateral', true, false], ['userDestinationLiquidity', true, false],
          ['collateralTokenProgram', false, false], ['liquidityTokenProgram', false, false], ['instructionSysvarAccount', false, false],
        ], [{ name: 'collateralAmount', type: 'u64' }]);
        const redeemAccounts = {
          owner,
          lendingMarket: config.marketAddress,
          reserve: config.reserveAddress,
          lendingMarketAuthority: authority,
          reserveLiquidityMint: USDC_MINT,
          reserveCollateralMint: receiptMint,
          reserveLiquiditySupply: reserveState.liquidity.supplyVault,
          userSourceCollateral: walletAta.receipt,
          userDestinationLiquidity: walletAta.usdc,
          collateralTokenProgram: TOKEN_PROGRAM_ADDRESS.toString(),
          liquidityTokenProgram: reserveState.liquidity.tokenProgram,
          instructionSysvarAccount: INSTRUCTIONS_SYSVAR,
        };
        rules.push(makePolicyRule(`Kamino USDC redeem ${config.reserveAddress}`, [
          { field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: PROGRAM_ID.toString() },
          { field_source: 'solana_instruction_data', idl: redeemIdl, field: 'instruction_name', operator: 'eq', value: 'redeemReserveCollateral' },
          { field_source: 'solana_instruction_data', idl: redeemIdl, field: 'redeemReserveCollateral.args.collateralAmount', operator: 'lte', value: maxAction.toString() },
          ...Object.entries(redeemAccounts).map(([name, value]) => ({
            field_source: 'solana_instruction_data', idl: redeemIdl,
            field: `redeemReserveCollateral.accounts.${name}`, operator: 'eq', value,
          })),
          expiryCondition,
        ]));
      }
      return rules;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function isExpired({ prepared }) {
    if (!prepared || prepared.schemaVersion !== 1 || prepared.chain !== 'solana' || prepared.network !== NETWORK
        || prepared.source?.adapterVersion !== ADAPTER_VERSION || prepared.source?.programId !== PROGRAM_ID.toString()
        || !Number.isSafeInteger(prepared.source?.slot) || prepared.source.slot <= 0
        || !Number.isSafeInteger(prepared.lastValidBlockHeight) || prepared.lastValidBlockHeight <= 0) {
      fail('INVALID_PREPARED_ACTION', 'Prepared blockhash validity evidence is invalid.');
    }
    await assertMainnet();
    let heightValue;
    try { heightValue = await rpc.getBlockHeight({ commitment: 'finalized' }).send(); }
    catch (error) { throw normalizeError(error, 'SOLANA_BLOCK_HEIGHT_UNAVAILABLE'); }
    const height = asBigInt(heightValue, 'Finalized block height');
    return height > BigInt(prepared.lastValidBlockHeight);
  }

  async function verifySigned({ prepared, signedTransactionBase64 }) {
    const signed = decodeSignedTransaction(prepared, signedTransactionBase64);
    if (Date.parse(prepared.expiresAt) <= Date.parse(isoNow(now)) || await isExpired({ prepared })) {
      fail('SOLANA_BLOCKHASH_EXPIRED', 'Prepared transaction evidence or blockhash has expired.');
    }
    return { signature: signed.signature, signedTransactionBase64: signed.signedTransactionBase64, messageSha256: signed.messageSha256 };
  }

  async function submit({ prepared, signedTransactionBase64 }) {
    const signed = decodeSignedTransaction(prepared, signedTransactionBase64);
    if (Date.parse(prepared.expiresAt) <= Date.parse(isoNow(now)) || await isExpired({ prepared })) {
      fail('SOLANA_BLOCKHASH_EXPIRED', 'Prepared transaction evidence or blockhash has expired.');
    }
    let heightValue;
    try { heightValue = await rpc.getBlockHeight({ commitment: 'confirmed' }).send(); }
    catch (error) { throw normalizeError(error, 'SOLANA_BLOCK_HEIGHT_UNAVAILABLE'); }
    const confirmedHeight = asBigInt(heightValue, 'Confirmed block height');
    if (confirmedHeight > BigInt(prepared.lastValidBlockHeight)) fail('SOLANA_BLOCKHASH_EXPIRED', 'Blockhash expired before submission.');
    let signature;
    try {
      signature = await rpc.sendTransaction(signed.signedTransactionBase64, {
        encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0,
        minContextSlot: BigInt(prepared.source.slot),
      }).send();
    } catch {
      throw new SolanaLendingError('SUBMISSION_UNKNOWN', 'Submission outcome is unknown; reconcile the retained exact transaction.');
    }
    if (signature !== signed.signature) throw new SolanaLendingError('SUBMISSION_UNKNOWN', 'RPC returned a different signature; reconcile the retained transaction.');
    return { signature: signed.signature };
  }

  async function reconcile({ prepared, signature }) {
    const result = { status: 'UNVERIFIED', signature, slot: null, amounts: null, reason: null };
    try {
      if (typeof signature !== 'string' || !BASE58_SIGNATURE_RE.test(signature)) fail('SOLANA_RECEIPT_MISMATCH', 'Transaction signature format is invalid.');
      if (!prepared || prepared.schemaVersion !== 1 || prepared.chain !== 'solana' || prepared.network !== NETWORK
          || prepared.source?.adapterVersion !== ADAPTER_VERSION || prepared.source?.programId !== PROGRAM_ID.toString()
          || !SHA256_RE.test(prepared.messageSha256) || !Number.isSafeInteger(prepared.lastValidBlockHeight)) {
        fail('INVALID_PREPARED_ACTION', 'Prepared transaction evidence is invalid.');
      }
      await assertMainnet();
      const receipt = await rpc.getTransaction(signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }).send();
      if (receipt === null) {
        const height = asBigInt(await rpc.getBlockHeight({ commitment: 'confirmed' }).send(), 'Confirmed block height');
        if (height <= BigInt(prepared.lastValidBlockHeight)) {
          result.status = 'PENDING';
          result.reason = 'No finalized receipt is available while its blockhash may still be valid.';
        } else result.reason = 'No finalized receipt is available after blockhash expiry; absence does not prove non-execution.';
        return result;
      }
      if (!Number.isSafeInteger(Number(receipt.slot)) || Number(receipt.slot) <= 0 || receipt.version !== 0
          || !Array.isArray(receipt.transaction) || receipt.transaction.length !== 2 || receipt.transaction[1] !== 'base64'
          || !receipt.meta || !Object.hasOwn(receipt.meta, 'err')) fail('SOLANA_RECEIPT_UNVERIFIED', 'Finalized transaction receipt is incomplete.');
      const signed = decodeSignedTransaction(prepared, receipt.transaction[0]);
      if (signed.signature !== signature) fail('SOLANA_RECEIPT_MISMATCH', 'Finalized transaction identity does not match the submitted signature.');
      result.slot = Number(receipt.slot);
      const meta = receipt.meta;
      if (meta.err !== null) {
        let failedFee = null;
        try { failedFee = asBigInt(meta.fee, 'Finalized failed-transaction fee'); } catch {}
        result.status = 'FAILED';
        if (failedFee === null) {
          result.reason = 'Finalized transaction failed and token effects were rolled back, but exact network fee evidence is unavailable.';
          return result;
        }
        const cost = receiptCost(prepared, receipt, failedFee, 0n);
        result.amounts = {
          usdcDebitBaseUnits: '0', usdcCreditBaseUnits: '0', receiptDebitBaseUnits: '0', receiptCreditBaseUnits: '0',
          feeLamports: failedFee.toString(), rentLamports: '0', costUsdcBaseUnits: cost,
        };
        result.reason = cost === null
          ? 'Finalized transaction failed; atomic rollback proves zero token effects, but native cost valuation is unavailable.'
          : 'Finalized transaction failed; atomic rollback proves zero token effects and the actual network fee is valued.';
        return result;
      }
      const fee = asBigInt(meta.fee, 'Finalized network fee');
      const effects = ownerTokenDeltas(prepared, signed.transaction, meta);
      if (prepared.action === 'fee') {
        const recipientCredit = tokenBalanceDelta(meta, signed.transaction, prepared.destinationTokenAccount, USDC_MINT, prepared.recipient, BigInt(prepared.rentLamports) > 0n);
        if (recipientCredit !== BigInt(prepared.amountBaseUnits)) fail('SOLANA_RECEIPT_MISMATCH', 'Finalized fee recipient credit differs from the exact transfer amount.');
      }
      validateFinalEffects(prepared, effects);
      const walletLamportDebit = ownerLamportDebit(prepared.wallet, signed.transaction, meta);
      if (walletLamportDebit < fee) fail('SOLANA_RECEIPT_MISMATCH', 'Finalized wallet balance delta is smaller than the network fee.');
      const rent = walletLamportDebit - fee;
      if (rent !== BigInt(prepared.rentLamports) || fee > BigInt(prepared.costEvidence.maxFeeLamports)) {
        fail('SOLANA_RECEIPT_MISMATCH', 'Finalized fee or rent exceeds prepared cost evidence.');
      }
      const cost = receiptCost(prepared, receipt, fee, rent);
      result.status = 'CONFIRMED';
      result.amounts = { ...effects, feeLamports: fee.toString(), rentLamports: rent.toString(), costUsdcBaseUnits: cost };
      result.reason = cost === null
        ? 'Exact finalized transaction and owner-local token effects verified; native cost valuation is unavailable.'
        : 'Exact finalized transaction, owner-local token effects, and actual native costs verified.';
      return result;
    } catch (error) {
      result.status = 'UNVERIFIED';
      result.amounts = null;
      result.reason = normalizeError(error, 'SOLANA_RECEIPT_UNVERIFIED').code;
      return result;
    }
  }

  return Object.freeze({ capture, prepare, prepareFeeTransfer, verifySigned, submit, reconcile, policyRules, isExpired });
}



function tokenBalance(list, transaction, account, mint, owner, allowMissing = false) {
  if (!Array.isArray(list)) fail('SOLANA_RECEIPT_UNVERIFIED', 'Finalized token balance evidence is unavailable.');
  const accountIndex = transaction.message.staticAccountKeys.findIndex(key => key.toBase58() === account);
  if (accountIndex < 0) fail('SOLANA_RECEIPT_MISMATCH', 'Expected wallet token account is not in the transaction.');
  const entries = list.filter(item => item?.accountIndex === accountIndex);
  if (entries.length === 0 && allowMissing) return 0n;
  if (entries.length !== 1) fail('SOLANA_RECEIPT_UNVERIFIED', 'Finalized token balance entry is missing or duplicated.');
  const item = entries[0];
  if (item.mint !== mint || item.owner !== owner || item.programId !== TOKEN_PROGRAM_ADDRESS.toString()
      || item.uiTokenAmount?.decimals !== 6 || typeof item.uiTokenAmount.amount !== 'string'
      || !CANONICAL_U64_RE.test(item.uiTokenAmount.amount)) {
    fail('SOLANA_RECEIPT_MISMATCH', 'Finalized token balance identity differs from the prepared wallet action.');
  }
  return BigInt(item.uiTokenAmount.amount);
}

function tokenBalanceDelta(meta, transaction, account, mint, owner, allowMissingPre = false) {
  return tokenBalance(meta.postTokenBalances, transaction, account, mint, owner, false)
    - tokenBalance(meta.preTokenBalances, transaction, account, mint, owner, allowMissingPre);
}

function ownerTokenDeltas(prepared, transaction, meta) {
  const usdcAccount = prepared.action === 'supply' ? prepared.sourceTokenAccount
    : prepared.action === 'redeem' ? prepared.destinationTokenAccount : prepared.sourceTokenAccount;
  const usdcDelta = tokenBalanceDelta(meta, transaction, usdcAccount, USDC_MINT, prepared.wallet);
  let receiptDelta = 0n;
  if (prepared.action === 'supply') receiptDelta = tokenBalanceDelta(meta, transaction, prepared.destinationTokenAccount, prepared.receiptMint, prepared.wallet);
  else if (prepared.action === 'redeem') receiptDelta = tokenBalanceDelta(meta, transaction, prepared.sourceTokenAccount, prepared.receiptMint, prepared.wallet);
  return {
    usdcDebitBaseUnits: (usdcDelta < 0n ? -usdcDelta : 0n).toString(),
    usdcCreditBaseUnits: (usdcDelta > 0n ? usdcDelta : 0n).toString(),
    receiptDebitBaseUnits: (receiptDelta < 0n ? -receiptDelta : 0n).toString(),
    receiptCreditBaseUnits: (receiptDelta > 0n ? receiptDelta : 0n).toString(),
  };
}

function validateFinalEffects(prepared, effects) {
  const amount = BigInt(prepared.amountBaseUnits);
  if (prepared.action === 'supply') {
    if (effects.usdcDebitBaseUnits !== amount.toString() || effects.usdcCreditBaseUnits !== '0'
        || effects.receiptDebitBaseUnits !== '0' || BigInt(effects.receiptCreditBaseUnits) <= 0n) {
      fail('SOLANA_RECEIPT_MISMATCH', 'Finalized supply owner-local token deltas do not match.');
    }
  } else if (prepared.action === 'redeem') {
    if (effects.usdcDebitBaseUnits !== '0' || BigInt(effects.usdcCreditBaseUnits) <= 0n
        || effects.receiptDebitBaseUnits !== amount.toString() || effects.receiptCreditBaseUnits !== '0') {
      fail('SOLANA_RECEIPT_MISMATCH', 'Finalized redeem owner-local token deltas do not match.');
    }
  } else if (effects.usdcDebitBaseUnits !== amount.toString() || effects.usdcCreditBaseUnits !== '0'
      || effects.receiptDebitBaseUnits !== '0' || effects.receiptCreditBaseUnits !== '0') {
    fail('SOLANA_RECEIPT_MISMATCH', 'Finalized owner fee token deltas do not match.');
  }
}

function walletLamportDebit(wallet, transaction, meta) {
  if (!Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances) || meta.preBalances.length !== meta.postBalances.length) {
    fail('SOLANA_RECEIPT_UNVERIFIED', 'Finalized native balance evidence is unavailable.');
  }
  const index = transaction.message.staticAccountKeys.findIndex(key => key.toBase58() === wallet);
  if (index < 0 || index >= meta.preBalances.length) fail('SOLANA_RECEIPT_MISMATCH', 'Wallet fee payer is absent from finalized balances.');
  const before = asBigInt(meta.preBalances[index], 'Finalized pre-transaction lamports');
  const after = asBigInt(meta.postBalances[index], 'Finalized post-transaction lamports');
  if (before < after) fail('SOLANA_RECEIPT_MISMATCH', 'Wallet native balance unexpectedly increased.');
  return before - after;
}

function receiptCost(prepared, receipt, fee, rent) {
  if (!prepared.nativePriceUsdMicros || !prepared.usdcPriceUsdMicros
      || !prepared.nativePriceObservedAt || !prepared.usdcPriceObservedAt
      || !Number.isSafeInteger(Number(receipt.blockTime)) || Number(receipt.blockTime) <= 0) return null;
  const ageLimit = Number(prepared.costEvidence?.priceMaxAgeSeconds);
  if (!Number.isSafeInteger(ageLimit) || ageLimit < 1) return null;
  const blockTime = Number(receipt.blockTime);
  const nativeTime = Math.floor(Date.parse(prepared.nativePriceObservedAt) / 1000);
  const usdcTime = Math.floor(Date.parse(prepared.usdcPriceObservedAt) / 1000);
  if (nativeTime > blockTime || usdcTime > blockTime || blockTime - nativeTime > ageLimit || blockTime - usdcTime > ageLimit) return null;
  return costUsdcBaseUnits(fee + rent, prepared.nativePriceUsdMicros, prepared.usdcPriceUsdMicros);
}

function noDataPortfolio(wallet, capturedAt, issues) {
  return {
    schemaVersion: 1, chain: 'solana', network: NETWORK, wallet, status: 'NO_DATA', capturedAt,
    observedAt: null, slot: null, nativeLamports: null, cashBaseUnits: null, positions: [], issues,
    nativePriceUsdMicros: null, usdcPriceUsdMicros: null,
    nativePriceObservedAt: null, usdcPriceObservedAt: null,
    associatedAccountRentLamports: null,
  };
}

function policyIdl(instructionName, discriminator, accounts, args = []) {
  return {
    address: PROGRAM_ID.toString(),
    metadata: { name: 'kamino_lending', version: '1.25.0', spec: '0.1.0' },
    instructions: [{ name: instructionName, discriminator, accounts: accounts.map(([name, writable, signer]) => ({ name, writable, signer })), args }],
  };
}

function policyRule(name, conditions) {
  return { name, method: 'signTransaction', conditions, action: 'ALLOW' };
}
