export const CLUSTERS = {
  surfpool: 'http://127.0.0.1:18488',
  devnet: 'https://api.devnet.solana.com',
};

const ALLOWED_RPCS = new Set(Object.values(CLUSTERS));
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_U64 = 18446744073709551615n;
const CPMM_POOL_STATE_DISCRIMINATOR = Uint8Array.from([0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46]);
const DEVNET_CPMM_PROGRAMS = new Set([
  'CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW',
  'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb',
]);

export function isAllowedRpc(url) {
  return ALLOWED_RPCS.has(url);
}

function decodePublicKey(value, name) {
  if (typeof value !== 'string' || !value || [...value].some((char) => !BASE58.includes(char))) {
    throw new Error((name || 'public key') + ' is invalid');
  }
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(BASE58.indexOf(char));
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  for (let index = 0; index < value.length && value[index] === '1'; index += 1) bytes.push(0);
  bytes.reverse();
  if (bytes.length !== 32) throw new Error((name || 'public key') + ' is invalid');
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
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function rpcCall(url, method, params, timeoutMs = 5000) {
  if (!isAllowedRpc(url)) throw new Error('RPC target is not allowed');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body && body.error && body.error.message ? body.error.message : 'rpc HTTP ' + response.status);
    }
    if (!body || typeof body !== 'object' || body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) {
      throw new Error(body && body.error && body.error.message ? body.error.message : 'rpc response is incomplete');
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body && body.msg ? body.msg : 'HTTP ' + response.status);
    }
    if (!body || typeof body !== 'object') throw new Error('service response is incomplete');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function readAccount(url, address) {
  decodePublicKey(address, 'account address');
  const result = await rpcCall(url, 'getAccountInfo', [address, { encoding: 'base64' }]);
  if (!result || !Object.prototype.hasOwnProperty.call(result, 'value')) throw new Error('account response is incomplete');
  return result.value || null;
}

export async function getLatestBlockhash(url) {
  const result = await rpcCall(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const value = result && result.value;
  if (!value || typeof value.blockhash !== 'string' || !value.blockhash || !Number.isSafeInteger(value.lastValidBlockHeight)) {
    throw new Error('blockhash response is incomplete');
  }
  return value;
}

export async function getBlockHeight(url) {
  const height = await rpcCall(url, 'getBlockHeight', [{ commitment: 'confirmed' }]);
  if (!Number.isSafeInteger(height) || height < 0) throw new Error('block height response is incomplete');
  return height;
}

export async function getTokenAccountForMint(url, owner, mint) {
  decodePublicKey(owner, 'wallet address');
  decodePublicKey(mint, 'token mint');
  const result = await rpcCall(url, 'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!result || !Array.isArray(result.value)) throw new Error('token account response is incomplete');
  const account = result.value.find((item) => item && typeof item.pubkey === 'string');
  return account ? account.pubkey : null;
}

export async function simulateEncoded(url, base64Tx) {
  if (typeof base64Tx !== 'string' || !base64Tx) throw new Error('simulation transaction is missing');
  const result = await rpcCall(url, 'simulateTransaction', [
    base64Tx,
    { encoding: 'base64', replaceRecentBlockhash: false, sigVerify: false },
  ]);
  const value = result && result.value;
  if (!value || !Object.prototype.hasOwnProperty.call(value, 'err')) throw new Error('simulation response is incomplete');
  if (value.err !== null) throw new Error('simulation failed: ' + JSON.stringify(value.err));
  return value;
}

export async function sendEncoded(url, base64Tx) {
  if (typeof base64Tx !== 'string' || !base64Tx) throw new Error('signed transaction is missing');
  const signature = await rpcCall(url, 'sendTransaction', [base64Tx, { encoding: 'base64', skipPreflight: false }]);
  if (typeof signature !== 'string' || !signature) throw new Error('send response has no signature');
  return signature;
}

export async function getSignatureStatus(url, signature, timeoutMs = 5000) {
  if (typeof signature !== 'string' || !signature) throw new Error('transaction signature is missing');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('signature status timeout is invalid');
  const result = await rpcCall(url, 'getSignatureStatuses', [
    [signature],
    { searchTransactionHistory: true },
  ], timeoutMs);
  if (!result || !Array.isArray(result.value) || result.value.length !== 1) {
    throw new Error('signature status response is incomplete');
  }
  const status = result.value[0];
  if (status === null) return null;
  if (!status || typeof status !== 'object' || !Object.prototype.hasOwnProperty.call(status, 'err')) {
    throw new Error('signature status response is incomplete');
  }
  if (status.confirmationStatus !== undefined && status.confirmationStatus !== null && typeof status.confirmationStatus !== 'string') {
    throw new Error('signature status response is incomplete');
  }
  return { err: status.err, confirmationStatus: status.confirmationStatus || null };
}

export async function waitForConfirmation(url, signature, { timeoutMs = 30000, pollIntervalMs = 1000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error('signature polling interval is invalid');
  }
  const deadline = Date.now() + timeoutMs;
  let firstPoll = true;
  for (;;) {
    const remainingBeforePoll = deadline - Date.now();
    if (!firstPoll && remainingBeforePoll <= 0) return { status: 'pending' };
    firstPoll = false;
    const requestTimeout = Math.max(1, Math.min(5000, remainingBeforePoll));
    const status = await getSignatureStatus(url, signature, requestTimeout);
    if (status && status.err !== null) return { status: 'failed', err: status.err };
    if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus)) {
      return { status: 'confirmed', confirmationStatus: status.confirmationStatus };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: 'pending' };
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
  }
}

