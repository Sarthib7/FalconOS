export const CLUSTERS = {
  surfpool: 'http://127.0.0.1:8899',
};

const ALLOWED = new Set(Object.values(CLUSTERS));

export function isAllowedRpc(url) {
  return ALLOWED.has(url);
}

async function rpcCall(url, method, params, timeoutMs = 5000) {
  if (!isAllowedRpc(url)) throw new Error('RPC is not Surfpool');
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

export async function readAccount(url, address) {
  const result = await rpcCall(url, 'getAccountInfo', [address, { encoding: 'base64' }]);
  if (!result || !Object.prototype.hasOwnProperty.call(result, 'value')) throw new Error('account response is incomplete');
  return result && result.value ? result.value : null;
}

export async function getLatestBlockhash(url) {
  const result = await rpcCall(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const value = result && result.value;
  if (!value || typeof value.blockhash !== 'string' || !value.blockhash || !Number.isSafeInteger(value.lastValidBlockHeight)) {
    throw new Error('blockhash response is incomplete');
  }
  return value;
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
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const OPENAI_MINT = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF';
export const SPACEX_MINT = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh';
const ASSET_MINTS = new Set([OPENAI_MINT, SPACEX_MINT]);
const MAX_U64 = 18446744073709551615n;

export async function getQuote({ inputMint, outputMint, amount }) {
  if (inputMint !== USDC_MINT || !ASSET_MINTS.has(outputMint)) throw new Error('quote mints are not supported');
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new Error('quote amount is invalid');
  const amountUnits = BigInt(amount);
  if (amountUnits <= 0n || amountUnits > MAX_U64) throw new Error('quote amount is invalid');
  const quoteUrl = new URL(JUPITER_QUOTE);
  quoteUrl.search = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: '50',
  });
  const quoteResponse = await fetch(quoteUrl);
  if (!quoteResponse.ok) throw new Error('quote HTTP ' + quoteResponse.status);
  const quote = await quoteResponse.json();
  if (!quote || typeof quote.outAmount !== 'string' || !/^\d+$/.test(quote.outAmount)) throw new Error('quote response has no output amount');
  return quote;
}

export async function buildUnsignedSwap({ quoteResponse, userPublicKey }) {
  if (!quoteResponse || typeof quoteResponse.outAmount !== 'string' || !/^\d+$/.test(quoteResponse.outAmount)) {
    throw new Error('quote response is invalid');
  }
  if (typeof userPublicKey !== 'string' || !userPublicKey) throw new Error('wallet public key is missing');
  const swapResponse = await fetch(JUPITER_SWAP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true }),
  });
  if (!swapResponse.ok) throw new Error('swap HTTP ' + swapResponse.status);
  const swap = await swapResponse.json();
  if (typeof swap.swapTransaction !== 'string' || !swap.swapTransaction) {
    throw new Error('swap response has no serialized transaction');
  }
  return swap.swapTransaction;
}
