import { PublicKey } from '@solana/web3.js';
import { MeshError } from '../domain.mjs';
import { canonicalBytes, freezeDeep, sha256 } from '../council/evidence.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const INTEGER = /^(?:0|[1-9][0-9]*)$/;
const RESERVE_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RESERVE_SYMBOL = 'USDC';
const RECEIPTS = Object.freeze({
  'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near': Object.freeze({
    symbol: 'gtUSDCp', blockchain: 'base', contractAddress: '0x0bb69b79bc829e1cfcc34a740110886d98d2bd14', decimals: 18,
  }),
  'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near': Object.freeze({
    symbol: 'TLO', blockchain: 'eth', contractAddress: '0x0f38f1ce62776d4a0038bc6cac66877a5687383b', decimals: 8,
  }),
});
const MANDATE_KEYS = [
  'schemaVersion', 'wallet', 'reserveAssetId', 'reserveFloorBaseUnits', 'maxActionReserveBaseUnits',
  'maxPositionBps', 'slippageBps', 'maxFeeBps', 'maxEvidenceAgeSeconds', 'targets',
  'monitorIntervalSeconds', 'maxMonitorCycles',
];
const ASSET_KEYS = ['assetId', 'symbol', 'decimals', 'blockchain', 'contractAddress', 'kind', 'protocol'];
const PORTFOLIO_KEYS = [
  'schemaVersion', 'chain', 'network', 'wallet', 'signerId', 'capturedAt', 'blockHash', 'blockHeight',
  'assets', 'balances', 'status', 'reasons',
];
const QUOTE_REQUEST_KEYS = [
  'dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType', 'destinationAsset', 'amount',
  'refundTo', 'refundType', 'recipient', 'recipientType', 'deadline',
];
const QUOTE_KEYS = ['schemaVersion', 'capturedAt', 'raw', 'sha256', 'signatureVerified'];
const REQUEST_KEYS = ['requestId', 'action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits'];
const PROPOSAL_KEYS = ['action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits', 'reason', 'expiresAt'];
const U128_MAX = (1n << 128n) - 1n;

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys) {
  if (!isRecord(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string') && keys.every(key => Object.hasOwn(value, key));
}
function decodeSolanaKey(value) {
  try {
    if (typeof value !== 'string') return null;
    const key = new PublicKey(value);
    if (key.toBase58() !== value || !PublicKey.isOnCurve(key.toBytes())) return null;
    return Buffer.from(key.toBytes());
  } catch {
    return null;
  }
}

function invalid(message) {
  throw new MeshError('INVALID_INPUT', message);
}

function uint(value, name, { positive = false, max = U128_MAX } = {}) {
  if (typeof value !== 'string' || !INTEGER.test(value)) invalid(`${name} must be a canonical non-negative integer string.`);
  const parsed = BigInt(value);
  if (parsed > max || (positive && parsed === 0n)) invalid(`${name} is outside its supported integer range.`);
  return parsed;
}

function safeInteger(value, name, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) invalid(`${name} must be a safe integer of at least ${min}.`);
  return value;
}

function canonicalTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function quoteTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(parsed);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
    && date.getUTCHours() === Number(match[4])
    && date.getUTCMinutes() === Number(match[5])
    && date.getUTCSeconds() === Number(match[6])
    ? parsed
    : null;
}

function assetKind(asset) {
  if (!exact(asset, ASSET_KEYS)
      || typeof asset.assetId !== 'string' || asset.assetId.length < 1 || asset.assetId.length > 256
      || typeof asset.symbol !== 'string' || asset.symbol.length < 1 || asset.symbol.length > 64
      || typeof asset.blockchain !== 'string' || asset.blockchain.length < 1 || asset.blockchain.length > 64
      || typeof asset.contractAddress !== 'string' || asset.contractAddress.length < 1 || asset.contractAddress.length > 256
      || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 38
      || !(asset.protocol === null || (typeof asset.protocol === 'string' && asset.protocol.length <= 128))) return null;
  if (asset.kind === 'reserve'
      && asset.symbol === RESERVE_SYMBOL
      && asset.contractAddress === RESERVE_MINT
      && asset.blockchain === 'sol'
      && asset.decimals === 6
      && asset.protocol === null) return 'reserve';
  if (asset.kind === 'receipt') {
    const expected = RECEIPTS[asset.assetId];
    if (expected && asset.symbol === expected.symbol && asset.blockchain === expected.blockchain
        && asset.contractAddress === expected.contractAddress && asset.decimals === expected.decimals) return 'receipt';
  }
  return null;
}

function registry(assets) {
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > 16) invalid('Runtime asset registry is invalid.');
  const byId = new Map();
  let reserve = null;
  for (const asset of assets) {
    const kind = assetKind(asset);
    if (kind === null || byId.has(asset.assetId)) invalid('Runtime asset registry contains an unsupported or duplicate mapping.');
    byId.set(asset.assetId, asset);
    if (kind === 'reserve') {
      if (reserve !== null) invalid('Runtime asset registry contains more than one reserve asset.');
      reserve = asset;
    }
  }
  if (reserve === null) invalid('Runtime asset registry does not contain the supported mainnet USDC reserve.');
  return { byId, reserve };
}