export const JUPITER_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
export const JUPITER_SWAP = 'https://lite-api.jup.ag/swap/v1/swap';
export const RAYDIUM_DEVNET_API = 'https://transaction-v1-devnet.raydium.io';
export const RAYDIUM_DEVNET_FEE_API = 'https://api-v3-devnet.raydium.io/main/auto-fee';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const OPENAI_MINT = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF';
export const SPACEX_MINT = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh';
const SURFPOOL_ASSET_MINTS = new Set([OPENAI_MINT, SPACEX_MINT]);

function validAmount(amount) {
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new Error('quote amount is invalid');
  const amountUnits = BigInt(amount);
  if (amountUnits <= 0n || amountUnits > MAX_U64) throw new Error('quote amount is invalid');
}

async function assertDevnetCpmmPool({ poolId, inputMint, outputMint }) {
  decodePublicKey(poolId, 'Devnet pool ID');
  const inputMintBytes = decodePublicKey(inputMint, 'input mint');
  const outputMintBytes = decodePublicKey(outputMint, 'output mint');
  if (bytesEqual(inputMintBytes, outputMintBytes)) throw new Error('input and output mints must differ');

  const account = await readAccount(CLUSTERS.devnet, poolId);
  if (!account || !DEVNET_CPMM_PROGRAMS.has(account.owner)) throw new Error('configured Devnet pool is missing or is not a Raydium CPMM pool');
  if (!Array.isArray(account.data) || typeof account.data[0] !== 'string' || account.data[1] !== 'base64') {
    throw new Error('Devnet CPMM pool state is incomplete');
  }
  const state = base64ToBytes(account.data[0]);
  if (state.length < 232 || !bytesEqual(state.subarray(0, 8), CPMM_POOL_STATE_DISCRIMINATOR)) {
    throw new Error('configured Devnet account is not a CPMM pool state');
  }
  const mintA = state.subarray(168, 200);
  const mintB = state.subarray(200, 232);
  const pairMatches = (bytesEqual(inputMintBytes, mintA) && bytesEqual(outputMintBytes, mintB))
    || (bytesEqual(inputMintBytes, mintB) && bytesEqual(outputMintBytes, mintA));
  if (!pairMatches) throw new Error('input and output mints do not match the configured Devnet pool');
}

function validateRaydiumQuote(quote, { poolId, inputMint, outputMint, amount }) {
  validAmount(amount);
  if (!quote || quote.success !== true || !quote.data) throw new Error('Raydium quote response is incomplete');
  const data = quote.data;
  if (data.inputMint !== inputMint || data.outputMint !== outputMint || data.inputAmount !== amount) {
    throw new Error('Raydium quote does not match the requested trade');
  }
  if (typeof data.outputAmount !== 'string' || !/^\d+$/.test(data.outputAmount) || BigInt(data.outputAmount) <= 0n) {
    throw new Error('Raydium quote has no output amount');
  }
  if (!Array.isArray(data.routePlan) || data.routePlan.length !== 1) {
    throw new Error('Raydium quote must use exactly one pool route');
  }
  const [route] = data.routePlan;
  if (!route || route.poolId !== poolId || route.inputMint !== inputMint || route.outputMint !== outputMint) {
    throw new Error('Raydium route does not match the configured pool and mint direction');
  }
  return quote;
}

