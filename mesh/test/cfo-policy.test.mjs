import { Keypair } from '@solana/web3.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBytes, sha256 } from '../council/evidence.ts';
import { evaluatePlan, validateMandate } from '../cfo/policy.mjs';

const AT = '2026-10-26T12:00:00.000Z';
const WALLET_KEY = Keypair.fromSeed(Buffer.alloc(32));
const WALLET = WALLET_KEY.publicKey.toBase58();
const SIGNER = WALLET_KEY.publicKey.toBuffer().toString('hex');
const USDC = 'nep141:sol-EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.omft.near';
const GTUSDC = 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near';
const TLO = 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near';
const DEADLINE = '2026-10-26T12:10:00.000Z';
const assets = [
  { assetId: USDC, symbol: 'USDC', decimals: 6, blockchain: 'sol', contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', kind: 'reserve', protocol: null },
  { assetId: GTUSDC, symbol: 'gtUSDCp', decimals: 18, blockchain: 'base', contractAddress: '0x0bb69b79bc829e1cfcc34a740110886d98d2bd14', kind: 'receipt', protocol: null },
  { assetId: TLO, symbol: 'TLO', decimals: 8, blockchain: 'eth', contractAddress: '0x0f38f1ce62776d4a0038bc6cac66877a5687383b', kind: 'receipt', protocol: null },
];

function mandate(overrides = {}) {
  return validateMandate({
    schemaVersion: 1,
    wallet: WALLET,
    reserveAssetId: USDC,
    reserveFloorBaseUnits: '4000000',
    maxActionReserveBaseUnits: '5000000',
    maxPositionBps: 5000,
    slippageBps: 100,
    maxFeeBps: 100,
    maxEvidenceAgeSeconds: 300,
    targets: [{ assetId: GTUSDC, weightBps: 5000 }, { assetId: TLO, weightBps: 5000 }],
    monitorIntervalSeconds: 60,
    maxMonitorCycles: 4,
    ...overrides,
  }, assets, WALLET);
}

function portfolio({ reserve = '10000000', gt = '2000000000000000000', tlo = '300000000', capturedAt = AT } = {}) {
  return {
    schemaVersion: 1,
    chain: 'near',
    network: 'mainnet',
    wallet: WALLET,
    signerId: SIGNER,
    capturedAt,
    blockHash: 'block-finalized-1',
    blockHeight: 100,
    assets,
    balances: [
      { assetId: USDC, balanceBaseUnits: reserve },
      { assetId: GTUSDC, balanceBaseUnits: gt },
      { assetId: TLO, balanceBaseUnits: tlo },
    ],
    status: 'OBSERVED',
    reasons: [],
  };
}

function quote({ origin, destination, amount, amountOut, minAmountOut = amountOut, capturedAt = AT, timestamp = capturedAt, refundFee = '0', withdrawFee = '0', deadline = DEADLINE, slippage = 100 } = {}) {
  const raw = {
    timestamp,
    quoteRequest: {
      dry: false,
      swapType: 'EXACT_INPUT',
      slippageTolerance: slippage,
      originAsset: origin,
      depositType: 'INTENTS',
      destinationAsset: destination,
      amount,
      refundTo: SIGNER,
      refundType: 'INTENTS',
      recipient: SIGNER,
      recipientType: 'INTENTS',
      deadline,
    },
    quote: {
      amountIn: amount,
      minAmountIn: amount,
      amountOut,
      minAmountOut,
      deadline,
      depositAddress: 'intents.near',
      refundFee,
      withdrawFee,
    },
  };
  return { schemaVersion: 1, capturedAt, raw, sha256: sha256(canonicalBytes(raw)), signatureVerified: true };
}

function commonQuotes({ gt = '2000000000000000000', tlo = '300000000', tloValue = '4000000' } = {}) {
  return [
    quote({ origin: GTUSDC, destination: USDC, amount: gt, amountOut: '8000000' }),
    quote({ origin: TLO, destination: USDC, amount: tlo, amountOut: tloValue }),
  ];
}

function request(overrides = {}) {
  return { requestId: '11111111-1111-4111-8111-111111111111', action: 'invest', sourceAssetId: USDC, targetAssetId: TLO, inputBaseUnits: '1000000', ...overrides };
}

function plan({ portfolio: holdings = portfolio(), mandate: limits = mandate(), request: action = request(), quotes = commonQuotes(), at = AT } = {}) {
  return evaluatePlan({ portfolio: holdings, mandate: limits, request: action, quotes, at });
}

function check(result, id) {
  return result.checks.find(item => item.id === id);
}

test('mandate binds the authenticated wallet and only runtime-verified asset mappings', () => {
  assert.equal(mandate().wallet, WALLET);
  assert.throws(() => mandate({ wallet: 'other.near' }), { code: 'INVALID_INPUT' });
  assert.throws(() => mandate({ reserveAssetId: GTUSDC }), { code: 'INVALID_INPUT' });
  assert.throws(() => mandate({ targets: [{ assetId: 'nep141:unsupported.near', weightBps: 5000 }] }), { code: 'INVALID_INPUT' });
  const mismatchedSigner = portfolio();
  mismatchedSigner.signerId = 'f'.repeat(64);
  const result = plan({ portfolio: mismatchedSigner });
  assert.equal(result.status, 'NO_DATA');
  assert.equal(check(result, 'portfolio-identity').status, 'NO_DATA');
});

test('V204: a fresh owner-bound receipt exit is not gated by stale unrelated receipt valuation', () => {
  const result = plan({
    request: request({ action: 'redeem', sourceAssetId: TLO, targetAssetId: USDC, inputBaseUnits: '100000000' }),
    quotes: [
      quote({ origin: TLO, destination: USDC, amount: '100000000', amountOut: '1333333' }),
      quote({ origin: GTUSDC, destination: USDC, amount: '2000000000000000000', amountOut: '8000000', capturedAt: '2026-10-26T11:50:00.000Z' }),
    ],
  });
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.proposal.inputBaseUnits, '100000000');
  assert.match(check(result, 'portfolio-valuation').detail, /unrelated receipt balances remain unvalued/);
});

