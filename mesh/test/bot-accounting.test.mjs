import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingOverview, createAccounting, feeOwed, observeAccounting, reconcileAccounting } from '../cfo/lending-accounting.mjs';

const WALLET = '11111111111111111111111111111111';
const RECIPIENT = 'BPFLoaderUpgradeab1e11111111111111111111111';
const RESERVE_A = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
const RESERVE_B = 'Ga4rZytCpq1unD4DbEJ5bkHeUz9g3oh9AAFEi6vSauXp';
const MARKET_A = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const MARKET_B = 'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek';
const MINT_A = 'So11111111111111111111111111111111111111112';
const MINT_B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AT = '2026-11-08T12:00:00.000Z';

function portfolio({ cashBaseUnits = '10000', aReceipt = '0', aValue = '0', bReceipt = '0', bValue = '0', status = 'OBSERVED' } = {}) {
  const position = (reserveAddress, marketAddress, receiptMint, receiptBaseUnits, usdcValueBaseUnits) => ({
    reserveAddress, marketAddress, receiptMint, receiptDecimals: 6, receiptBaseUnits, usdcValueBaseUnits,
    redeemableBaseUnits: receiptBaseUnits, supplyApyBps: 500, observedAt: AT, slot: 123,
    availableLiquidityBaseUnits: '1000000',
  });
  return {
    schemaVersion: 1, chain: 'solana', network: 'mainnet-beta', wallet: WALLET, status,
    capturedAt: AT, observedAt: AT, slot: 123, nativeLamports: '1000000000', cashBaseUnits,
    nativePriceUsdMicros: '100000000', usdcPriceUsdMicros: '1000000',
    nativePriceObservedAt: AT, usdcPriceObservedAt: AT, associatedAccountRentLamports: '0',
    positions: [position(RESERVE_A, MARKET_A, MINT_A, aReceipt, aValue), position(RESERVE_B, MARKET_B, MINT_B, bReceipt, bValue)],
    issues: [],
  };
}

function prepared(action, amountBaseUnits, reserveAddress = RESERVE_A, recipient = WALLET) {
  return {
    schemaVersion: 1, chain: 'solana', network: 'mainnet-beta', wallet: WALLET, action,
    reserveAddress: action === 'fee' ? null : reserveAddress, amountBaseUnits,
    amountUnit: action === 'redeem' ? 'receipt-base-units' : 'usdc-base-units', recipient,
    transactionBase64: 'prepared-transaction', messageSha256: 'a'.repeat(64), signature: null,
    blockhash: 'blockhash', lastValidBlockHeight: 123456, observedAt: AT, expiresAt: '2026-11-08T12:01:00.000Z',
    feeLamports: '5000', rentLamports: '0', expectedEffects: {
      usdcDebitBaseUnits: action === 'supply' || action === 'fee' ? amountBaseUnits : '0',
      usdcCreditBaseUnits: action === 'redeem' ? amountBaseUnits : '0',
      receiptDebitBaseUnits: action === 'redeem' ? amountBaseUnits : '0',
      receiptCreditBaseUnits: action === 'supply' ? amountBaseUnits : '0',
    },
    source: { slot: 123, programId: 'program', adapterVersion: 'test' },
  };
}

function action(actionId, sequence, kind, amountBaseUnits, reserveAddress = RESERVE_A, recipient = WALLET) {
  return {
    actionId, sequence, mode: kind === 'fee' ? 'OWNER' : 'WORKER', action: kind,
    reserveAddress: kind === 'fee' ? null : reserveAddress, amountBaseUnits,
    amountUnit: kind === 'redeem' ? 'receipt-base-units' : 'usdc-base-units',
    prepared: prepared(kind, amountBaseUnits, reserveAddress, recipient),
  };
}

function receipt({ debit = '0', credit = '0', receiptDebit = '0', receiptCredit = '0', cost = '0', status = 'CONFIRMED' } = {}) {
  return {
    status, signature: 'signature', slot: 124,
    amounts: { usdcDebitBaseUnits: debit, usdcCreditBaseUnits: credit, receiptDebitBaseUnits: receiptDebit,
      receiptCreditBaseUnits: receiptCredit, feeLamports: cost === '0' ? '0' : '5000',
      rentLamports: '0', costUsdcBaseUnits: cost },
  };
}

function enrollment(options) {
  return createAccounting({ portfolio: portfolio(options), feeBps: 1000, feeRecipient: RECIPIENT });
}

