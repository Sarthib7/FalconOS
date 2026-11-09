import { sha256Utf8, stableStringify } from '../council/evidence.ts';
import { canonicalWalletAddress } from '../wallet-auth.mjs';
import { lifecycleError } from './lifecycle.mjs';

const U64_MAX = 18446744073709551615n;
const UINT = /^(0|[1-9][0-9]*)$/;
const INT = /^(0|-?[1-9][0-9]*)$/;
const RECEIPT_AMOUNT_KEYS = [
  'usdcDebitBaseUnits', 'usdcCreditBaseUnits', 'receiptDebitBaseUnits', 'receiptCreditBaseUnits',
  'feeLamports', 'rentLamports', 'costUsdcBaseUnits',
];

const invalid = message => { throw lifecycleError('INVALID_INPUT', message); };
const conflict = message => { throw lifecycleError('CONFLICT', message); };

function unsigned(value, name, { u64 = false } = {}) {
  if (typeof value !== 'string' || value.length > 128 || !UINT.test(value)) invalid(`${name} must be a canonical unsigned integer string.`);
  const amount = BigInt(value);
  if (u64 && amount > U64_MAX) invalid(`${name} exceeds the supported token-unit range.`);
  return amount;
}

function signed(value, name) {
  if (typeof value !== 'string' || value.length > 128 || !INT.test(value)) invalid(`${name} must be a canonical signed integer string.`);
  return BigInt(value);
}

function optionalAmount(source, key, name = key) {
  if (!source || typeof source !== 'object' || !Object.hasOwn(source, key) || source[key] === null) return null;
  return unsigned(source[key], name, { u64: true });
}

function failReason(state, reason) {
  if (state.feeUnavailableReason === null) state.feeUnavailableReason = reason;
}
function failCashflow(state, reason) {
  state.cashflowsAvailable = false;
  if (state.cashflowUnavailableReason === null) state.cashflowUnavailableReason = reason;
}

function amountString(value) { return value === null ? null : value.toString(); }
function min(a, b) { return a < b ? a : b; }
function max(a, b) { return a > b ? a : b; }
function ceilDiv(a, b) { return (a + b - 1n) / b; }

function validateTerms(feeBps, feeRecipient) {
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10000) invalid('Fee basis points must be an integer from 0 through 10000.');
  return canonicalWalletAddress(feeRecipient);
}

function readPortfolio(portfolio) {
  if (!portfolio || typeof portfolio !== 'object' || Array.isArray(portfolio)) {
    return { reason: 'portfolio_unavailable', cash: null, positions: null, complete: false };
  }
  if (portfolio.schemaVersion !== 1) return { reason: 'unsupported_portfolio_schema', cash: null, positions: null, complete: false };
  if (portfolio.status !== 'OBSERVED') {
    return { reason: portfolio.status === 'NO_DATA' ? 'portfolio_unavailable' : 'unsupported_portfolio_status', cash: null, positions: null, complete: false };
  }
  if (portfolio.chain !== 'solana' || portfolio.network !== 'mainnet-beta') {
    return { reason: 'unsupported_portfolio_network', cash: null, positions: null, complete: false };
  }

  const reasons = [];
  let cash = null;
  if (portfolio.cashBaseUnits === null || portfolio.cashBaseUnits === undefined) reasons.push('missing_cash_balance');
  else cash = unsigned(portfolio.cashBaseUnits, 'Portfolio cash', { u64: true });

  let positions = null;
  if (!Array.isArray(portfolio.positions) || portfolio.positions.length !== 2) reasons.push('unsupported_position_count');
  else {
    positions = [];
    const seen = new Set();
    for (const item of portfolio.positions) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.reserveAddress !== 'string' || !item.reserveAddress) {
        reasons.push('missing_position_evidence');
        positions = null;
        break;
      }
      if (seen.has(item.reserveAddress)) {
        reasons.push('duplicate_position_evidence');
        positions = null;
        break;
      }
      seen.add(item.reserveAddress);
      const receiptBaseUnits = item.receiptBaseUnits === null || item.receiptBaseUnits === undefined
        ? null : unsigned(item.receiptBaseUnits, 'Portfolio receipt balance', { u64: true });
      const usdcValueBaseUnits = item.usdcValueBaseUnits === null || item.usdcValueBaseUnits === undefined
        ? null : unsigned(item.usdcValueBaseUnits, 'Portfolio position value', { u64: true });
      if (receiptBaseUnits === null) reasons.push('missing_receipt_balance');
      if (usdcValueBaseUnits === null) reasons.push('missing_position_value');
      if (receiptBaseUnits === 0n && usdcValueBaseUnits !== null && usdcValueBaseUnits !== 0n) reasons.push('receipt_value_mismatch');
      positions.push({
        reserveAddress: item.reserveAddress,
        receiptBaseUnits: amountString(receiptBaseUnits),
        usdcValueBaseUnits: amountString(usdcValueBaseUnits),
      });
    }
    if (positions !== null) positions.sort((a, b) => a.reserveAddress.localeCompare(b.reserveAddress));
  }
  if (!Array.isArray(portfolio.issues)) reasons.push('portfolio_issues_unavailable');
  else if (portfolio.issues.length > 0) reasons.push('portfolio_reports_issues');
  const reason = reasons[0] ?? null;
  return { reason, cash, positions, complete: reason === null && cash !== null && positions !== null };
}