function normalizeMandate(input, assets, wallet) {
  if (!exact(input, MANDATE_KEYS) || input.schemaVersion !== 1) invalid('Mandate fields do not match schema version 1.');
  const walletKey = decodeSolanaKey(wallet);
  if (!walletKey || input.wallet !== wallet) invalid('Mandate wallet must match the authenticated Solana public key.');
  const { byId, reserve } = registry(assets);
  if (input.reserveAssetId !== reserve.assetId || !byId.has(input.reserveAssetId)) invalid('Mandate reserve must be the runtime-listed Solana mainnet USDC asset.');
  uint(input.reserveFloorBaseUnits, 'reserveFloorBaseUnits');
  uint(input.maxActionReserveBaseUnits, 'maxActionReserveBaseUnits', { positive: true });
  for (const key of ['maxPositionBps', 'slippageBps', 'maxFeeBps']) {
    safeInteger(input[key], key);
    if (input[key] > 10000) invalid(`${key} must not exceed 10000 basis points.`);
  }
  safeInteger(input.maxEvidenceAgeSeconds, 'maxEvidenceAgeSeconds', { min: 1 });
  safeInteger(input.monitorIntervalSeconds, 'monitorIntervalSeconds', { min: 1 });
  if (input.monitorIntervalSeconds > 2_147_483) invalid('monitorIntervalSeconds exceeds the native timer range.');
  safeInteger(input.maxMonitorCycles, 'maxMonitorCycles', { min: 1 });
  if (!Array.isArray(input.targets) || input.targets.length > Object.keys(RECEIPTS).length) invalid('Mandate targets must be a bounded array.');
  const seen = new Set();
  let totalWeight = 0;
  const targets = input.targets.map(target => {
    if (!exact(target, ['assetId', 'weightBps']) || typeof target.assetId !== 'string'
        || !Number.isSafeInteger(target.weightBps) || target.weightBps < 1 || target.weightBps > 10000
        || !byId.has(target.assetId) || assetKind(byId.get(target.assetId)) !== 'receipt' || seen.has(target.assetId)) {
      invalid('Mandate target is not a unique runtime-verified receipt asset with a positive weight.');
    }
    seen.add(target.assetId);
    totalWeight += target.weightBps;
    return { assetId: target.assetId, weightBps: target.weightBps };
  });
  if (totalWeight > 10000) invalid('Mandate target weights must sum to at most 10000 basis points.');
  return freezeDeep({
    schemaVersion: 1,
    wallet,
    reserveAssetId: reserve.assetId,
    reserveFloorBaseUnits: input.reserveFloorBaseUnits,
    maxActionReserveBaseUnits: input.maxActionReserveBaseUnits,
    maxPositionBps: input.maxPositionBps,
    slippageBps: input.slippageBps,
    maxFeeBps: input.maxFeeBps,
    maxEvidenceAgeSeconds: input.maxEvidenceAgeSeconds,
    targets,
    monitorIntervalSeconds: input.monitorIntervalSeconds,
    maxMonitorCycles: input.maxMonitorCycles,
  });
}

export function validateMandate(input, assets, wallet) {
  return normalizeMandate(input, assets, wallet);
}

function addCheck(checks, id, status, detail) {
  checks.push({ id, status, detail: String(detail).slice(0, 512) });
}

function makeOutput(checks, proposal = null, reasons = []) {
  const status = checks.some(check => check.status === 'BLOCKED')
    ? 'BLOCKED'
    : checks.some(check => check.status === 'NO_DATA') ? 'NO_DATA' : 'REVIEW';
  const safeReasons = [...new Set(reasons.filter(reason => typeof reason === 'string' && reason.trim()).map(reason => reason.slice(0, 512)))].slice(0, 32);
  for (const check of checks) {
    if (check.status !== 'PASS' && !safeReasons.includes(check.detail)) safeReasons.push(check.detail);
    if (safeReasons.length >= 32) break;
  }
  return freezeDeep({ status, proposal: status === 'BLOCKED' ? null : proposal, checks, reasons: safeReasons });
}

function invalidOutput(checks, id, detail) {
  addCheck(checks, id, 'NO_DATA', detail);
  return makeOutput(checks);
}