async function getDevnetQuote({ poolId, inputMint, outputMint, amount }) {
  await assertDevnetCpmmPool({ poolId, inputMint, outputMint });
  validAmount(amount);
  const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: '50', txVersion: 'V0' });
  const quote = await fetchJson(RAYDIUM_DEVNET_API + '/compute/swap-base-in?' + query.toString());
  return validateRaydiumQuote(quote, { poolId, inputMint, outputMint, amount });
}

export async function getQuote({ target = 'surfpool', poolId, inputMint, outputMint, amount }) {
  if (target === 'devnet') return getDevnetQuote({ poolId, inputMint, outputMint, amount });
  if (target !== 'surfpool') throw new Error('trade target is not supported');
  if (inputMint !== USDC_MINT || !SURFPOOL_ASSET_MINTS.has(outputMint)) throw new Error('quote mints are not supported');
  validAmount(amount);
  const quoteUrl = new URL(JUPITER_QUOTE);
  quoteUrl.search = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: '50' });
  const quote = await fetchJson(quoteUrl);
  if (!quote || typeof quote.outAmount !== 'string' || !/^\d+$/.test(quote.outAmount)) throw new Error('quote response has no output amount');
  return quote;
}

async function getDevnetPriorityFee() {
  const response = await fetchJson(RAYDIUM_DEVNET_FEE_API);
  const fee = response.data && response.data.default && response.data.default.h;
  if ((!Number.isSafeInteger(fee) && typeof fee !== 'string') || !/^\d+$/.test(String(fee))) {
    throw new Error('Raydium priority fee response is incomplete');
  }
  return String(fee);
}

async function buildDevnetUnsignedSwap({ quoteResponse, userPublicKey, poolId, inputMint, outputMint, amount }) {
  await assertDevnetCpmmPool({ poolId, inputMint, outputMint });
  validateRaydiumQuote(quoteResponse, { poolId, inputMint, outputMint, amount });
  const inputAccount = await getTokenAccountForMint(CLUSTERS.devnet, userPublicKey, inputMint);
  if (!inputAccount) throw new Error('Connected wallet has no Devnet input token account for this mint');
  const outputAccount = await getTokenAccountForMint(CLUSTERS.devnet, userPublicKey, outputMint);
  const computeUnitPriceMicroLamports = await getDevnetPriorityFee();
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
  const response = await fetchJson(RAYDIUM_DEVNET_API + '/transaction/swap-base-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.success !== true || !Array.isArray(response.data) || response.data.length !== 1) {
    throw new Error('Raydium must return exactly one unsigned transaction');
  }
  const transaction = response.data[0] && response.data[0].transaction;
  if (typeof transaction !== 'string' || !transaction) throw new Error('Raydium returned no serialized transaction');
  base64ToBytes(transaction);
  return transaction;
}

export async function buildUnsignedSwap({ target = 'surfpool', quoteResponse, userPublicKey, poolId, inputMint, outputMint, amount }) {
  decodePublicKey(userPublicKey, 'wallet address');
  if (target === 'devnet') {
    return buildDevnetUnsignedSwap({ quoteResponse, userPublicKey, poolId, inputMint, outputMint, amount });
  }
  if (target !== 'surfpool') throw new Error('trade target is not supported');
  if (!quoteResponse || typeof quoteResponse.outAmount !== 'string' || !/^\d+$/.test(quoteResponse.outAmount)) {
    throw new Error('quote response is invalid');
  }
  const swapResponse = await fetchJson(JUPITER_SWAP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true }),
  });
  if (typeof swapResponse.swapTransaction !== 'string' || !swapResponse.swapTransaction) {
    throw new Error('swap response has no serialized transaction');
  }
  base64ToBytes(swapResponse.swapTransaction);
  return swapResponse.swapTransaction;
}