function cloneState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.schemaVersion !== 1
      || !Array.isArray(state.positions) || !Number.isSafeInteger(state.lastSequence) || state.lastSequence < 0) {
    invalid('Accounting state is missing or unsupported.');
  }
  validateTerms(state.feeBps, state.feeRecipient);
  if (state.enrollmentCapitalBaseUnits !== null) unsigned(state.enrollmentCapitalBaseUnits, 'Enrolled capital');
  if (state.cashBaseUnits !== null) unsigned(state.cashBaseUnits, 'Accounting cash', { u64: true });
  if (state.highWaterMarkBaseUnits !== null) signed(state.highWaterMarkBaseUnits, 'High-water mark');
  for (const key of ['externalDepositsBaseUnits', 'externalWithdrawalsBaseUnits', 'transactionCostsBaseUnits',
    'feeEarnedBaseUnits', 'feePaidBaseUnits', 'realizedGainsBaseUnits', 'realizedLossesBaseUnits']) {
    unsigned(state[key], key);
  }
  for (const position of state.positions) {
    if (!position || typeof position.reserveAddress !== 'string' || !position.reserveAddress) invalid('Accounting position identity is invalid.');
    if (position.receiptBaseUnits !== null) unsigned(position.receiptBaseUnits, 'Accounting receipt balance', { u64: true });
    if (position.usdcValueBaseUnits !== null) unsigned(position.usdcValueBaseUnits, 'Accounting position value', { u64: true });
    if (position.costBasisBaseUnits !== null) unsigned(position.costBasisBaseUnits, 'Receipt cost basis');
  }
  if (state.lastActionId !== null && (typeof state.lastActionId !== 'string' || !state.lastActionId)) invalid('Accounting action identity is invalid.');
  if (state.lastReceiptFingerprint !== null && (typeof state.lastReceiptFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(state.lastReceiptFingerprint))) invalid('Accounting receipt fingerprint is invalid.');
  if (typeof state.portfolioObserved !== 'boolean') invalid('Accounting portfolio observation status is invalid.');
  if (typeof state.cashflowsAvailable !== 'boolean') invalid('Accounting cashflow availability status is invalid.');
  if (state.cashflowUnavailableReason !== null && typeof state.cashflowUnavailableReason !== 'string') invalid('Accounting cashflow availability reason is invalid.');
  if (state.feeUnavailableReason !== null && typeof state.feeUnavailableReason !== 'string') invalid('Accounting availability reason is invalid.');
  return { ...state, positions: state.positions.map(position => ({ ...position })) };
}

function totalEquity(state) {
  if (!state.portfolioObserved || state.cashBaseUnits === null || state.positions.some(position => position.usdcValueBaseUnits === null)) return null;
  return state.positions.reduce((total, position) => total + BigInt(position.usdcValueBaseUnits), BigInt(state.cashBaseUnits));
}

function capitalBasis(state) {
  return BigInt(state.enrollmentCapitalBaseUnits)
    + BigInt(state.externalDepositsBaseUnits)
    - BigInt(state.externalWithdrawalsBaseUnits);
}

function performanceEquity(state) {
  const equity = totalEquity(state);
  return equity === null ? null : equity + BigInt(state.feePaidBaseUnits) - BigInt(state.transactionCostsBaseUnits);
}

