import { decodeSolanaAddress } from './auth.mjs';

const SESSION_KEY = 'falconos:session:devnet:v1';
const MAX_WATCHLIST = 24;
const MAX_ORDERS = 50;
const ORDER_STATUSES = new Set(['quoted', 'ready', 'sent', 'send-unknown', 'pending', 'confirmed', 'failed', 'lookup-failed']);
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function validAddress(value) {
  try { decodeSolanaAddress(value); return true; } catch { return false; }
}

function scopedKey(kind, address) {
  if (!validAddress(address)) throw new Error('wallet address is invalid');
  return `falconos:${kind}:devnet:v1:${address}`;
}

function readJson(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch { return fallback; }
}

function safeMintList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((mint) => validAddress(mint)))].slice(0, MAX_WATCHLIST);
}

// Optional advisory-plan tag on executed legs: { assetId, underlying }. Malformed tags are dropped, not fatal.
function safeLegTag(value) {
  if (!value || typeof value !== 'object') return null;
  const { assetId, underlying } = value;
  if (typeof assetId !== 'string' || !assetId || assetId.length > 64 || typeof underlying !== 'string' || !underlying || underlying.length > 32) return null;
  return { assetId, underlying };
}

function safeOrder(value, wallet) {
  if (!value || typeof value !== 'object' || value.wallet !== wallet || value.network !== 'devnet') return null;
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(value.id)) return null;
  if (!['BUY', 'SELL'].includes(value.side) || !ORDER_STATUSES.has(value.status)) return null;
  const poolIds = Array.isArray(value.poolIds) ? value.poolIds : [value.poolId];
  if (!poolIds.length || poolIds.length > 4 || !poolIds.every(validAddress) || new Set(poolIds).size !== poolIds.length) return null;
  if (value.poolId !== undefined && value.poolId !== poolIds[0]) return null;
  if (![value.inputMint, value.outputMint].every(validAddress)) return null;
  if (typeof value.inputAmount !== 'string' || value.inputAmount.length > 64 || !/^\d+(?:\.\d+)?$/.test(value.inputAmount)) return null;
  if (typeof value.inputBaseUnits !== 'string' || !/^\d+$/.test(value.inputBaseUnits)) return null;
  if (typeof value.inputDecimals !== 'number' || !Number.isInteger(value.inputDecimals) || value.inputDecimals < 0 || value.inputDecimals > 18) return null;
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return null;
  const outputUnits = value.outputBaseUnits;
  if (outputUnits !== null && (typeof outputUnits !== 'string' || !/^\d+$/.test(outputUnits))) return null;
  const outputDecimals = value.outputDecimals;
  if (outputDecimals !== null && (typeof outputDecimals !== 'number' || !Number.isInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 18)) return null;
  const signature = value.signature === null || typeof value.signature === 'string' && value.signature.length > 0 && value.signature.length <= 100 && [...value.signature].every((char) => BASE58.includes(char));
  if (!signature) return null;
  const priceImpact = value.priceImpact === null || typeof value.priceImpact === 'string' && value.priceImpact.length <= 32;
  if (!priceImpact) return null;
  const leg = safeLegTag(value.leg);
  return {
    id: value.id,
    wallet,
    network: 'devnet',
    side: value.side,
    poolId: poolIds[0],
    poolIds,
    inputMint: value.inputMint,
    outputMint: value.outputMint,
    inputAmount: value.inputAmount,
    inputBaseUnits: value.inputBaseUnits,
    inputDecimals: value.inputDecimals,
    outputBaseUnits: outputUnits,
    outputDecimals,
    priceImpact: value.priceImpact,
    status: value.status,
    signature: value.signature,
    createdAt: value.createdAt,
    ...(leg && { leg }),
    updatedAt: typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : value.createdAt,
  };
}

export function readSession(storage = globalThis.localStorage) {
  const proof = readJson(storage, SESSION_KEY, null);
  return proof && typeof proof === 'object' ? proof : null;
}

export function writeSession(proof, storage = globalThis.localStorage) {
  if (!proof || !validAddress(proof.address)) throw new Error('wallet proof is invalid');
  storage.setItem(SESSION_KEY, JSON.stringify(proof));
}

export function clearSession(storage = globalThis.localStorage) {
  storage.removeItem(SESSION_KEY);
}

export function readPortfolio(wallet, storage = globalThis.localStorage) {
  const value = readJson(storage, scopedKey('portfolio', wallet), null);
  return { watchlist: safeMintList(value?.watchlist), updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null };
}

export function writePortfolio(wallet, portfolio, storage = globalThis.localStorage) {
  const watchlist = safeMintList(portfolio?.watchlist);
  const record = { watchlist, updatedAt: new Date().toISOString() };
  storage.setItem(scopedKey('portfolio', wallet), JSON.stringify(record));
  return record;
}

export function readOrders(wallet, storage = globalThis.localStorage) {
  const value = readJson(storage, scopedKey('orders', wallet), []);
  if (!Array.isArray(value)) return [];
  return value.map((order) => safeOrder(order, wallet)).filter(Boolean)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_ORDERS);
}

export function saveOrder(wallet, order, storage = globalThis.localStorage) {
  const record = safeOrder(order, wallet);
  if (!record) throw new Error('order record is invalid');
  const orders = readOrders(wallet, storage).filter((item) => item.id !== record.id);
  orders.unshift(record);
  storage.setItem(scopedKey('orders', wallet), JSON.stringify(orders.slice(0, MAX_ORDERS)));
  return record;
}

export function updateOrder(wallet, orderId, changes, storage = globalThis.localStorage) {
  const orders = readOrders(wallet, storage);
  const current = orders.find((item) => item.id === orderId);
  if (!current) throw new Error('saved order was not found');
  const allowed = {};
  if (ORDER_STATUSES.has(changes?.status)) allowed.status = changes.status;
  if (changes?.signature === null) allowed.signature = null;
  if (typeof changes?.signature === 'string' && changes.signature.length <= 100 && [...changes.signature].every((char) => BASE58.includes(char))) {
    allowed.signature = changes.signature;
  }
  if (changes?.outputBaseUnits === null || typeof changes?.outputBaseUnits === 'string' && /^\d+$/.test(changes.outputBaseUnits)) {
    allowed.outputBaseUnits = changes.outputBaseUnits;
  }
  allowed.updatedAt = new Date().toISOString();
  return saveOrder(wallet, { ...current, ...allowed }, storage);
}