test('cash deposits and withdrawals are external capital, not performance', () => {
  const initial = enrollment({ cashBaseUnits: '10000' });
  const deposited = observeAccounting(initial, portfolio({ cashBaseUnits: '11000' }));
  assert.equal(accountingOverview(deposited).netGainBaseUnits, '0');
  const withdrawn = observeAccounting(deposited, portfolio({ cashBaseUnits: '10500' }));
  const overview = accountingOverview(withdrawn);
  assert.equal(overview.depositsBaseUnits, '1000');
  assert.equal(overview.withdrawalsBaseUnits, '500');
  assert.equal(overview.netGainBaseUnits, '0');
  assert.equal(feeOwed(withdrawn), '0');
});

test('existing receipt value is enrolled as contributed capital without charging historical growth', () => {
  const state = enrollment({ cashBaseUnits: '9000', aReceipt: '1000', aValue: '2000' });
  assert.equal(state.enrollmentCapitalBaseUnits, '11000');
  assert.equal(state.positions.find(item => item.reserveAddress === RESERVE_A).costBasisBaseUnits, '2000');
  assert.equal(state.feeEarnedBaseUnits, '0');
  assert.equal(feeOwed(state), '0');
});

test('partial redemption allocates basis with ceiling and leaves the remainder', () => {
  let state = enrollment({ cashBaseUnits: '1000' });
  const supply = action('supply-1', 1, 'supply', '100');
  state = reconcileAccounting(state, {
    action: supply,
    receipt: receipt({ debit: '100', receiptCredit: '100', cost: '1' }),
    portfolio: portfolio({ cashBaseUnits: '900', aReceipt: '100', aValue: '100' }),
  });
  const redeem = action('redeem-2', 2, 'redeem', '40');
  state = reconcileAccounting(state, {
    action: redeem,
    receipt: receipt({ credit: '39', receiptDebit: '40', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '939', aReceipt: '60', aValue: '60' }),
  });
  const position = state.positions.find(item => item.reserveAddress === RESERVE_A);
  assert.equal(position.receiptBaseUnits, '60');
  assert.equal(position.costBasisBaseUnits, '60');
  assert.equal(state.realizedLossesBaseUnits, '2');
  assert.equal(state.transactionCostsBaseUnits, '1');
});

test('realized losses recover before fee accrual resumes and do not charge the same gain twice', () => {
  let state = enrollment({ cashBaseUnits: '10000' });
  state = reconcileAccounting(state, {
    action: action('supply-1', 1, 'supply', '2000'),
    receipt: receipt({ debit: '2000', receiptCredit: '2000', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '8000', aReceipt: '2000', aValue: '2000' }),
  });
  state = observeAccounting(state, portfolio({ cashBaseUnits: '8000', aReceipt: '2000', aValue: '2200' }));
  assert.equal(feeOwed(state), '20');
  state = reconcileAccounting(state, {
    action: { ...action('redeem-2', 2, 'redeem', '1000'), mode: 'OWNER' },
    receipt: receipt({ credit: '900', receiptDebit: '1000', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '8900', aReceipt: '1000', aValue: '1100' }),
  });
  assert.equal(state.realizedLossesBaseUnits, '100');
  assert.equal(feeOwed(state), '0');
  state = observeAccounting(state, portfolio({ cashBaseUnits: '8900', aReceipt: '1000', aValue: '1300' }));
  assert.equal(state.feeEarnedBaseUnits, '20');
  assert.equal(feeOwed(state), '20');
  state = observeAccounting(state, portfolio({ cashBaseUnits: '8900', aReceipt: '1000', aValue: '1400' }));
  assert.equal(state.feeEarnedBaseUnits, '30');
  assert.equal(feeOwed(state), '30');
});