function currentGain(state) {
  const value = performanceEquity(state);
  return value === null || state.enrollmentCapitalBaseUnits === null ? null : value - capitalBasis(state);
}

function refreshHighWater(state) {
  if (state.feeUnavailableReason !== null || !state.cashflowsAvailable || state.enrollmentCapitalBaseUnits === null
      || state.highWaterMarkBaseUnits === null) return;
  const current = performanceEquity(state);
  if (current === null) return;
  const highWater = BigInt(state.highWaterMarkBaseUnits);
  if (current > highWater) state.highWaterMarkBaseUnits = current.toString();
  const peakGain = max(0n, BigInt(state.highWaterMarkBaseUnits) - capitalBasis(state));
  const earned = peakGain * BigInt(state.feeBps) / 10000n;
  if (earned > BigInt(state.feeEarnedBaseUnits)) state.feeEarnedBaseUnits = earned.toString();
}

function adjustExternalCashflow(state, flow) {
  if (flow === 0n) return;
  if (flow > 0n) state.externalDepositsBaseUnits = (BigInt(state.externalDepositsBaseUnits) + flow).toString();
  else state.externalWithdrawalsBaseUnits = (BigInt(state.externalWithdrawalsBaseUnits) - flow).toString();
  if (state.highWaterMarkBaseUnits !== null) {
    state.highWaterMarkBaseUnits = (BigInt(state.highWaterMarkBaseUnits) + flow).toString();
  }
}

function markObservedPortfolio(state, snapshot, { expectedReceiptDeltas = null, ownCashDelta = null } = {}) {
  if (snapshot.reason !== null) failReason(state, snapshot.reason);
  if (snapshot.cash !== null) {
    if (state.cashBaseUnits !== null && ownCashDelta !== null) {
      const flow = snapshot.cash - BigInt(state.cashBaseUnits) - ownCashDelta;
      adjustExternalCashflow(state, flow);
    } else if (state.cashBaseUnits === null) {
      failReason(state, 'cash_baseline_unavailable');
      failCashflow(state, 'cash_baseline_unavailable');
    } else if (ownCashDelta === null) {
      failReason(state, 'receipt_cash_effect_unavailable');
      failCashflow(state, 'receipt_cash_effect_unavailable');
    }
    state.cashBaseUnits = snapshot.cash.toString();
  } else {
    failCashflow(state, snapshot.reason ?? 'cash_balance_unavailable');
    if (ownCashDelta !== null && state.cashBaseUnits !== null) {
      const predictedCash = BigInt(state.cashBaseUnits) + ownCashDelta;
      if (predictedCash < 0n) {
        failReason(state, 'receipt_cash_effect_exceeds_balance');
        state.cashBaseUnits = null;
      } else state.cashBaseUnits = predictedCash.toString();
    } else if (ownCashDelta === null) state.cashBaseUnits = null;
  }

  let positionsComplete = snapshot.positions !== null;
  if (snapshot.positions !== null) {
    const prior = new Map(state.positions.map(position => [position.reserveAddress, position]));
    const current = [];
    for (const observed of snapshot.positions) {
      const previous = prior.get(observed.reserveAddress);
      const expectedDelta = expectedReceiptDeltas?.get(observed.reserveAddress) ?? 0n;
      if (observed.receiptBaseUnits === null && previous && previous.receiptBaseUnits !== null
          && expectedReceiptDeltas?.has(observed.reserveAddress)) {
        const expected = BigInt(previous.receiptBaseUnits) + expectedDelta;
        if (expected < 0n) {
          failReason(state, 'receipt_effect_exceeds_balance');
          current.push({ ...observed, receiptBaseUnits: null, costBasisBaseUnits: null });
        } else {
          current.push({ ...observed, receiptBaseUnits: expected.toString(), costBasisBaseUnits: previous.costBasisBaseUnits });
        }
        continue;
      }
      let basis = previous?.costBasisBaseUnits ?? null;
      if (observed.receiptBaseUnits === '0') basis = '0';
      if (!previous) {
        if (observed.receiptBaseUnits !== null && observed.receiptBaseUnits !== '0') failReason(state, 'unexpected_receipt_movement');
        basis = observed.receiptBaseUnits === '0' ? '0' : null;
      } else if (observed.receiptBaseUnits === null || previous.receiptBaseUnits === null) {
        basis = null;
      } else {
        const expected = BigInt(previous.receiptBaseUnits) + expectedDelta;
        if (expected < 0n || BigInt(observed.receiptBaseUnits) !== expected) {
          failReason(state, 'unexpected_receipt_movement');
          basis = null;
        }
        if (observed.receiptBaseUnits === '0') basis = '0';
      }
      current.push({ ...observed, costBasisBaseUnits: basis });
    }
    for (const previous of state.positions) {
      if (!snapshot.positions.some(position => position.reserveAddress === previous.reserveAddress)) {
        failReason(state, 'missing_position_evidence');
        positionsComplete = false;
      }
    }
    state.positions = current;
  }

  state.portfolioObserved = snapshot.complete && positionsComplete;
  if (state.portfolioObserved) refreshHighWater(state);
}