test('an exit quote with the wrong owner binding fails closed', () => {
  const wrongOwner = quote({ origin: TLO, destination: USDC, amount: '100000000', amountOut: '1333333' });
  wrongOwner.raw.quoteRequest.refundTo = 'f'.repeat(64);
  wrongOwner.sha256 = sha256(canonicalBytes(wrongOwner.raw));
  const result = plan({
    request: request({ action: 'redeem', sourceAssetId: TLO, targetAssetId: USDC, inputBaseUnits: '100000000' }),
    quotes: [wrongOwner],
  });
  assert.equal(result.status, 'NO_DATA');
  assert.equal(check(result, 'quote-integrity').status, 'NO_DATA');
});

test('future and stale evidence are NO_DATA, never fresh by clock-skew tolerance', () => {
  const future = plan({ portfolio: portfolio({ capturedAt: '2026-10-26T12:00:00.001Z' }) });
  assert.equal(future.status, 'NO_DATA');
  assert.equal(check(future, 'portfolio-freshness').status, 'NO_DATA');

  const staleQuote = quote({ origin: GTUSDC, destination: USDC, amount: '2000000000000000000', amountOut: '8000000', capturedAt: '2026-10-26T11:50:00.000Z' });
  const stale = plan({ quotes: [staleQuote, ...commonQuotes().slice(1)] });
  assert.equal(stale.status, 'NO_DATA');
});
test('V211: signed provider timestamp must also be fresh when the quote envelope is newly captured', () => {
  const exitRequest = request({ action: 'redeem', sourceAssetId: TLO, targetAssetId: USDC, inputBaseUnits: '100000000' });
  const missingSignedQuote = quote({
    origin: TLO, destination: USDC, amount: '100000000', amountOut: '1333333', capturedAt: AT,
  });
  delete missingSignedQuote.raw.timestamp;
  missingSignedQuote.sha256 = sha256(canonicalBytes(missingSignedQuote.raw));
  const missingSigned = plan({ request: exitRequest, quotes: [missingSignedQuote] });
  assert.equal(missingSigned.status, 'NO_DATA');
  assert.match(check(missingSigned, 'quote-integrity').detail, /Signed provider quote timestamp is missing or invalid/);
  const staleSigned = plan({
    request: exitRequest,
    quotes: [quote({
      origin: TLO, destination: USDC, amount: '100000000', amountOut: '1333333',
      capturedAt: AT, timestamp: '2026-10-26T11:50:00.000Z',
    })],
  });
  assert.equal(staleSigned.status, 'NO_DATA');
  assert.match(check(staleSigned, 'quote-integrity').detail, /Signed provider quote timestamp exceeds/);

  const futureSigned = plan({
    request: exitRequest,
    quotes: [quote({
      origin: TLO, destination: USDC, amount: '100000000', amountOut: '1333333',
      capturedAt: AT, timestamp: '2026-10-26T12:00:00.001Z',
    })],
  });
  assert.equal(futureSigned.status, 'NO_DATA');
  assert.match(check(futureSigned, 'quote-integrity').detail, /Signed provider quote timestamp is future-dated/);
});

test('reserve floor and per-action reserve cap block spends independently', () => {
  const floor = plan({
    mandate: mandate({ maxActionReserveBaseUnits: '8000000' }),
    request: request({ inputBaseUnits: '7000000' }),
    quotes: [
      ...commonQuotes(),
      quote({ origin: USDC, destination: TLO, amount: '7000000', amountOut: '700000000' }),
      quote({ origin: TLO, destination: USDC, amount: '700000000', amountOut: '7000000' }),
      quote({ origin: TLO, destination: USDC, amount: '1000000000', amountOut: '13333333' }),
    ],
  });
  assert.equal(floor.status, 'BLOCKED');
  assert.equal(check(floor, 'reserve-floor').status, 'BLOCKED');

  const capped = plan({
    mandate: mandate({ maxActionReserveBaseUnits: '500000' }),
    request: request({ inputBaseUnits: '1000000' }),
    quotes: [
      ...commonQuotes(),
      quote({ origin: USDC, destination: TLO, amount: '1000000', amountOut: '100000000' }),
      quote({ origin: TLO, destination: USDC, amount: '100000000', amountOut: '1000000' }),
      quote({ origin: TLO, destination: USDC, amount: '400000000', amountOut: '5333333' }),
    ],
  });
  assert.equal(capped.status, 'BLOCKED');
  assert.equal(check(capped, 'action-cap').status, 'BLOCKED');
});