function validatePortfolio(value, mandate, atText, checks) {
  const walletKey = isRecord(value) ? decodeSolanaKey(value.wallet) : null;
  if (!exact(value, PORTFOLIO_KEYS) || value.schemaVersion !== 1 || value.chain !== 'near' || value.network !== 'mainnet'
      || value.status !== 'OBSERVED' || value.wallet !== mandate.wallet || !/^[0-9a-f]{64}$/.test(value.signerId)
      || !walletKey || walletKey.toString('hex') !== value.signerId
      || typeof value.blockHash !== 'string' || value.blockHash.length < 1 || value.blockHash.length > 256
      || !Number.isSafeInteger(value.blockHeight) || value.blockHeight <= 0
      || !Array.isArray(value.reasons) || value.reasons.length > 32
      || value.reasons.some(reason => typeof reason !== 'string' || reason.length > 512)) {
    addCheck(checks, 'portfolio-identity', 'NO_DATA', 'Observed portfolio shape, status, chain, signer, or owner binding is invalid.');
    return null;
  }
  if (!canonicalTime(value.capturedAt)) {
    addCheck(checks, 'portfolio-freshness', 'NO_DATA', 'Portfolio capture timestamp is not canonical UTC.');
    return null;
  }
  const ageMs = BigInt(Date.parse(atText)) - BigInt(Date.parse(value.capturedAt));
  const maxAgeMs = BigInt(mandate.maxEvidenceAgeSeconds) * 1000n;
  if (ageMs < 0n || ageMs > maxAgeMs) {
    addCheck(checks, 'portfolio-freshness', 'NO_DATA', ageMs < 0n ? 'Portfolio capture is future-dated.' : 'Portfolio capture exceeds the mandate evidence-age limit.');
  } else {
    addCheck(checks, 'portfolio-freshness', 'PASS', 'Portfolio capture is within the mandate evidence-age limit.');
  }

  let mapped;
  try { mapped = registry(value.assets); }
  catch { addCheck(checks, 'portfolio-assets', 'NO_DATA', 'Portfolio asset mappings are not runtime-verified for this mandate.'); return null; }
  if (mapped.reserve.assetId !== mandate.reserveAssetId) {
    addCheck(checks, 'portfolio-identity', 'BLOCKED', 'Portfolio reserve asset does not match the saved mandate.');
    return null;
  }
  const balances = new Map();
  if (!Array.isArray(value.balances) || value.balances.length !== value.assets.length) {
    addCheck(checks, 'portfolio-balances', 'NO_DATA', 'Portfolio must contain one exact balance for each listed supported asset.');
    return null;
  }
  for (const balance of value.balances) {
    if (!exact(balance, ['assetId', 'balanceBaseUnits']) || !mapped.byId.has(balance.assetId) || balances.has(balance.assetId)) {
      addCheck(checks, 'portfolio-balances', 'NO_DATA', 'Portfolio balance list contains an unknown, duplicate, or malformed asset entry.');
      return null;
    }
    try { balances.set(balance.assetId, uint(balance.balanceBaseUnits, 'balanceBaseUnits')); }
    catch { addCheck(checks, 'portfolio-balances', 'NO_DATA', 'Portfolio balance is not an exact supported base-unit integer.'); return null; }
  }
  if (!balances.has(mandate.reserveAssetId) || [...mapped.byId.keys()].some(id => !balances.has(id))) {
    addCheck(checks, 'portfolio-balances', 'NO_DATA', 'Portfolio balances are incomplete for the listed supported assets.');
    return null;
  }
  addCheck(checks, 'portfolio-identity', 'PASS', 'Portfolio owner, signer, mainnet, and reserve identity are bound to the mandate.');
  addCheck(checks, 'portfolio-assets', 'PASS', 'Portfolio assets match the fixed runtime-supported registry.');
  addCheck(checks, 'portfolio-balances', 'PASS', 'Portfolio has exact balances for each listed supported asset.');
  return { assets: mapped.byId, reserve: mapped.reserve, balances, signerId: value.signerId };
}

function quoteAgeStatus(quote, atText, mandate) {
  if (!canonicalTime(quote.capturedAt)) return { status: 'NO_DATA', detail: 'Quote capture timestamp is not canonical UTC.' };
  const capturedAge = BigInt(Date.parse(atText)) - BigInt(Date.parse(quote.capturedAt));
  const sourceTimestamp = quoteTime(quote.raw.timestamp);
  if (sourceTimestamp === null) return { status: 'NO_DATA', detail: 'Signed provider quote timestamp is missing or invalid.' };
  const sourceAge = BigInt(Date.parse(atText)) - BigInt(sourceTimestamp);
  const maxAge = BigInt(mandate.maxEvidenceAgeSeconds) * 1000n;
  if (capturedAge < 0n) return { status: 'NO_DATA', detail: 'Quote capture is future-dated.' };
  if (capturedAge > maxAge) return { status: 'NO_DATA', detail: 'Quote capture exceeds the mandate evidence-age limit.' };
  if (sourceAge < 0n) return { status: 'NO_DATA', detail: 'Signed provider quote timestamp is future-dated.' };
  if (sourceAge > maxAge) return { status: 'NO_DATA', detail: 'Signed provider quote timestamp exceeds the mandate evidence-age limit.' };
  return { status: 'PASS', detail: 'Quote capture and signed provider timestamp are within the mandate evidence-age limit.' };
}