function initialPositions(snapshot) {
  return (snapshot.positions ?? []).map(position => ({
    ...position,
    costBasisBaseUnits: position.receiptBaseUnits === null || position.usdcValueBaseUnits === null
      ? null : position.receiptBaseUnits === '0' ? '0' : position.usdcValueBaseUnits,
  }));
}

export function createAccounting({ portfolio, feeBps, feeRecipient, setupCosts = null }) {
  const recipient = validateTerms(feeBps, feeRecipient);
  const initialCost = setupCosts === null ? 0n : unsigned(setupCosts.knownCostUsdcBaseUnits, 'Known setup costs');
  if (setupCosts !== null && typeof setupCosts.hasUnpricedCost !== 'boolean') invalid('Setup cost valuation status is required.');
  const snapshot = readPortfolio(portfolio);
  const positions = initialPositions(snapshot);
  const complete = snapshot.complete;
  const enrolledCapital = complete
    ? (snapshot.cash + snapshot.positions.reduce((total, position) => total + BigInt(position.usdcValueBaseUnits), 0n)).toString()
    : null;
  const state = {
    schemaVersion: 1,
    feeBps,
    feeRecipient: recipient,
    enrollmentCapitalBaseUnits: enrolledCapital,
    cashBaseUnits: amountString(snapshot.cash),
    positions,
    portfolioObserved: complete,
    cashflowsAvailable: snapshot.cash !== null,
    cashflowUnavailableReason: snapshot.cash === null ? snapshot.reason ?? 'missing_cash_balance' : null,
    externalDepositsBaseUnits: '0',
    externalWithdrawalsBaseUnits: '0',
    transactionCostsBaseUnits: initialCost.toString(),
    highWaterMarkBaseUnits: complete ? enrolledCapital : null,
    feeEarnedBaseUnits: '0',
    feePaidBaseUnits: '0',
    realizedGainsBaseUnits: '0',
    realizedLossesBaseUnits: '0',
    feeUnavailableReason: snapshot.reason ?? (setupCosts?.hasUnpricedCost ? 'unpriced_setup_cost' : null),
    lastSequence: 0,
    lastActionId: null,
    lastReceiptFingerprint: null,
  };
  return state;
}

export function observeAccounting(state, portfolio) {
  const next = cloneState(state);
  const snapshot = readPortfolio(portfolio);
  markObservedPortfolio(next, snapshot, { ownCashDelta: 0n });
  return next;
}

function actionFingerprint(action, receipt) {
  const prepared = action.prepared;
  const receiptAmounts = receipt.amounts && typeof receipt.amounts === 'object' && !Array.isArray(receipt.amounts)
    ? Object.fromEntries(RECEIPT_AMOUNT_KEYS.map(key => [key, Object.hasOwn(receipt.amounts, key) ? receipt.amounts[key] ?? null : null]))
    : null;
  const normalized = {
    action: {
      actionId: action.actionId,
      sequence: action.sequence,
      mode: action.mode ?? null,
      kind: action.action,
      reserveAddress: action.reserveAddress ?? null,
      amountBaseUnits: action.amountBaseUnits,
      amountUnit: action.amountUnit ?? null,
      prepared: prepared ?? null,
    },
    receipt: {
      status: receipt.status,
      signature: receipt.signature ?? null,
      slot: receipt.slot ?? null,
      reason: receipt.reason ?? null,
      amounts: receiptAmounts,
    },
  };
  try { return sha256Utf8(stableStringify(normalized)); }
  catch { invalid('Action receipt must be plain JSON data.'); }
}

