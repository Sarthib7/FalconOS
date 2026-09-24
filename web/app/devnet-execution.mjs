import { DEVNET_RPC } from './data.mjs';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_U64 = 18446744073709551615n;
const MAX_ROUTE_LEGS = 4;
const POOL_STATE_DISCRIMINATOR = Uint8Array.from([0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46]);
const POOL_LAYOUTS = new Map([
  ['CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW', { name: 'CPMM', mintAOffset: 168, mintBOffset: 200, minLength: 232, anchorState: true }],
  ['DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb', { name: 'CPMM', mintAOffset: 168, mintBOffset: 200, minLength: 232, anchorState: true }],
  ['DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH', { name: 'CLMM', mintAOffset: 73, mintBOffset: 105, minLength: 137, anchorState: true }],
  ['DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav', { name: 'AMM V4', mintAOffset: 400, mintBOffset: 432, minLength: 752, exactLength: 752 }],
]);
const RAYDIUM_API = 'https://transaction-v1-devnet.raydium.io';
const RAYDIUM_FEE_API = 'https://api-v3-devnet.raydium.io/main/auto-fee';

function decodePublicKey(value, name) {
  if (typeof value !== 'string' || !value || [...value].some((character) => !BASE58.includes(character))) {
    throw new Error(`${name || 'public key'} is invalid`);
  }
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  for (let index = 0; index < value.length && value[index] === '1'; index += 1) bytes.push(0);
  bytes.reverse();
  if (bytes.length !== 32) throw new Error(`${name || 'public key'} is invalid`);
  return Uint8Array.from(bytes);
}