test('unknown quote fees fail closed as NO_DATA', () => {
  const buy = quote({ origin: USDC, destination: TLO, amount: '1000000', amountOut: '100000000' });
  delete buy.raw.quote.refundFee;
  buy.sha256 = sha256(canonicalBytes(buy.raw));
  const result = plan({ quotes: [
    ...commonQuotes(),
    buy,
    quote({ origin: TLO, destination: USDC, amount: '400000000', amountOut: '5333333' }),
  ] });
  assert.equal(result.status, 'NO_DATA');
  assert.equal(check(result, 'quote-cost').status, 'NO_DATA');
});

test('all-in fee cap uses the conservative same-reserve minimum roundtrip', () => {
  const result = plan({ quotes: [
    ...commonQuotes(),
    quote({ origin: USDC, destination: TLO, amount: '1000000', amountOut: '100000000' }),
    quote({ origin: TLO, destination: USDC, amount: '100000000', amountOut: '980000' }),
    quote({ origin: TLO, destination: USDC, amount: '400000000', amountOut: '5333333' }),
  ] });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(check(result, 'fee-cap').status, 'BLOCKED');
});
test('target-null allocation returns a deterministic quote draft without treating it as approved', () => {
  const result = plan({ request: request({ targetAssetId: null, inputBaseUnits: null }), quotes: commonQuotes() });
  assert.equal(result.status, 'NO_DATA');
  assert.equal(check(result, 'action-quote').status, 'NO_DATA');
  assert.equal(result.proposal.action, 'invest');
  assert.equal(result.proposal.targetAssetId, TLO);
  assert.equal(result.proposal.inputBaseUnits, '5000000');
});

test('rotation retains the next target and never spends estimated redeem proceeds', () => {
  const result = plan({
    portfolio: portfolio({ reserve: '5000000' }),
    mandate: mandate({ maxActionReserveBaseUnits: '8000000' }),
    request: request({ action: 'rotate', sourceAssetId: GTUSDC, targetAssetId: TLO, inputBaseUnits: '2000000000000000000' }),
    quotes: [
      quote({ origin: GTUSDC, destination: USDC, amount: '2000000000000000000', amountOut: '8000000' }),
    ],
  });
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.proposal.action, 'rotate');
  assert.equal(result.proposal.targetAssetId, TLO);
  assert.match(result.proposal.reason, /do not spend estimated proceeds/);
});

test('position cap uses quote-valued current exposure and projected exit valuation', () => {
  const quotes = [
    quote({ origin: GTUSDC, destination: USDC, amount: '2000000000000000000', amountOut: '8000000' }),
    quote({ origin: TLO, destination: USDC, amount: '300000000', amountOut: '8000000' }),
    quote({ origin: USDC, destination: TLO, amount: '1000000', amountOut: '100000000' }),
    quote({ origin: TLO, destination: USDC, amount: '100000000', amountOut: '1000000' }),
    quote({ origin: TLO, destination: USDC, amount: '400000000', amountOut: '8000000' }),
  ];
  const result = plan({ mandate: mandate({ maxPositionBps: 3100 }), quotes });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(check(result, 'position-cap').status, 'BLOCKED');
  assert.match(check(result, 'position-cap').detail, /Projected TLO position exceeds/);
});

test('reinvestment cannot count unreceived redemption proceeds toward reserve availability', () => {
  const result = plan({
    portfolio: portfolio({ reserve: '5000000' }),
    request: request({ action: 'reinvest', inputBaseUnits: '2000000' }),
    quotes: [
      ...commonQuotes(),
      quote({ origin: USDC, destination: TLO, amount: '2000000', amountOut: '200000000' }),
      quote({ origin: TLO, destination: USDC, amount: '200000000', amountOut: '2000000' }),
      quote({ origin: TLO, destination: USDC, amount: '500000000', amountOut: '5000000' }),
    ],
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(check(result, 'reserve-floor').status, 'BLOCKED');
  assert.match(check(result, 'reserve-floor').detail, /available=5000000.*spend=2000000.*floor=4000000/);
});

test('V211: monitor intervals cannot overflow the native timer into a one millisecond loop', () => {
  assert.throws(() => mandate({ monitorIntervalSeconds: 2_147_484 }), { code: 'INVALID_INPUT' });
  assert.equal(mandate({ monitorIntervalSeconds: 2_147_483 }).monitorIntervalSeconds, 2_147_483);
});