function validatePreparedAmounts(prepared) {
  unsigned(prepared.feeLamports, 'Prepared native fee', { u64: true });
  unsigned(prepared.rentLamports, 'Prepared rent amount', { u64: true });
  if (!prepared.expectedEffects || typeof prepared.expectedEffects !== 'object' || Array.isArray(prepared.expectedEffects)) {
    invalid('Prepared action effect amounts are required.');
  }
  for (const key of RECEIPT_AMOUNT_KEYS.slice(0, 4)) {
    unsigned(prepared.expectedEffects[key], `Prepared ${key}`, { u64: true });
  }
  if (Object.hasOwn(prepared, 'maxTotalCostUsdcBaseUnits') && prepared.maxTotalCostUsdcBaseUnits !== null) {
    unsigned(prepared.maxTotalCostUsdcBaseUnits, 'Prepared maximum USDC cost', { u64: true });
  }
}
function validateAction(state, action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) invalid('A retained financial action is required.');
  if (typeof action.actionId !== 'string' || action.actionId.length === 0 || action.actionId.length > 256) invalid('Action identifier is invalid.');
  if (!Number.isSafeInteger(action.sequence) || action.sequence <= 0) invalid('Action sequence must be a positive safe integer.');
  if (!['supply', 'redeem', 'fee', 'setup'].includes(action.action)) invalid('Unsupported lending accounting action.');
  const amount = unsigned(action.amountBaseUnits, 'Action amount', { u64: true });
  if (amount === 0n && action.action !== 'setup') invalid('Action amount must be positive.');
  if (!action.prepared || typeof action.prepared !== 'object' || Array.isArray(action.prepared)) invalid('Prepared action evidence is required.');
  if (action.prepared.action !== action.action || action.prepared.amountBaseUnits !== action.amountBaseUnits) {
    conflict('Prepared action does not match its retained action.');
  }
  validatePreparedAmounts(action.prepared);
  if (action.action === 'setup') {
    const wallet = canonicalWalletAddress(action.wallet);
    if (action.mode !== 'OWNER' || amount !== 0n || action.reserveAddress !== null
        || action.prepared.reserveAddress !== null || action.prepared.wallet !== wallet
        || action.prepared.recipient !== wallet || action.amountUnit !== 'usdc-base-units'
        || action.prepared.amountUnit !== 'usdc-base-units'
        || RECEIPT_AMOUNT_KEYS.slice(0, 4).some(key => action.prepared.expectedEffects[key] !== '0')) {
      conflict('Account setup must be owner-approved with zero token-principal effects.');
    }
    return;
  }
  if (action.action === 'fee') {
    if (action.mode !== 'OWNER' || action.prepared.recipient !== state.feeRecipient) conflict('Fee payment must be owner-approved for the trusted recipient.');
    if (action.prepared.reserveAddress !== null) conflict('Fee payment cannot target a lending reserve.');
    if (action.amountUnit !== 'usdc-base-units' || action.prepared.amountUnit !== 'usdc-base-units') conflict('Fee payment must use USDC base units.');
    const owed = feeOwed(state);
    if (owed === null || action.amountBaseUnits !== owed) conflict('Fee payment must equal the currently owed amount.');
    if (state.cashBaseUnits === null || amount > BigInt(state.cashBaseUnits)) conflict('Fee payment exceeds observed USDC cash.');
  } else {
    if (typeof action.reserveAddress !== 'string' || !action.reserveAddress
        || action.prepared.reserveAddress !== action.reserveAddress) conflict('Prepared reserve does not match the retained action.');
    const expectedUnit = action.action === 'supply' ? 'usdc-base-units' : 'receipt-base-units';
    if (action.amountUnit !== expectedUnit || action.prepared.amountUnit !== expectedUnit) conflict('Lending action amount unit is unsupported.');
  }
}