function bytesEqual(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('base64 data is invalid');
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function rpc(method, params, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(DEVNET_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || `Devnet RPC HTTP ${response.status}`);
    if (!body || body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) {
      throw new Error(body?.error?.message || 'Devnet RPC response is incomplete');
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function raydiumJson(url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.msg || `Raydium Devnet HTTP ${response.status}`);
    if (!body || typeof body !== 'object') throw new Error('Raydium Devnet response is incomplete');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function validateRoute(routePlan, inputMint, outputMint) {
  if (!Array.isArray(routePlan) || routePlan.length < 1 || routePlan.length > MAX_ROUTE_LEGS) {
    throw new Error(`Raydium route must contain 1 to ${MAX_ROUTE_LEGS} pool legs`);
  }
  decodePublicKey(inputMint, 'input mint');
  decodePublicKey(outputMint, 'output mint');
  if (inputMint === outputMint) throw new Error('input and output mints must differ');
  const seenPools = new Set();
  let nextMint = inputMint;
  const legs = routePlan.map((route) => {
    if (!route || typeof route !== 'object') throw new Error('Raydium route leg is incomplete');
    decodePublicKey(route.poolId, 'Devnet pool ID');
    decodePublicKey(route.inputMint, 'route input mint');
    decodePublicKey(route.outputMint, 'route output mint');
    if (seenPools.has(route.poolId)) throw new Error('Raydium route repeats a pool');
    if (route.inputMint !== nextMint || route.inputMint === route.outputMint) {
      throw new Error('Raydium route mint sequence is disconnected');
    }
    seenPools.add(route.poolId);
    nextMint = route.outputMint;
    return { poolId: route.poolId, inputMint: route.inputMint, outputMint: route.outputMint };
  });
  if (nextMint !== outputMint) throw new Error('Raydium route does not end at the requested output mint');
  return legs;
}

async function assertRoutePools(routePlan) {
  const poolIds = routePlan.map((route) => route.poolId);
  const result = await rpc('getMultipleAccounts', [poolIds, { encoding: 'base64' }]);
  if (!result || !Array.isArray(result.value) || result.value.length !== routePlan.length) {
    throw new Error('Devnet pool account response is incomplete');
  }
  for (let index = 0; index < routePlan.length; index += 1) {
    const route = routePlan[index];
    const account = result.value[index];
    const layout = POOL_LAYOUTS.get(account?.owner);
    if (!account || !layout) throw new Error('Raydium route contains a missing or unsupported Devnet pool');
    if (!Array.isArray(account.data) || typeof account.data[0] !== 'string' || account.data[1] !== 'base64') {
      throw new Error(`Devnet Raydium ${layout.name} pool state is incomplete`);
    }
    const state = base64ToBytes(account.data[0]);
    if (state.length < layout.minLength || layout.exactLength && state.length !== layout.exactLength
      || layout.anchorState && !bytesEqual(state.subarray(0, 8), POOL_STATE_DISCRIMINATOR)) {
      throw new Error(`Devnet account is not a Raydium ${layout.name} pool state`);
    }
    const mintA = state.subarray(layout.mintAOffset, layout.mintAOffset + 32);
    const mintB = state.subarray(layout.mintBOffset, layout.mintBOffset + 32);
    const inputBytes = decodePublicKey(route.inputMint, 'route input mint');
    const outputBytes = decodePublicKey(route.outputMint, 'route output mint');
    const pairMatches = bytesEqual(inputBytes, mintA) && bytesEqual(outputBytes, mintB)
      || bytesEqual(inputBytes, mintB) && bytesEqual(outputBytes, mintA);
    if (!pairMatches) throw new Error('Raydium route leg does not match its live Devnet pool mint pair');
  }
}

function validAmount(amount) {
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new Error('quote amount is invalid');
  const units = BigInt(amount);
  if (units <= 0n || units > MAX_U64) throw new Error('quote amount is invalid');
}

function validateQuote(quote, { inputMint, outputMint, amount }) {
  validAmount(amount);
  if (!quote || quote.success !== true || !quote.data) throw new Error('Raydium quote response is incomplete');
  const data = quote.data;
  if (data.inputMint !== inputMint || data.outputMint !== outputMint || data.inputAmount !== amount) {
    throw new Error('Raydium quote does not match the requested trade');
  }
  if (typeof data.outputAmount !== 'string' || !/^\d+$/.test(data.outputAmount) || BigInt(data.outputAmount) <= 0n) {
    throw new Error('Raydium quote has no output amount');
  }
  validateRoute(data.routePlan, inputMint, outputMint);
  return quote;
}

export async function getDevnetQuote({ inputMint, outputMint, amount }) {
  validAmount(amount);
  const inputBytes = decodePublicKey(inputMint, 'input mint');
  const outputBytes = decodePublicKey(outputMint, 'output mint');
  if (bytesEqual(inputBytes, outputBytes)) throw new Error('input and output mints must differ');
  const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: '50', txVersion: 'V0' });
  const quote = await raydiumJson(`${RAYDIUM_API}/compute/swap-base-in?${query}`);
  validateQuote(quote, { inputMint, outputMint, amount });
  await assertRoutePools(quote.data.routePlan);
  return quote;
}

export async function getDevnetBlockhash() {
  const result = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const value = result?.value;
  if (!value || typeof value.blockhash !== 'string' || !value.blockhash || !Number.isSafeInteger(value.lastValidBlockHeight)) {
    throw new Error('Devnet blockhash response is incomplete');
  }
  return value;
}

export async function getDevnetBlockHeight() {
  const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
  if (!Number.isSafeInteger(height) || height < 0) throw new Error('Devnet block height response is incomplete');
  return height;
}

async function tokenAccountForMint(owner, mint) {
  decodePublicKey(owner, 'wallet address');
  decodePublicKey(mint, 'token mint');
  const result = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!result || !Array.isArray(result.value)) throw new Error('Devnet token account response is incomplete');
  const account = result.value.find((item) => item && typeof item.pubkey === 'string');
  if (account) decodePublicKey(account.pubkey, 'Devnet token account');
  return account ? account.pubkey : null;
}