test('replaying the latest finalized effect is idempotent and contradictory replay is rejected', () => {
  const before = enrollment({ cashBaseUnits: '10000' });
  const finalizedAction = action('supply-1', 1, 'supply', '100');
  const finalizedReceipt = receipt({ debit: '100', receiptCredit: '100', cost: '0' });
  const after = reconcileAccounting(before, {
    action: finalizedAction, receipt: finalizedReceipt,
    portfolio: portfolio({ cashBaseUnits: '9900', aReceipt: '100', aValue: '100' }),
  });
  assert.deepEqual(reconcileAccounting(after, {
    action: finalizedAction, receipt: finalizedReceipt,
    portfolio: portfolio({ cashBaseUnits: '9900', aReceipt: '100', aValue: '100' }),
  }), after);
  assert.throws(() => reconcileAccounting(after, {
    action: finalizedAction, receipt: receipt({ debit: '99', receiptCredit: '100', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '9900', aReceipt: '100', aValue: '100' }),
  }), error => error?.code === 'CONFLICT');
  const advanced = reconcileAccounting(after, {
    action: action('supply-2', 2, 'supply', '10'),
    receipt: receipt({ debit: '10', receiptCredit: '10', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '9890', aReceipt: '110', aValue: '110' }),
  });
  assert.throws(() => reconcileAccounting(advanced, {
    action: finalizedAction, receipt: finalizedReceipt,
    portfolio: portfolio({ cashBaseUnits: '9900', aReceipt: '100', aValue: '100' }),
  }), error => error?.code === 'CONFLICT');
});

test('paid fees are not external withdrawals and do not create a second entitlement', () => {
  let state = enrollment({ cashBaseUnits: '10000' });
  state = reconcileAccounting(state, {
    action: action('supply-1', 1, 'supply', '1000'),
    receipt: receipt({ debit: '1000', receiptCredit: '1000', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '9000', aReceipt: '1000', aValue: '1000' }),
  });
  state = observeAccounting(state, portfolio({ cashBaseUnits: '9000', aReceipt: '1000', aValue: '1100' }));
  assert.equal(feeOwed(state), '10');
  assert.throws(() => reconcileAccounting(state, {
    action: action('fee-short', 2, 'fee', '9', RESERVE_A, RECIPIENT),
    receipt: receipt({ debit: '9' }),
    portfolio: portfolio({ cashBaseUnits: '8991', aReceipt: '1000', aValue: '1100' }),
  }), error => error?.code === 'CONFLICT');
  assert.throws(() => reconcileAccounting(state, {
    action: action('fee-wrong-recipient', 2, 'fee', '10', RESERVE_A, WALLET),
    receipt: receipt({ debit: '10' }),
    portfolio: portfolio({ cashBaseUnits: '8990', aReceipt: '1000', aValue: '1100' }),
  }), error => error?.code === 'CONFLICT');
  state = reconcileAccounting(state, {
    action: action('fee-2', 2, 'fee', '10', RESERVE_A, RECIPIENT),
    receipt: receipt({ debit: '10', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '8990', aReceipt: '1000', aValue: '1100' }),
  });
  const overview = accountingOverview(state);
  assert.equal(overview.paidFeeBaseUnits, '10');
  assert.equal(overview.withdrawalsBaseUnits, '0');
  assert.equal(feeOwed(state), '0');
  assert.throws(() => reconcileAccounting(state, {
    action: action('fee-3', 3, 'fee', '1', RESERVE_A, WALLET),
    receipt: receipt({ debit: '1', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '8989', aReceipt: '1000', aValue: '1100' }),
  }), error => error?.code === 'CONFLICT');
});

test('an unpaid fee does not lock an owner redemption', () => {
  let state = enrollment({ cashBaseUnits: '10000' });
  state = reconcileAccounting(state, {
    action: action('supply-1', 1, 'supply', '1000'),
    receipt: receipt({ debit: '1000', receiptCredit: '1000' }),
    portfolio: portfolio({ cashBaseUnits: '9000', aReceipt: '1000', aValue: '1000' }),
  });
  state = observeAccounting(state, portfolio({ cashBaseUnits: '9000', aReceipt: '1000', aValue: '1100' }));
  assert.equal(feeOwed(state), '10');
  state = reconcileAccounting(state, {
    action: { ...action('withdraw-2', 2, 'redeem', '1000'), mode: 'OWNER' },
    receipt: receipt({ credit: '1100', receiptDebit: '1000' }),
    portfolio: portfolio({ cashBaseUnits: '10100' }),
  });
  assert.equal(state.realizedGainsBaseUnits, '100');
  assert.equal(feeOwed(state), '10');
});

test('unknown price and unexpected receipt movement disable fees without preventing a later redemption', () => {
  let state = enrollment({ cashBaseUnits: '10000' });
  state = observeAccounting(state, portfolio({ cashBaseUnits: '10000', aReceipt: '100', aValue: null }));
  assert.equal(feeOwed(state), null);
  assert.equal(accountingOverview(state).feeUnavailableReason, 'missing_position_value');
  state = reconcileAccounting(state, {
    action: action('redeem-1', 1, 'redeem', '100'),
    receipt: receipt({ credit: '99', receiptDebit: '100', cost: '0' }),
    portfolio: portfolio({ cashBaseUnits: '10099', aReceipt: '0', aValue: '0' }),
  });
  assert.equal(state.lastActionId, 'redeem-1');
  assert.equal(state.cashBaseUnits, '10099');
  assert.equal(feeOwed(state), null);
});