function readReceiptAmounts(receipt, status) {
  if (status === 'FAILED') {
    if (receipt.amounts === null || receipt.amounts === undefined) return { effects: { usdcDebit: 0n, usdcCredit: 0n, receiptDebit: 0n, receiptCredit: 0n }, cost: null, effectsKnown: true };
    if (typeof receipt.amounts !== 'object' || Array.isArray(receipt.amounts)) invalid('Failed receipt amounts are invalid.');
    const amounts = Object.fromEntries(RECEIPT_AMOUNT_KEYS.slice(0, 4).map(key => [key, optionalAmount(receipt.amounts, key)]));
    optionalAmount(receipt.amounts, 'feeLamports', 'Native transaction fee');
    optionalAmount(receipt.amounts, 'rentLamports', 'Transaction rent');
    if (Object.values(amounts).some(value => value !== null && value !== 0n)) conflict('A finalized failed transaction cannot contain token effects.');
    const cost = optionalAmount(receipt.amounts, 'costUsdcBaseUnits', 'Transaction cost');
    return { effects: { usdcDebit: 0n, usdcCredit: 0n, receiptDebit: 0n, receiptCredit: 0n }, cost, effectsKnown: true };
  }
  if (!receipt.amounts || typeof receipt.amounts !== 'object' || Array.isArray(receipt.amounts)) {
    return { effects: null, cost: null, effectsKnown: false };
  }
  const values = Object.fromEntries(RECEIPT_AMOUNT_KEYS.slice(0, 4).map(key => [key, optionalAmount(receipt.amounts, key)]));
  const effectsKnown = Object.values(values).every(value => value !== null);
  optionalAmount(receipt.amounts, 'feeLamports', 'Native transaction fee');
  optionalAmount(receipt.amounts, 'rentLamports', 'Transaction rent');
  return {
    effects: effectsKnown ? {
      usdcDebit: values.usdcDebitBaseUnits,
      usdcCredit: values.usdcCreditBaseUnits,
      receiptDebit: values.receiptDebitBaseUnits,
      receiptCredit: values.receiptCreditBaseUnits,
    } : null,
    cost: optionalAmount(receipt.amounts, 'costUsdcBaseUnits', 'Transaction cost'),
    effectsKnown,
  };
}

function validateFinalizedActionEffect(action, effect, status) {
  if (status === 'FAILED' || effect === null) return null;
  if (action.action === 'supply') {
    if (effect.usdcDebit !== BigInt(action.amountBaseUnits) || effect.usdcCredit !== 0n
        || effect.receiptDebit !== 0n) return 'receipt_action_effect_mismatch';
  } else if (action.action === 'redeem') {
    if (effect.receiptDebit !== BigInt(action.amountBaseUnits) || effect.usdcDebit !== 0n
        || effect.receiptCredit !== 0n) return 'receipt_action_effect_mismatch';
  } else if (action.action === 'setup') {
    if (effect.usdcDebit !== 0n || effect.usdcCredit !== 0n || effect.receiptDebit !== 0n || effect.receiptCredit !== 0n) {
      conflict('Finalized account setup cannot contain token-principal effects.');
    }
  } else if (effect.usdcDebit !== BigInt(action.amountBaseUnits) || effect.usdcCredit !== 0n
      || effect.receiptDebit !== 0n || effect.receiptCredit !== 0n) {
    conflict('Finalized fee transfer does not match the owner-approved amount.');
  }
  return null;
}

function adjustPositionBasis(state, action, effects, cost) {
  if (action.action === 'fee' || action.action === 'setup' || effects === null) return null;
  const index = state.positions.findIndex(position => position.reserveAddress === action.reserveAddress);
  if (index < 0) {
    failReason(state, 'receipt_baseline_unavailable');
    return null;
  }
  const position = state.positions[index];
  const oldReceipts = position.receiptBaseUnits === null ? null : BigInt(position.receiptBaseUnits);
  const oldBasis = position.costBasisBaseUnits === null ? null : BigInt(position.costBasisBaseUnits);
  const delta = effects.receiptCredit - effects.receiptDebit;
  const nextReceipts = oldReceipts === null ? null : oldReceipts + delta;
  let nextBasis = oldBasis;

  if (action.action === 'supply') {
    if (cost === null) nextBasis = null;
    else if (oldReceipts === 0n && oldBasis === null) nextBasis = effects.usdcDebit + cost;
    else if (oldBasis !== null) nextBasis = oldBasis + effects.usdcDebit + cost;
    if (effects.receiptCredit === 0n && effects.usdcDebit + (cost ?? 0n) > 0n) {
      failReason(state, 'receipt_basis_without_receipts');
      nextBasis = null;
    }
  } else if (effects.receiptDebit > 0n) {
    if (oldReceipts === null || oldBasis === null || effects.receiptDebit > oldReceipts) {
      failReason(state, 'receipt_basis_unavailable');
      nextBasis = null;
    } else {
      const allocated = effects.receiptDebit === oldReceipts
        ? oldBasis : ceilDiv(oldBasis * effects.receiptDebit, oldReceipts);
      nextBasis = oldBasis - allocated;
      const realized = effects.usdcCredit - allocated;
      if (realized > 0n) state.realizedGainsBaseUnits = (BigInt(state.realizedGainsBaseUnits) + realized).toString();
      else if (realized < 0n) state.realizedLossesBaseUnits = (BigInt(state.realizedLossesBaseUnits) - realized).toString();
    }
  }
  if (nextReceipts !== null && nextReceipts < 0n) {
    failReason(state, 'receipt_effect_exceeds_balance');
    nextBasis = null;
  } else if (nextReceipts === 0n) nextBasis = 0n;
  state.positions[index] = { ...position, costBasisBaseUnits: amountString(nextBasis) };
  return new Map([[action.reserveAddress, delta]]);
}