export async function simulateDevnet(base64Transaction) {
  if (typeof base64Transaction !== 'string' || !base64Transaction) throw new Error('simulation transaction is missing');
  const result = await rpc('simulateTransaction', [base64Transaction, {
    encoding: 'base64', replaceRecentBlockhash: false, sigVerify: false,
  }]);
  const value = result?.value;
  if (!value || !Object.prototype.hasOwnProperty.call(value, 'err')) throw new Error('Devnet simulation response is incomplete');
  if (value.err !== null) throw new Error(`Devnet simulation failed: ${JSON.stringify(value.err)}`);
  return value;
}

export async function sendDevnet(base64Transaction) {
  if (typeof base64Transaction !== 'string' || !base64Transaction) throw new Error('signed transaction is missing');
  const signature = await rpc('sendTransaction', [base64Transaction, { encoding: 'base64', skipPreflight: false }]);
  if (typeof signature !== 'string' || !signature) throw new Error('Devnet send response has no signature');
  return signature;
}

export async function waitForDevnetConfirmation(signature, { timeoutMs = 30000, pollIntervalMs = 1000 } = {}) {
  if (typeof signature !== 'string' || !signature) throw new Error('transaction signature is missing');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error('signature polling interval is invalid');
  }
  const deadline = Date.now() + timeoutMs;
  let firstPoll = true;
  for (;;) {
    const remainingBeforePoll = deadline - Date.now();
    if (!firstPoll && remainingBeforePoll <= 0) return { status: 'pending' };
    firstPoll = false;
    const result = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }], Math.max(1, Math.min(5000, remainingBeforePoll)));
    if (!result || !Array.isArray(result.value) || result.value.length !== 1) throw new Error('Devnet signature status response is incomplete');
    const status = result.value[0];
    if (status !== null) {
      if (typeof status !== 'object' || !Object.prototype.hasOwnProperty.call(status, 'err')) {
        throw new Error('Devnet signature status response is incomplete');
      }
      if (status.err !== null) return { status: 'failed', err: status.err };
      if (['confirmed', 'finalized'].includes(status.confirmationStatus)) {
        return { status: 'confirmed', confirmationStatus: status.confirmationStatus };
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: 'pending' };
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
  }
}

async function priorityFee() {
  const response = await raydiumJson(RAYDIUM_FEE_API);
  const fee = response.data?.default?.h;
  if ((!Number.isSafeInteger(fee) && typeof fee !== 'string') || !/^\d+$/.test(String(fee))) {
    throw new Error('Raydium Devnet priority fee response is incomplete');
  }
  return String(fee);
}

export async function buildDevnetUnsignedSwap({ quoteResponse, userPublicKey, inputMint, outputMint, amount }) {
  decodePublicKey(userPublicKey, 'wallet address');
  validateQuote(quoteResponse, { inputMint, outputMint, amount });
  await assertRoutePools(quoteResponse.data.routePlan);
  const inputAccount = await tokenAccountForMint(userPublicKey, inputMint);
  if (!inputAccount) throw new Error('Connected wallet has no Devnet input token account for this mint');
  const outputAccount = await tokenAccountForMint(userPublicKey, outputMint);
  const computeUnitPriceMicroLamports = await priorityFee();
  const body = {
    computeUnitPriceMicroLamports,
    swapResponse: quoteResponse,
    txVersion: 'V0',
    wallet: userPublicKey,
    wrapSol: false,
    unwrapSol: false,
    inputAccount,
  };
  if (outputAccount) body.outputAccount = outputAccount;
  const response = await raydiumJson(`${RAYDIUM_API}/transaction/swap-base-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.success !== true || !Array.isArray(response.data) || response.data.length !== 1) {
    throw new Error('Raydium must return exactly one unsigned transaction');
  }
  const transaction = response.data[0]?.transaction;
  if (typeof transaction !== 'string' || !transaction) throw new Error('Raydium returned no serialized transaction');
  base64ToBytes(transaction);
  return transaction;
}
