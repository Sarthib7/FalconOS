import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCostUsdc, selectLendingAction, validateBotMandate } from '../cfo/lending-strategy.mjs';

const AT = '2026-11-08T12:00:00.000Z';
const A = 'reserve-a';
const B = 'reserve-b';
const recipient = '11111111111111111111111111111111';
const mandate = () => ({ schemaVersion: 1, capitalCapBaseUnits: '1000000000', reserveFloorBaseUnits: '100000000',
  maxActionBaseUnits: '200000000', maxPositionBps: 5000, maxFeeLamports: '100', maxEvidenceAgeSeconds: 300,
  minHoldingSeconds: 31536000, minNetBenefitBaseUnits: '1000', cooldownSeconds: 60, feeBps: 1000,
  feeRecipient: recipient, reserves: [A, B], expiresAt: '2026-11-09T12:00:00.000Z', monitorIntervalSeconds: 15, maxReviewCalls: 8 });
function portfolio() {
  return { schemaVersion: 1, chain: 'solana', network: 'mainnet-beta', status: 'OBSERVED', observedAt: AT,
    nativeLamports: '1000000000', cashBaseUnits: '1000000000', associatedAccountRentLamports: '200',
    nativePriceUsdMicros: '150000000', usdcPriceUsdMicros: '1000000', nativePriceObservedAt: AT, usdcPriceObservedAt: AT,
    positions: [A, B].map((reserveAddress, index) => ({ reserveAddress, receiptBaseUnits: '0', usdcValueBaseUnits: '0',
      supplyApyBps: index ? 1000 : 500, availableLiquidityBaseUnits: '500000000', observedAt: AT })) };
}
const choose = (p = portfolio(), m = mandate(), extra = {}) => selectLendingAction({ portfolio: p, mandate: m, at: AT, ...extra });

test('V219/V222: supply obeys cash floor, action and position caps after comparing both reserves', () => {
  const selected = choose();
  assert.equal(selected.status, 'REVIEW');
  assert.equal(selected.action.reserveAddress, B);
  assert.equal(selected.action.amountBaseUnits, '200000000');
  const p = portfolio();
  p.positions[1].usdcValueBaseUnits = '490000000';
  p.positions[1].receiptBaseUnits = '490000000';
  p.cashBaseUnits = '510000000';
  const capped = choose(p);
  assert.equal(capped.action.reserveAddress, A, 'a high-rate position cannot exceed its owner weight cap');
  assert.equal(capped.action.amountBaseUnits, '200000000');
});

test('V222: an attractive annual rate does not authorize an uneconomic short holding horizon', () => {
  const m = mandate();
  m.minHoldingSeconds = 60;
  const selected = choose(portfolio(), m);
  assert.equal(selected.status, 'HOLD');
  assert.equal(selected.action, null);
  assert.equal(selected.candidates.every(candidate => BigInt(candidate.expectedNetBenefitBaseUnits) < 1000n), true);
});

test('V219/V222: SOL costs use actual USDC price and round expenses up', () => {
  const p = portfolio();
  p.usdcPriceUsdMicros = '500000';
  assert.equal(nativeCostUsdc('1000000000', p, AT, 300), 300000000n);
  assert.equal(nativeCostUsdc('1', p, AT, 300), 1n);
  p.usdcPriceUsdMicros = null;
  assert.equal(choose(p).status, 'HOLD');
  p.usdcPriceUsdMicros = '1000000';
  p.nativePriceObservedAt = '2026-11-08T11:54:59.999Z';
  assert.equal(choose(p).status, 'HOLD', 'an unknown or stale fee price cannot become a zero cost');
});

test('V219/V222: rotation amount is receipt units and cannot exceed current withdrawal liquidity', () => {
  const p = portfolio();
  p.cashBaseUnits = '100000000';
  p.positions[0] = { ...p.positions[0], receiptBaseUnits: '450000000', usdcValueBaseUnits: '900000000',
    supplyApyBps: 100, availableLiquidityBaseUnits: '100000000' };
  const m = { ...mandate(), maxPositionBps: 10000 };
  const selected = choose(p, m);
  assert.equal(selected.action.action, 'redeem');
  assert.equal(selected.action.reserveAddress, A);
  assert.equal(selected.action.targetReserveAddress, B);
  assert.equal(selected.action.amountBaseUnits, '50000000');
  assert.equal(selected.action.supplyLimitBaseUnits, '100000000');
  p.positions[0].availableLiquidityBaseUnits = null;
  assert.equal(choose(p, m).status, 'HOLD');
});

test('V221/V222: a completed exit remains cash when fresh entry does not beat HOLD', () => {
  const p = portfolio();
  p.positions.forEach(position => { position.supplyApyBps = 0; });
  const selected = choose(p, mandate(), { rotation: { supplyLimitBaseUnits: '100000000' } });
  assert.equal(selected.status, 'HOLD');
  assert.match(selected.reason, /^INCOMPLETE:/);
  assert.equal(selected.action, null);
});

test('V217/V223: mandate accepts only supported reserves, finite budget and disclosed fee terms', () => {
  const options = { reserves: [A, B], feeBps: 1000, feeRecipient: recipient, at: AT };
  assert.equal(validateBotMandate(mandate(), options).feeBps, 1000);
  for (const patch of [{ feeBps: 0 }, { feeRecipient: 'another-recipient' }, { reserves: [A, A] },
    { maxReviewCalls: Infinity }, { reserveFloorBaseUnits: '1000000000' }, { maxActionBaseUnits: '1000000001' }]) {
    assert.throws(() => validateBotMandate({ ...mandate(), ...patch }, options), error => error.code === 'INVALID_INPUT');
  }
});

test('V222: a profitable stablecoin proposal stays on HOLD without native network-fee funds', () => {
  const unfunded = portfolio();
  unfunded.nativeLamports = '0';
  const held = choose(unfunded);
  assert.equal(held.status, 'HOLD');
  assert.equal(held.action, null);
  const funded = choose(portfolio());
  assert.equal(funded.status, 'REVIEW');
  assert.equal(funded.action.action, 'supply');
});