function addTransactionCost(state, cost) {
  if (cost === null) {
    failReason(state, 'unknown_transaction_cost');
    return;
  }
  state.transactionCostsBaseUnits = (BigInt(state.transactionCostsBaseUnits) + cost).toString();
}

function applyReceiptBalancesWithoutPortfolio(state, action, effects, effectsKnown, { updateCash, updatePositions }) {
  if (updateCash) {
    if (!effectsKnown || effects === null) state.cashBaseUnits = null;
    else if (state.cashBaseUnits !== null) {
      const predictedCash = BigInt(state.cashBaseUnits) + effects.usdcCredit - effects.usdcDebit;
      if (predictedCash < 0n) {
        failReason(state, 'receipt_cash_effect_exceeds_balance');
        state.cashBaseUnits = null;
      } else state.cashBaseUnits = predictedCash.toString();
    }
  }
  if (updatePositions && action.action !== 'fee' && action.action !== 'setup') {
    const index = state.positions.findIndex(position => position.reserveAddress === action.reserveAddress);
    if (index >= 0) {
      const position = state.positions[index];
      if (!effectsKnown || effects === null || position.receiptBaseUnits === null) {
        position.receiptBaseUnits = null;
        position.costBasisBaseUnits = null;
      } else {
        const quantity = BigInt(position.receiptBaseUnits) + effects.receiptCredit - effects.receiptDebit;
        if (quantity < 0n) {
          failReason(state, 'receipt_effect_exceeds_balance');
          position.receiptBaseUnits = null;
          position.costBasisBaseUnits = null;
        } else position.receiptBaseUnits = quantity.toString();
      }
      position.usdcValueBaseUnits = null;
    }
  }
  state.portfolioObserved = false;
}

export function reconcileAccounting(state, { action, receipt, portfolio }) {
  const next = cloneState(state);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) invalid('A finalized transaction receipt is required.');
  if (!['CONFIRMED', 'FAILED'].includes(receipt.status)) conflict('Only finalized receipts can change accounting.');
  if (!action || typeof action !== 'object' || Array.isArray(action)) invalid('A retained financial action is required.');
  if (typeof action.actionId !== 'string' || action.actionId.length === 0 || action.actionId.length > 256
      || !Number.isSafeInteger(action.sequence) || action.sequence <= 0) invalid('Action identity or sequence is invalid.');
  const fingerprint = actionFingerprint(action, receipt);
  if (action.sequence === next.lastSequence) {
    if (action.actionId === next.lastActionId && fingerprint === next.lastReceiptFingerprint) return next;
    conflict('A finalized action sequence was replayed with contradictory data.');
  }
  if (action.sequence < next.lastSequence || action.actionId === next.lastActionId) conflict('A finalized action sequence is not monotonic.');
  validateAction(next, action);

  const { effects, cost, effectsKnown } = readReceiptAmounts(receipt, receipt.status);
  if (receipt.status === 'CONFIRMED' && !effectsKnown) failReason(next, 'receipt_token_effects_unavailable');
  const effectReason = validateFinalizedActionEffect(action, effects, receipt.status);
  if (effectReason) failReason(next, effectReason);
  addTransactionCost(next, cost);

  if (receipt.status === 'CONFIRMED' && action.action === 'fee' && effectsKnown && effects !== null) {
    next.feePaidBaseUnits = (BigInt(next.feePaidBaseUnits) + effects.usdcDebit).toString();
  }
  const expectedReceiptDeltas = receipt.status === 'CONFIRMED' && effectsKnown
    ? adjustPositionBasis(next, action, effects, cost)
    : null;
  const ownCashDelta = receipt.status === 'FAILED' ? 0n
    : effectsKnown && effects !== null ? effects.usdcCredit - effects.usdcDebit : null;
  const snapshot = readPortfolio(portfolio);
  if (snapshot.cash === null || snapshot.positions === null) {
    failReason(next, snapshot.reason ?? 'portfolio_unavailable');
    applyReceiptBalancesWithoutPortfolio(next, action, effects, effectsKnown, {
      updateCash: snapshot.cash === null,
      updatePositions: snapshot.positions === null,
    });
  }
  markObservedPortfolio(next, snapshot, { expectedReceiptDeltas, ownCashDelta });

  next.lastSequence = action.sequence;
  next.lastActionId = action.actionId;
  next.lastReceiptFingerprint = fingerprint;
  return next;
}

