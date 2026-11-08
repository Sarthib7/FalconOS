import { canonicalWalletAddress } from '../wallet-auth.mjs';
import { lifecycleError } from './lifecycle.mjs';

const U64 = 18446744073709551615n;
const YEAR = 31536000n;
const MANDATE_KEYS = ['schemaVersion', 'capitalCapBaseUnits', 'reserveFloorBaseUnits', 'maxActionBaseUnits',
  'maxPositionBps', 'maxFeeLamports', 'maxEvidenceAgeSeconds', 'minHoldingSeconds', 'minNetBenefitBaseUnits',
  'cooldownSeconds', 'feeBps', 'feeRecipient', 'reserves', 'expiresAt', 'monitorIntervalSeconds', 'maxReviewCalls'];
const fail = message => { throw lifecycleError('INVALID_INPUT', message); };
export function units(value, name = 'Amount', positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > U64 || (positive && value === '0')) {
    fail(`${name} must be ${positive ? 'a positive' : 'an unsigned'} u64 integer string.`);
  }
  return BigInt(value);
}
export function canonicalTime(value, name = 'Time') {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`${name} must be canonical UTC time.`);
  return Date.parse(value);
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name} is outside its supported range.`);
}
export function validateBotMandate(input, { reserves, feeBps, feeRecipient, at }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== MANDATE_KEYS.length
      || MANDATE_KEYS.some(key => !Object.hasOwn(input, key)) || input.schemaVersion !== 1) fail('Lending mandate has missing or unsupported fields.');
  const cap = units(input.capitalCapBaseUnits, 'Capital cap', true);
  const floor = units(input.reserveFloorBaseUnits, 'Cash floor');
  const action = units(input.maxActionBaseUnits, 'Action cap', true);
  units(input.maxFeeLamports, 'Native fee cap', true);
  units(input.minNetBenefitBaseUnits, 'Minimum net benefit', true);
  if (floor >= cap || action > cap) fail('Cash floor must be below capital cap; action cap cannot exceed it.');
  integer(input.maxPositionBps, 1, 10000, 'Position cap');
  integer(input.maxEvidenceAgeSeconds, 1, 300, 'Evidence age');
  integer(input.minHoldingSeconds, 60, 31536000, 'Minimum holding horizon');
  integer(input.cooldownSeconds, 1, 31536000, 'Cooldown');
  integer(input.monitorIntervalSeconds, 15, 86400, 'Monitor interval');
  integer(input.maxReviewCalls, 2, 1000, 'Review call budget');
  integer(input.feeBps, 0, 10000, 'Performance fee');
  if (feeBps === null || !feeRecipient || input.feeBps !== feeBps || input.feeRecipient !== feeRecipient) fail('The accepted fee terms must equal disclosed operator terms.');
  canonicalWalletAddress(input.feeRecipient);
  if (!Array.isArray(input.reserves) || input.reserves.length !== 2 || new Set(input.reserves).size !== 2
      || input.reserves.some(reserve => !reserves.includes(reserve))) fail('Exactly the two supported reserves are required.');
  const expires = canonicalTime(input.expiresAt, 'Mandate expiry');
  const now = canonicalTime(at);
  if (expires <= now || expires > now + 90 * 86400000) fail('Mandate expiry must be within the next 90 days.');
  return { ...input, reserves: [...input.reserves].sort() };
}
export function fresh(value, at, seconds) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
    && Date.parse(value) <= Date.parse(at) && Date.parse(at) - Date.parse(value) <= seconds * 1000;
}
const min = (...items) => items.reduce((a, b) => a < b ? a : b);
const ceil = (a, b) => (a + b - 1n) / b;
export function nativeCostUsdc(lamports, portfolio, at, maxAge) {
  if (!fresh(portfolio.nativePriceObservedAt, at, maxAge) || !fresh(portfolio.usdcPriceObservedAt, at, maxAge)) return null;
  try {
    const nativeUsd = units(portfolio.nativePriceUsdMicros, 'Native price', true);
    const usdcUsd = units(portfolio.usdcPriceUsdMicros, 'USDC price', true);
    return ceil(units(lamports, 'Native cost') * nativeUsd * 1000000n, 1000000000n * usdcUsd);
  } catch { return null; }
}
function hold(reason, candidates = []) { return { status: 'HOLD', reason, candidates, action: null }; }

// An observed APY is a scenario input. It is never a promised return.
export function selectLendingAction({ portfolio, mandate, at, lastActionAt = null, rotation = null }) {
  const empty = [];
  if (!portfolio || portfolio.status !== 'OBSERVED' || portfolio.chain !== 'solana' || portfolio.network !== 'mainnet-beta'
      || !fresh(portfolio.observedAt, at, mandate.maxEvidenceAgeSeconds)) return hold('Current Solana portfolio evidence is unavailable or stale.', empty);
  if (Date.parse(mandate.expiresAt) <= Date.parse(at)) return hold('The owner mandate has expired.', empty);
  if (!Array.isArray(portfolio.positions) || portfolio.positions.length !== 2
      || new Set(portfolio.positions.map(p => p.reserveAddress)).size !== 2) return hold('Both supported reserve observations are required.', empty);
  let cash, rent, total, invested;
  try {
    cash = units(portfolio.cashBaseUnits);
    rent = units(portfolio.associatedAccountRentLamports, 'Current token account rent', true);
    invested = portfolio.positions.reduce((sum, position) => sum + units(position.usdcValueBaseUnits), 0n);
    total = cash + invested;
  } catch { return hold('Cash, receipt valuation or current native rent is unavailable.', empty); }
  if (portfolio.positions.some(position => !mandate.reserves.includes(position.reserveAddress)
      || !fresh(position.observedAt, at, mandate.maxEvidenceAgeSeconds)
      || !Number.isSafeInteger(position.supplyApyBps) || position.supplyApyBps < 0 || position.supplyApyBps > 1000000)) {
    return hold('A supported reserve rate or source clock is unavailable.', empty);
  }
  if (lastActionAt && Date.parse(at) - Date.parse(lastActionAt) < mandate.cooldownSeconds * 1000) return hold('The owner cooldown is still active.', empty);
  const cap = units(mandate.capitalCapBaseUnits);
  const cashFloor = units(mandate.reserveFloorBaseUnits);
  const perAction = units(mandate.maxActionBaseUnits);
  const fee = units(mandate.maxFeeLamports);
  const positionCap = min(total, cap) * BigInt(mandate.maxPositionBps) / 10000n;
  const costLamports = fee * 3n + rent * 3n;
  const cost = nativeCostUsdc(costLamports.toString(), portfolio, at, mandate.maxEvidenceAgeSeconds);
  if (cost === null) return hold('Fresh SOL/USD and USDC/USD prices are required to compare native costs.', empty);
  if (units(portfolio.nativeLamports) < costLamports) return hold('Native SOL does not cover the conservative fee and rent bound.', empty);
  const candidates = [];
  for (const target of portfolio.positions) {
    const targetValue = units(target.usdcValueBaseUnits);
    const capacity = positionCap > targetValue ? positionCap - targetValue : 0n;
    const remainingCap = cap > invested ? cap - invested : 0n;
    let amount = min(cash > cashFloor ? cash - cashFloor : 0n, capacity, remainingCap, perAction);
    if (rotation) amount = min(amount, units(rotation.supplyLimitBaseUnits));
    const gain = amount * BigInt(target.supplyApyBps) * BigInt(mandate.minHoldingSeconds) / (10000n * YEAR);
    const net = gain - cost;
    candidates.push({ reserveAddress: target.reserveAddress, supplyApyBps: target.supplyApyBps,
      amountBaseUnits: amount.toString(), expectedNetBenefitBaseUnits: net.toString(), costBoundBaseUnits: cost.toString() });
  }
  candidates.sort((a, b) => {
    const delta = BigInt(b.expectedNetBenefitBaseUnits) - BigInt(a.expectedNetBenefitBaseUnits);
    return delta < 0n ? -1 : delta > 0n ? 1 : a.reserveAddress.localeCompare(b.reserveAddress);
  });
  const winner = candidates[0];
  if (winner && units(winner.amountBaseUnits) > 0n && BigInt(winner.expectedNetBenefitBaseUnits) >= units(mandate.minNetBenefitBaseUnits)) {
    return { status: 'REVIEW', reason: 'Supply beats HOLD within the owner horizon after conservative native costs.', candidates,
      action: { action: 'supply', reserveAddress: winner.reserveAddress, amountBaseUnits: winner.amountBaseUnits,
        targetReserveAddress: winner.reserveAddress, supplyLimitBaseUnits: winner.amountBaseUnits,
        costBoundBaseUnits: cost.toString(), expectedNetBenefitBaseUnits: winner.expectedNetBenefitBaseUnits } };
  }
  if (rotation) return hold('INCOMPLETE: the confirmed exit remains customer cash; no entry currently beats HOLD.', candidates);
  if (lastActionAt && Date.parse(at) - Date.parse(lastActionAt) < mandate.minHoldingSeconds * 1000) return hold('The minimum holding horizon has not elapsed.', candidates);
  let best = null;
  for (const source of portfolio.positions) {
    const receipts = units(source.receiptBaseUnits);
    const value = units(source.usdcValueBaseUnits);
    if (receipts === 0n || value === 0n) continue;
    for (const target of portfolio.positions) {
      if (target.reserveAddress === source.reserveAddress || target.supplyApyBps <= source.supplyApyBps) continue;
      let liquidity;
      try { liquidity = units(source.availableLiquidityBaseUnits, 'Executable liquidity'); }
      catch { continue; }
      const targetValue = units(target.usdcValueBaseUnits);
      const capacity = positionCap > targetValue ? positionCap - targetValue : 0n;
      const amount = min(value, liquidity, capacity, perAction);
      const receiptAmount = min(receipts, amount * receipts / value);
      const estimatedProceeds = receiptAmount * value / receipts;
      const gain = estimatedProceeds * BigInt(target.supplyApyBps - source.supplyApyBps)
        * BigInt(mandate.minHoldingSeconds) / (10000n * YEAR);
      const net = gain - cost;
      if (receiptAmount > 0n && net >= units(mandate.minNetBenefitBaseUnits)
          && (!best || net > BigInt(best.expectedNetBenefitBaseUnits))) {
        best = { action: 'redeem', reserveAddress: source.reserveAddress, amountBaseUnits: receiptAmount.toString(),
          targetReserveAddress: target.reserveAddress, supplyLimitBaseUnits: estimatedProceeds.toString(),
          costBoundBaseUnits: cost.toString(), expectedNetBenefitBaseUnits: net.toString() };
      }
    }
  }
  return best ? { status: 'REVIEW', reason: 'A receipt exit and fresh reviewed entry beat HOLD after conservative costs.', candidates, action: best }
    : hold('No eligible supply or rotation beats HOLD after costs and owner limits.', candidates);
}