function validateQuote(value, portfolio, mandate, atText) {
  if (!exact(value, QUOTE_KEYS) || value.schemaVersion !== 1 || value.signatureVerified !== true
      || !isRecord(value.raw) || !exact(value.raw.quoteRequest, QUOTE_REQUEST_KEYS) || !isRecord(value.raw.quote)) {
    return { status: 'NO_DATA', detail: 'Executable quote envelope or verified quote fields are incomplete.' };
  }
  let hash;
  try { hash = sha256(canonicalBytes(value.raw)); }
  catch { return { status: 'NO_DATA', detail: 'Quote source cannot be canonically hashed.' }; }
  if (!HASH.test(value.sha256) || hash !== value.sha256) return { status: 'NO_DATA', detail: 'Quote envelope hash does not match its unmodified provider response.' };
  const freshness = quoteAgeStatus(value, atText, mandate);
  if (freshness.status !== 'PASS') return freshness;
  const request = value.raw.quoteRequest;
  const rawQuote = value.raw.quote;
  const deadlineMs = quoteTime(rawQuote.deadline);
  if (request.dry !== false || request.swapType !== 'EXACT_INPUT'
      || request.depositType !== 'INTENTS' || request.refundType !== 'INTENTS' || request.recipientType !== 'INTENTS'
      || request.refundTo !== portfolio.signerId || request.recipient !== portfolio.signerId
      || typeof request.originAsset !== 'string' || typeof request.destinationAsset !== 'string'
      || !portfolio.assets.has(request.originAsset) || !portfolio.assets.has(request.destinationAsset)
      || request.originAsset === request.destinationAsset
      || !Number.isSafeInteger(request.slippageTolerance) || request.slippageTolerance !== mandate.slippageBps
      || typeof request.amount !== 'string' || !INTEGER.test(request.amount)
      || typeof rawQuote.amountIn !== 'string' || !INTEGER.test(rawQuote.amountIn)
      || typeof rawQuote.minAmountIn !== 'string' || !INTEGER.test(rawQuote.minAmountIn)
      || typeof rawQuote.amountOut !== 'string' || !INTEGER.test(rawQuote.amountOut)
      || typeof rawQuote.minAmountOut !== 'string' || !INTEGER.test(rawQuote.minAmountOut)
      || typeof rawQuote.deadline !== 'string' || deadlineMs === null
      || request.deadline !== rawQuote.deadline
      || deadlineMs <= Date.parse(atText)
      || typeof rawQuote.depositAddress !== 'string' || !rawQuote.depositAddress.length
      || rawQuote.depositAddress.length > 512 || !rawQuote.depositAddress.isWellFormed()
      || rawQuote.depositAddress.includes('\0')) {
    return { status: 'NO_DATA', detail: 'Quote is not an executable owner-bound exact-input NEAR Intents request at the mandate slippage. ' + freshness.detail };
  }
  let amount, amountIn, minAmountIn, amountOut, minAmountOut;
  try {
    amount = uint(request.amount, 'quote amount', { positive: true });
    amountIn = uint(rawQuote.amountIn, 'quote amountIn', { positive: true });
    minAmountIn = uint(rawQuote.minAmountIn, 'quote minAmountIn', { positive: true });
    amountOut = uint(rawQuote.amountOut, 'quote amountOut', { positive: true });
    minAmountOut = uint(rawQuote.minAmountOut, 'quote minAmountOut', { positive: true });
  } catch {
    return { status: 'NO_DATA', detail: 'Quote amount fields are not exact positive token base-unit strings.' };
  }
  if (amount !== amountIn || minAmountIn > amountIn || minAmountOut > amountOut) {
    return { status: 'NO_DATA', detail: 'Quote amount bounds are inconsistent with the exact-input request.' };
  }
  if (typeof rawQuote.refundFee !== 'string' || !INTEGER.test(rawQuote.refundFee)
      || typeof rawQuote.withdrawFee !== 'string' || !INTEGER.test(rawQuote.withdrawFee)) {
    return { status: 'NO_DATA', detail: 'Quote fee data is incomplete; origin refund and destination withdrawal fees are required.' };
  }
  let refundFee, withdrawFee;
  try {
    refundFee = uint(rawQuote.refundFee, 'quote refundFee');
    withdrawFee = uint(rawQuote.withdrawFee, 'quote withdrawFee');
  } catch {
    return { status: 'NO_DATA', detail: 'Quote fee fields are not exact non-negative base-unit strings.' };
  }
  if (withdrawFee > amountOut) return { status: 'NO_DATA', detail: 'Destination withdrawal fee exceeds the quoted destination amount.' };
  return {
    status: 'PASS',
    detail: 'Quote envelope is verified, fresh, owner-bound, and uses exact asset base units.',
    request,
    rawQuote,
    originAssetId: request.originAsset,
    destinationAssetId: request.destinationAsset,
    amount,
    amountIn,
    minAmountIn,
    amountOut,
    minAmountOut,
    refundFee,
    withdrawFee,
    deadline: rawQuote.deadline,
  };
}

