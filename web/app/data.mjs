import { decodeSolanaAddress } from './auth.mjs';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const TOKEN_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];

async function rpc(method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
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

function parseTokenAccounts(result) {
  if (!result || !Array.isArray(result.value)) throw new Error('Devnet token-account response is incomplete');
  const balances = new Map();
  for (const entry of result.value) {
    const info = entry?.account?.data?.parsed?.info;
    const tokenAmount = info?.tokenAmount;
    if (typeof info?.mint !== 'string' || !tokenAmount || typeof tokenAmount.amount !== 'string' || !/^\d+$/.test(tokenAmount.amount)) continue;
    try { decodeSolanaAddress(info.mint); } catch { continue; }
    if (!Number.isInteger(tokenAmount.decimals) || tokenAmount.decimals < 0 || tokenAmount.decimals > 18) continue;
    const current = balances.get(info.mint);
    if (current && current.decimals !== tokenAmount.decimals) throw new Error('Devnet token account decimals conflict');
    const amount = (BigInt(current?.amount || '0') + BigInt(tokenAmount.amount)).toString();
    balances.set(info.mint, { mint: info.mint, amount, decimals: tokenAmount.decimals });
  }
  return [...balances.values()].filter((token) => BigInt(token.amount) > 0n).sort((a, b) => a.mint.localeCompare(b.mint));
}

export async function getDevnetBalance(wallet) {
  decodeSolanaAddress(wallet);
  const result = await rpc('getBalance', [wallet, { commitment: 'confirmed' }]);
  if (!result || !Number.isSafeInteger(result.value) || result.value < 0) throw new Error('Devnet balance response is invalid');
  return String(result.value);
}

export async function getDevnetTokenAccounts(wallet) {
  decodeSolanaAddress(wallet);
  const responses = await Promise.all(TOKEN_PROGRAMS.map((programId) => rpc(
    'getTokenAccountsByOwner',
    [wallet, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  )));
  const combined = responses.flatMap(parseTokenAccounts).reduce((all, token) => {
    const current = all.get(token.mint);
    if (current && current.decimals !== token.decimals) throw new Error('Devnet token account decimals conflict');
    all.set(token.mint, {
      mint: token.mint,
      decimals: token.decimals,
      amount: (BigInt(current?.amount || '0') + BigInt(token.amount)).toString(),
    });
    return all;
  }, new Map());
  return [...combined.values()].sort((a, b) => a.mint.localeCompare(b.mint));
}

export async function getDevnetSignatures(wallet, limit = 20) {
  decodeSolanaAddress(wallet);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('transaction history limit is invalid');
  const result = await rpc('getSignaturesForAddress', [wallet, { limit, commitment: 'confirmed' }]);
  if (!Array.isArray(result)) throw new Error('Devnet signature response is invalid');
  return result.filter((entry) => entry && typeof entry.signature === 'string' && Number.isSafeInteger(entry.slot))
    .map((entry) => ({
      signature: entry.signature,
      slot: entry.slot,
      blockTime: Number.isSafeInteger(entry.blockTime) ? entry.blockTime : null,
      confirmationStatus: typeof entry.confirmationStatus === 'string' ? entry.confirmationStatus : null,
      err: entry.err ?? null,
    }));
}

export async function getDevnetTokenDecimals(mint) {
  decodeSolanaAddress(mint);
  const result = await rpc('getTokenSupply', [mint, { commitment: 'confirmed' }]);
  const value = result?.value;
  if (!value || typeof value.amount !== 'string' || !/^\d+$/.test(value.amount) || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 18) {
    throw new Error('Devnet token supply response is invalid');
  }
  return value.decimals;
}

export function formatTokenAmount(value, decimals, maxFraction = decimals) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return '—';
  if (!Number.isInteger(maxFraction) || maxFraction < 0 || maxFraction > decimals) return '—';
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(value);
  const whole = amount / scale;
  if (maxFraction === 0) return whole.toLocaleString('en-US');
  const fraction = (amount % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  if (amount > 0n && whole === 0n && !fraction) return `<0.${'0'.repeat(Math.max(0, maxFraction - 1))}1`;
  return fraction ? `${whole.toLocaleString('en-US')}.${fraction}` : whole.toLocaleString('en-US');
}