test('unexpected external receipt movement and unknown finalized failure cost stay unavailable', () => {
  let state = enrollment({ cashBaseUnits: '10000' });
  state = observeAccounting(state, portfolio({ cashBaseUnits: '10000', aReceipt: '1', aValue: '1' }));
  assert.equal(accountingOverview(state).feeUnavailableReason, 'unexpected_receipt_movement');
  const freshState = enrollment({ cashBaseUnits: '10000' });
  state = reconcileAccounting(freshState, {
    action: action('failed-1', 1, 'supply', '100'),
    receipt: { status: 'FAILED', signature: 'failed-signature', slot: 124, amounts: null },
    portfolio: portfolio({ cashBaseUnits: '10000' }),
  });
  assert.equal(state.lastActionId, 'failed-1');
  assert.equal(state.feeUnavailableReason, 'unknown_transaction_cost');
  assert.equal(feeOwed(state), null);
});

test('unsafe and negative monetary inputs are rejected', () => {
  assert.throws(() => enrollment({ cashBaseUnits: '-1' }), error => error?.code === 'INVALID_INPUT');
  assert.throws(() => observeAccounting(enrollment({ cashBaseUnits: '10000' }), portfolio({ cashBaseUnits: Number.MAX_SAFE_INTEGER + 1 })), error => error?.code === 'INVALID_INPUT');
});

test('uninitialized accounting reports null money instead of invented balances', () => {
  const overview = accountingOverview(null);
  assert.equal(overview.status, 'UNAVAILABLE');
  for (const key of ['cashBaseUnits', 'equityBaseUnits', 'netGainBaseUnits', 'highWaterMarkBaseUnits',
    'depositsBaseUnits', 'withdrawalsBaseUnits', 'transactionCostsBaseUnits',
    'earnedFeeBaseUnits', 'paidFeeBaseUnits', 'feeOwedBaseUnits', 'realizedGainsBaseUnits', 'realizedLossesBaseUnits']) {
    assert.equal(overview[key], null);
  }
  assert.equal(feeOwed(null), null);
});

test('NO_DATA enrollment exposes no balances or flow totals', () => {
  const state = enrollment({ status: 'NO_DATA' });
  const overview = accountingOverview(state);
  assert.equal(overview.status, 'UNAVAILABLE');
  assert.equal(overview.feeUnavailableReason, 'portfolio_unavailable');
  assert.equal(overview.cashBaseUnits, null);
  assert.equal(overview.equityBaseUnits, null);
  assert.equal(overview.netGainBaseUnits, null);
  assert.equal(overview.depositsBaseUnits, null);
  assert.equal(overview.withdrawalsBaseUnits, null);
  assert.equal(feeOwed(state), null);
});

test('V223: paying a current gain below an unpaid peak cannot charge that same gain again', () => {
  let state = enrollment({ cashBaseUnits: '0', aReceipt: '500', aValue: '500', bReceipt: '500', bValue: '500' });
  state = reconcileAccounting(state, {
    action: action('realized-gain', 1, 'redeem', '500', RESERVE_A),
    receipt: receipt({ credit: '700', receiptDebit: '500' }),
    portfolio: portfolio({ cashBaseUnits: '700', bReceipt: '500', bValue: '500' }),
  });
  assert.equal(feeOwed(state), '20');
  state = reconcileAccounting(state, {
    action: action('realized-loss', 2, 'redeem', '500', RESERVE_B),
    receipt: receipt({ credit: '400', receiptDebit: '500' }),
    portfolio: portfolio({ cashBaseUnits: '1100' }),
  });
  assert.equal(feeOwed(state), '10');
  state = reconcileAccounting(state, {
    action: action('owner-fee', 3, 'fee', '10', null, RECIPIENT),
    receipt: receipt({ debit: '10' }),
    portfolio: portfolio({ cashBaseUnits: '1090' }),
  });
  assert.equal(state.feePaidBaseUnits, '10');
  assert.equal(feeOwed(state), '0', 'already-paid fees must also reduce the current-gain entitlement, not only the historical peak');
});