function quoteKey(origin, destination, amount) {
  return `${origin}\0${destination}\0${amount}`;
}
function isRequestedExitQuote(envelope, request, reserveAssetId) {
  const quoteRequest = isRecord(envelope) && isRecord(envelope.raw) ? envelope.raw.quoteRequest : null;
  return isRecord(quoteRequest)
    && quoteRequest.originAsset === request.sourceAssetId
    && quoteRequest.destinationAsset === reserveAssetId
    && quoteRequest.amount === request.inputBaseUnits;
}

function explicitFeeFieldsWithinCap(quote, maxFeeBps) {
  const origin = quote.amountIn;
  const destinationBeforeFee = quote.amountOut + quote.withdrawFee;
  if (origin === 0n || destinationBeforeFee === 0n) return false;
  return quote.refundFee * 10000n * destinationBeforeFee
      + quote.withdrawFee * 10000n * origin
    <= BigInt(maxFeeBps) * origin * destinationBeforeFee;
}

function roundTripLossWithinCap(entryQuote, reverseQuote, maxFeeBps) {
  const reserveSpent = entryQuote.amountIn + entryQuote.refundFee;
  if (reserveSpent === 0n) return false;
  const reserveReturned = reverseQuote.minAmountOut;
  const loss = reserveSpent > reserveReturned ? reserveSpent - reserveReturned : 0n;
  return loss * 10000n <= reserveSpent * BigInt(maxFeeBps);
}

function heldAssetById(portfolio, id) {
  return portfolio.assets.get(id);
}