export function feeOwed(state) {
  if (state === null || state === undefined) return null;
  const checked = cloneState(state);
  if (checked.feeUnavailableReason !== null || !checked.cashflowsAvailable || !checked.portfolioObserved
      || checked.enrollmentCapitalBaseUnits === null || checked.highWaterMarkBaseUnits === null) return null;
  const earned = BigInt(checked.feeEarnedBaseUnits);
  const paid = BigInt(checked.feePaidBaseUnits);
  const current = currentGain(checked);
  if (current === null) return null;
  if (current <= 0n || earned <= paid) return '0';
  const currentEntitlement = min(earned, current * BigInt(checked.feeBps) / 10000n);
  return max(0n, currentEntitlement - paid).toString();
}

export function accountingOverview(state) {
  if (state === null || state === undefined) {
    return {
      schemaVersion: 1,
      status: 'UNAVAILABLE',
      feeUnavailableReason: 'accounting_not_initialized',
      cashflowUnavailableReason: 'accounting_not_initialized',
      cashBaseUnits: null,
      equityBaseUnits: null,
      netGainBaseUnits: null,
      highWaterMarkBaseUnits: null,
      depositsBaseUnits: null,
      withdrawalsBaseUnits: null,
      transactionCostsBaseUnits: null,
      earnedFeeBaseUnits: null,
      paidFeeBaseUnits: null,
      feeOwedBaseUnits: null,
      realizedGainsBaseUnits: null,
      realizedLossesBaseUnits: null,
      feeBps: null,
      feeRecipient: null,
    };
  }
  const checked = cloneState(state);
  const reason = checked.feeUnavailableReason
    ?? (!checked.cashflowsAvailable ? checked.cashflowUnavailableReason ?? 'cashflow_data_unavailable'
      : checked.enrollmentCapitalBaseUnits === null ? 'enrollment_capital_unavailable'
        : checked.highWaterMarkBaseUnits === null ? 'high_water_mark_unavailable'
          : !checked.portfolioObserved ? 'portfolio_unavailable' : null);
  const available = reason === null;
  const equity = totalEquity(checked);
  const gain = available ? currentGain(checked) : null;
  const cashflowReason = checked.cashflowUnavailableReason
    ?? (checked.cashflowsAvailable ? null : 'cashflow_data_unavailable');
  return {
    schemaVersion: 1,
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    feeUnavailableReason: reason,
    cashflowUnavailableReason: cashflowReason,
    cashBaseUnits: checked.portfolioObserved ? checked.cashBaseUnits : null,
    equityBaseUnits: equity === null ? null : equity.toString(),
    netGainBaseUnits: gain === null ? null : gain.toString(),
    highWaterMarkBaseUnits: available ? checked.highWaterMarkBaseUnits : null,
    depositsBaseUnits: checked.cashflowsAvailable ? checked.externalDepositsBaseUnits : null,
    withdrawalsBaseUnits: checked.cashflowsAvailable ? checked.externalWithdrawalsBaseUnits : null,
    transactionCostsBaseUnits: available ? checked.transactionCostsBaseUnits : null,
    earnedFeeBaseUnits: available ? checked.feeEarnedBaseUnits : null,
    paidFeeBaseUnits: checked.feePaidBaseUnits,
    feeOwedBaseUnits: feeOwed(checked),
    realizedGainsBaseUnits: available ? checked.realizedGainsBaseUnits : null,
    realizedLossesBaseUnits: available ? checked.realizedLossesBaseUnits : null,
    feeBps: checked.feeBps,
    feeRecipient: checked.feeRecipient,
  };
}