function requiredQuote(quoteMap, origin, destination, amount) {
  const matches = quoteMap.get(quoteKey(origin, destination, amount.toString())) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function chooseTarget(mandate, exposure, totalValue) {
  const candidates = mandate.targets.map(target => {
    const desired = totalValue * BigInt(target.weightBps) / 10000n;
    const current = exposure.get(target.assetId) ?? 0n;
    return { assetId: target.assetId, gap: desired > current ? desired - current : 0n };
  }).sort((left, right) => left.gap === right.gap
    ? left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
    : left.gap > right.gap ? -1 : 1);
  return candidates[0] ?? null;
}

function policyFailure(checks, reasons = []) {
  return makeOutput(checks, null, reasons);
}

export function evaluatePlan({ portfolio: portfolioValue, mandate: mandateValue, request, quotes, at } = {}) {
  if (!exact({ portfolio: portfolioValue, mandate: mandateValue, request, quotes, at }, ['portfolio', 'mandate', 'request', 'quotes', 'at'])) {
    invalid('Policy evaluation input fields are invalid.');
  }
  if (!canonicalTime(at)) invalid('Policy evaluation time must be canonical UTC.');
  if (!exact(request, REQUEST_KEYS) || typeof request.requestId !== 'string' || !UUID.test(request.requestId)
      || !['invest', 'redeem', 'rotate', 'reinvest', 'hold'].includes(request.action)
      || !(request.sourceAssetId === null || typeof request.sourceAssetId === 'string')
      || !(request.targetAssetId === null || typeof request.targetAssetId === 'string')
      || !(request.inputBaseUnits === null || (typeof request.inputBaseUnits === 'string' && INTEGER.test(request.inputBaseUnits)))) {
    invalid('Plan request fields do not match the bounded CFO action contract.');
  }
  if (!Array.isArray(quotes) || quotes.length > 32) invalid('Plan quotes must be a bounded array.');
  const checks = [];
  if (!isRecord(portfolioValue) || portfolioValue.status === 'NO_DATA') {
    addCheck(checks, 'portfolio-identity', 'NO_DATA', 'Portfolio observation is unavailable.');
    const reasons = Array.isArray(portfolioValue?.reasons) ? portfolioValue.reasons : [];
    return policyFailure(checks, reasons);
  }
  let mandate;
  try { mandate = validateMandate(mandateValue, portfolioValue.assets, portfolioValue.wallet); }
  catch (error) {
    if (error instanceof MeshError) throw error;
    invalid('Saved CFO mandate is invalid.');
  }
  if (!exact(portfolioValue, PORTFOLIO_KEYS) || !canonicalTime(at)) return invalidOutput(checks, 'portfolio-identity', 'Portfolio observation is malformed.');
  const portfolio = validatePortfolio(portfolioValue, mandate, at, checks);
  if (!portfolio) return makeOutput(checks);
  if (checks.some(check => check.status === 'NO_DATA' || check.status === 'BLOCKED')) return makeOutput(checks);
  const action = request.action;
  const isOwnerExit = action === 'redeem' || action === 'rotate';

  const quoteMap = new Map();
  let quoteFailure = false;
  for (const envelope of quotes) {
    if (isOwnerExit && !isRequestedExitQuote(envelope, request, mandate.reserveAssetId)) continue;
    const parsed = validateQuote(envelope, portfolio, mandate, at);
    if (parsed.status !== 'PASS') {
      quoteFailure = true;
      addCheck(checks, parsed.detail.includes('fee') ? 'quote-cost' : 'quote-integrity', parsed.status, parsed.detail);
      continue;
    }
    const key = quoteKey(parsed.originAssetId, parsed.destinationAssetId, parsed.amount.toString());
    const list = quoteMap.get(key) ?? [];
    list.push(parsed);
    quoteMap.set(key, list);
  }
  if (quoteFailure) return makeOutput(checks);
  for (const list of quoteMap.values()) {
    if (list.length > 1) {
      addCheck(checks, 'quote-integrity', 'NO_DATA', 'Multiple quote envelopes claim the same asset direction and exact input amount.');
      return makeOutput(checks);
    }
  }
  addCheck(checks, 'quote-integrity', 'PASS', isOwnerExit
    ? 'The requested exit quote is owner-bound; unrelated receipt valuations do not gate the deterministic exit.'
    : 'All quote envelopes match canonical hashes and the owner-bound executable request contract.');

  const reserveUnits = portfolio.balances.get(mandate.reserveAssetId);
  const exposure = new Map();
  exposure.set(mandate.reserveAssetId, reserveUnits);
  let totalValue = null;
  const receiptIds = [...portfolio.assets.values()].filter(asset => asset.kind === 'receipt').map(asset => asset.assetId).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (isOwnerExit) {
    addCheck(checks, 'portfolio-valuation', 'PASS', 'Deterministic exit uses the observed source balance and exact quote; unrelated receipt balances remain unvalued.');
  } else {
    totalValue = reserveUnits;
    for (const id of receiptIds) {
      const held = portfolio.balances.get(id);
      let value = 0n;
      if (held > 0n) {
        const exitQuote = requiredQuote(quoteMap, id, mandate.reserveAssetId, held);
        if (!exitQuote) {
          addCheck(checks, 'portfolio-valuation', 'NO_DATA', `Current ${heldAssetById(portfolio, id).symbol} exposure has no exact full-balance executable exit quote to the reserve.`);
          continue;
        }
        value = exitQuote.minAmountOut;
        if (exitQuote.refundFee > held) {
          addCheck(checks, 'portfolio-valuation', 'NO_DATA', `Current ${heldAssetById(portfolio, id).symbol} exit fee exceeds its full token balance.`);
          continue;
        }
      }
      exposure.set(id, value);
      totalValue += value;
    }
    if (checks.some(check => check.id === 'portfolio-valuation' && check.status === 'NO_DATA')) return makeOutput(checks);
    addCheck(checks, 'portfolio-valuation', 'PASS', `Current reserve and receipt values in reserve base units: reserve=${reserveUnits}; gtUSDCp=${exposure.get(Object.keys(RECEIPTS)[0]) ?? 0n}; TLO=${exposure.get(Object.keys(RECEIPTS)[1]) ?? 0n}; total=${totalValue}.`);
  }
  if (action === 'hold') {
    if (request.sourceAssetId !== null || request.targetAssetId !== null || request.inputBaseUnits !== null) invalid('Hold requests cannot include asset or amount fields.');
    addCheck(checks, 'reserve-floor', 'PASS', 'Hold does not spend reserve or count estimated redemption proceeds.');
    addCheck(checks, 'action-cap', 'PASS', 'Hold has no spendable action amount.');
    addCheck(checks, 'fee-cap', 'PASS', 'Hold has no quote costs.');
    addCheck(checks, 'position-cap', 'PASS', 'Hold does not increase a position.');
    const expiresAt = at;
    return makeOutput(checks, {
      action: 'hold', sourceAssetId: null, targetAssetId: null, inputBaseUnits: '0',
      reason: 'No treasury movement was requested.', expiresAt,
    });
  }

  const isBuy = action === 'invest' || action === 'reinvest';
  const isExit = action === 'redeem' || action === 'rotate';
  if (isBuy) {
    if (request.sourceAssetId !== mandate.reserveAssetId) invalid('Invest and reinvest must source the saved reserve asset.');
    if (request.targetAssetId !== null && !mandate.targets.some(target => target.assetId === request.targetAssetId)) {
      addCheck(checks, 'target-mandate', 'BLOCKED', 'Buy target is not enabled in the saved mandate.');
      return makeOutput(checks);
    }
  } else if (action === 'redeem') {
    if (request.sourceAssetId === null || request.targetAssetId !== mandate.reserveAssetId
        || request.sourceAssetId === mandate.reserveAssetId || !portfolio.assets.has(request.sourceAssetId)) invalid('Redeem must move a held receipt asset to the saved reserve.');
  } else if (action === 'rotate') {
    if (request.sourceAssetId === null || request.targetAssetId === null || request.sourceAssetId === request.targetAssetId
        || request.sourceAssetId === mandate.reserveAssetId || !portfolio.assets.has(request.sourceAssetId)
        || !mandate.targets.some(target => target.assetId === request.targetAssetId)) invalid('Rotation must name a held receipt source and a mandated desired receipt target.');
  }

  let targetAssetId = request.targetAssetId;
  let amount = request.inputBaseUnits === null ? null : uint(request.inputBaseUnits, 'inputBaseUnits', { positive: true });
  if (isBuy && (targetAssetId === null || amount === null)) {
    let target;
    if (targetAssetId === null) target = chooseTarget(mandate, exposure, totalValue);
    else {
      const mandateTarget = mandate.targets.find(item => item.assetId === targetAssetId);
      const desired = totalValue * BigInt(mandateTarget.weightBps) / 10000n;
      const current = exposure.get(targetAssetId) ?? 0n;
      target = { assetId: targetAssetId, gap: desired > current ? desired - current : 0n };
    }
    if (!target || target.gap === 0n) {
      addCheck(checks, 'target-mandate', 'BLOCKED', 'No mandated target is below its deterministic weight allocation.');
      return makeOutput(checks);
    }
    targetAssetId = target.assetId;
    if (amount === null) {
      const floor = BigInt(mandate.reserveFloorBaseUnits);
      const available = reserveUnits > floor ? reserveUnits - floor : 0n;
      const cap = BigInt(mandate.maxActionReserveBaseUnits);
      amount = [target.gap, available, cap].reduce((smallest, current) => current < smallest ? current : smallest);
      if (amount === 0n) {
        addCheck(checks, 'reserve-floor', 'BLOCKED', `No settled reserve is available above the floor for a target-weight allocation: available=${reserveUnits}; floor=${floor}.`);
        return makeOutput(checks);
      }
    }
    addCheck(checks, 'target-mandate', 'PASS', `Target ${targetAssetId} is selected from mandate weight and current quote-valued exposure.`);
  }
  if (isBuy && amount === null) invalid('Reserve-funded plan requires an explicit amount or a target-weight selection.');
  if (isExit && amount === null) invalid('Redeem and rotate requests require an explicit held-token amount.');
  if (amount === null) invalid('Action amount could not be determined.');
  const proposalReason = action === 'rotate'
    ? 'Redeem the source to reserve first; retain the requested target as a separate next leg and do not spend estimated proceeds.'
    : action === 'redeem'
      ? 'Redeem the owner-requested held receipt amount to the reserve.'
      : 'Use only currently observed reserve units for the mandate-bounded acquisition.';
  const proposalFor = expiresAt => ({
    action,
    sourceAssetId: isBuy ? mandate.reserveAssetId : request.sourceAssetId,
    targetAssetId,
    inputBaseUnits: amount.toString(),
    reason: proposalReason,
    expiresAt,
  });
  const candidateProposal = proposalFor(at);

  let actionQuote;
  if (isBuy) {
    actionQuote = requiredQuote(quoteMap, mandate.reserveAssetId, targetAssetId, amount);
  } else {
    const held = portfolio.balances.get(request.sourceAssetId);
    if (amount > held) addCheck(checks, 'held-balance', 'BLOCKED', `Exit input exceeds the observed source balance: input=${amount}; held=${held}.`);
    else addCheck(checks, 'held-balance', 'PASS', `Exit input is within the observed source balance: input=${amount}; held=${held}.`);
    actionQuote = requiredQuote(quoteMap, request.sourceAssetId, mandate.reserveAssetId, amount);
  }
  if (!actionQuote) {
    addCheck(checks, 'action-quote', 'NO_DATA', 'No unique verified executable quote matches the exact action direction and input units.');
    return makeOutput(checks, candidateProposal);
  }
  addCheck(checks, 'action-quote', 'PASS', 'Executable quote matches the exact action direction and input base units.');

  if (isBuy) {
    const availableSpend = reserveUnits;
    const floor = BigInt(mandate.reserveFloorBaseUnits);
    const maximumAction = BigInt(mandate.maxActionReserveBaseUnits);
    const spend = actionQuote.amountIn + actionQuote.refundFee;
    const postSpend = availableSpend - spend;
    if (spend > maximumAction) addCheck(checks, 'action-cap', 'BLOCKED', `Reserve action including origin refund fee exceeds the mandate cap: spend=${spend}; cap=${maximumAction}.`);
    else addCheck(checks, 'action-cap', 'PASS', `Reserve action including origin refund fee is within the mandate cap: spend=${spend}; cap=${maximumAction}.`);
    if (postSpend < floor) addCheck(checks, 'reserve-floor', 'BLOCKED', `Reserve floor would be breached using settled reserve only: available=${availableSpend}; spend=${spend}; floor=${floor}.`);
    else addCheck(checks, 'reserve-floor', 'PASS', `Reserve floor is preserved using settled reserve only: available=${availableSpend}; spend=${spend}; floor=${floor}.`);
  }

  const actionReserveValue = isBuy ? actionQuote.amountIn + actionQuote.refundFee : actionQuote.minAmountOut;
  const actionCap = BigInt(mandate.maxActionReserveBaseUnits);
  if (!isBuy && actionReserveValue > actionCap) addCheck(checks, 'action-cap', 'BLOCKED', `Exit value exceeds the reserve-unit action cap: value=${actionReserveValue}; cap=${actionCap}.`);
  else if (!isBuy) addCheck(checks, 'action-cap', 'PASS', `Exit value is within the reserve-unit action cap: value=${actionReserveValue}; cap=${actionCap}.`);

  if (isBuy) {
    const reverseQuote = requiredQuote(quoteMap, targetAssetId, mandate.reserveAssetId, actionQuote.minAmountOut);
    if (!reverseQuote) {
      addCheck(checks, 'fee-cap', 'NO_DATA', `All-in reserve-to-minimum-receipt-to-reserve cost bound requires reverse quote amountIn=${actionQuote.minAmountOut}.`);
    } else if (!roundTripLossWithinCap(actionQuote, reverseQuote, mandate.maxFeeBps)) {
      addCheck(checks, 'fee-cap', 'BLOCKED', `Conservative immediate round-trip loss exceeds the mandate fee cap of ${mandate.maxFeeBps} basis points.`);
    } else {
      const spent = actionQuote.amountIn + actionQuote.refundFee;
      const returned = reverseQuote.minAmountOut;
      const loss = spent > returned ? spent - returned : 0n;
      addCheck(checks, 'fee-cap', 'PASS', `Conservative reserve round-trip is within the mandate loss cap: spent=${spent}; returned=${returned}; loss=${loss}; withdraw fees are embedded in minimum output.`);
    }
  } else if (!explicitFeeFieldsWithinCap(actionQuote, mandate.maxFeeBps)) {
    addCheck(checks, 'fee-cap', 'BLOCKED', `Explicit exit quote fee fields exceed the mandate fee cap of ${mandate.maxFeeBps} basis points.`);
  } else {
    addCheck(checks, 'fee-cap', 'PASS', `Explicit exit refund and withdrawal fee fields are within ${mandate.maxFeeBps} basis points; exact net minimum output remains in the retained quote.`);
  }

  if (isBuy) {
    for (const id of receiptIds) {
      const current = exposure.get(id) ?? 0n;
      if (current > 0n && current * 10000n > totalValue * BigInt(mandate.maxPositionBps)) {
        addCheck(checks, 'position-cap', 'BLOCKED', `Existing ${heldAssetById(portfolio, id).symbol} position exceeds the mandate position cap before another buy.`);
        break;
      }
    }
    const currentTargetUnits = portfolio.balances.get(targetAssetId);
    const projectedUnits = currentTargetUnits + actionQuote.minAmountOut;
    if (projectedUnits > U128_MAX) {
      addCheck(checks, 'position-cap', 'NO_DATA', 'Projected target balance exceeds exact supported integer units.');
    } else {
      const projectedExit = requiredQuote(quoteMap, targetAssetId, mandate.reserveAssetId, projectedUnits);
      if (!projectedExit) {
        addCheck(checks, 'position-cap', 'NO_DATA', `Projected ${heldAssetById(portfolio, targetAssetId).symbol} full-balance exit quote required: amountIn=${projectedUnits}.`);
        return makeOutput(checks, proposalFor(actionQuote.deadline));
      }
      const currentTargetValue = exposure.get(targetAssetId) ?? 0n;
      const projectedTotal = totalValue - currentTargetValue - actionQuote.amountIn - actionQuote.refundFee + projectedExit.minAmountOut;
      if (projectedTotal <= 0n) {
        addCheck(checks, 'position-cap', 'NO_DATA', 'Projected portfolio value is not positive after the proposed action.');
      } else if (projectedExit.minAmountOut * 10000n > projectedTotal * BigInt(mandate.maxPositionBps)) {
        addCheck(checks, 'position-cap', 'BLOCKED', `Projected ${heldAssetById(portfolio, targetAssetId).symbol} position exceeds the mandate concentration cap: value=${projectedExit.minAmountOut}; total=${projectedTotal}; capBps=${mandate.maxPositionBps}.`);
      } else {
        addCheck(checks, 'position-cap', 'PASS', `Projected target position is within the mandate cap: value=${projectedExit.minAmountOut}; total=${projectedTotal}; capBps=${mandate.maxPositionBps}.`);
      }
    }
  } else {
    addCheck(checks, 'position-cap', 'PASS', 'Deterministic exit does not increase a receipt position.');
  }

  const proposal = proposalFor(actionQuote.deadline);
  if (!exact(proposal, PROPOSAL_KEYS)) invalid('Deterministic proposal could not be constructed.');
  if (checks.some(check => check.status === 'BLOCKED')) return makeOutput(checks);
  if (checks.some(check => check.status === 'NO_DATA')) return makeOutput(checks, proposal);
  return makeOutput(checks, proposal);
}
